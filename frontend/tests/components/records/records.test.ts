import { describe, expect, it } from 'vitest'
import Page from '@/app/(work)/records/[name]/page'
import type { ActInput } from '@/lib/model/acts'
import { project } from '@/lib/model/project'
import { BUILDERS } from '@/components/records/builders'
import { actsOf, loadFixture } from './fixture'
import { RECORDS } from '@/components/records/registry'
import { basisFlags } from '@/components/records/rows-assets'
import { lotsOf, moveDate } from '@/components/records/rows-tieouts'
import type { RecordTable } from '@/components/records/table'

const { model, state } = loadFixture()
const build = (name: string): RecordTable => BUILDERS[name](model, state)
const rowsOf = (t: RecordTable) => t.groups.flatMap((g) => g.rows)

describe('registry', () => {
  it('has a builder for every record and every record builds', () => {
    expect(Object.keys(BUILDERS).sort()).toEqual(RECORDS.map((r) => r.name).sort())
    for (const r of RECORDS) {
      const t = build(r.name)
      expect(t.groups.length, r.name).toBeGreaterThan(0)
      for (const g of t.groups) for (const row of g.rows) expect(row.cells.length, `${r.name}/${g.key}`).toBe((g.columns ?? t.columns).length)
      for (const g of t.groups) expect(new Set(g.rows.map((x) => x.key)).size, `${r.name}/${g.key} row keys`).toBe(g.rows.length)
      expect(new Set(t.groups.map((g) => g.key)).size, `${r.name} group keys`).toBe(t.groups.length)
    }
  })
  it('every cell ref is a string a /r/ link can carry', () => {
    for (const r of RECORDS) for (const row of rowsOf(build(r.name))) for (const c of row.cells) for (const ref of [c.ref, ...(c.refs ?? [])]) if (ref !== undefined) expect(ref.length).toBeGreaterThan(0)
  })
})

describe('sales', () => {
  it('covers all 302 Form 8949 lines', () => {
    expect(rowsOf(build('sales'))).toHaveLength(302)
  })
  it('groups lots by broker with the tie-out as header; Meridian is red with the 250 gap and the page 32 link', () => {
    const t = build('sales')
    const meridian = t.groups.find((g) => g.key === 'D31')
    expect(meridian?.banner?.tone).toBe('bad')
    expect(meridian?.banner?.text).toContain('gap 250')
    expect(meridian?.banner?.refs).toContain('doc:D31#page32')
    expect(meridian?.banner?.refs).toContain('chk:CHK-04:D31')
    expect(t.groups.find((g) => g.key === 'D74')?.rows).toHaveLength(260)
  })
  it('flags blank basis and wash sales, and marks the residency period', () => {
    const lots = new Map(lotsOf(model, state).map((l) => [l.key, l]))
    expect(moveDate(model)).toBe('2025-07-14')
    expect(lots.get('F8949.H.C6')?.reasons).toContain('no basis read')
    expect(lots.get('F8949.B.N1')?.reasons).toContain('basis 0')
    expect(lots.get('F8949.A.M6')?.reasons).toContain('wash sale')
    expect(lots.get('F8949.A.M6')?.caPeriod).toBe(true)
  })
  it('does not count the sale date as an exception: 33 lots and 7 box totals, not 178 rows', () => {
    const lots = lotsOf(model, state)
    expect(lots.some((l) => l.reasons.some((r) => r.includes('move')))).toBe(false)
    expect(lots.filter((l) => l.caPeriod && l.reasons.length === 0).length).toBeGreaterThan(0)
    expect(rowsOf(build('sales')).filter((r) => r.exception)).toHaveLength(40)
  })
})

describe('payments', () => {
  it('ties federal estimates to the transcript: the 01/14 4,000 is not on it', () => {
    const g = build('payments').groups.find((x) => x.key === 'F1040.26')
    expect(g?.banner?.tone).toBe('bad')
    const statuses = g?.rows.map((r) => `${r.cells[0].v} ${r.cells[2].v}`)
    expect(statuses).toContain('2026-01-14 on return only')
    expect(statuses).toContain('2026-01-15 on agency record only')
  })
  it('greys the extension payment until the transcript showing it is in the file, citing the firm record', () => {
    const g = build('payments').groups.find((x) => x.key === 'Sch3.10')
    expect(g?.banner?.text).toContain('not yet in file')
    expect(g?.banner?.text).toContain('firm record')
  })
  it('shows no agency result before the agency record is in the file', () => {
    const before = build('payments').groups.find((x) => x.key === 'Sch3.10')
    expect(before?.banner?.text).not.toContain('transcript')
    expect(before?.banner?.refs.some((r) => r.startsWith('chk:') || r.startsWith('agency:'))).toBe(false)
    expect(before?.rows.map((r) => [r.cells[2].v, r.cells[2].tone, r.cells[3].ref, r.exception])).toEqual([['agency record not yet in file', 'muted', undefined, false]])
    const later = project(model, actsOf(model, [['st-03', { type: 'clock', target: 'season', body: { to: '2026-08-04T00:00:00Z' } }]]), state.viewer)
    const after = BUILDERS.payments(model, later).groups.find((x) => x.key === 'Sch3.10')
    expect(after?.rows[0].cells[2].v).toBe('matched')
    expect(after?.banner?.text).toContain('IRS account transcript')
  })
  it('agrees withholding on the effective value, so an adjust shows', () => {
    const adjust: ActInput = { type: 'adjust', target: 'F1040.25a', body: { field: 'value', to: 25900, reason: 'Box 2 misread on the Halvorsen W-2', evidence: ['ev-0036'] } }
    const s = project(model, actsOf(model, [['st-01', adjust]]), state.viewer)
    const g = BUILDERS.payments(model, s).groups.find((x) => x.key === 'F1040.25a')
    expect(g?.banner?.text).toContain('On the return 25,900')
    expect(g?.banner?.text).toContain('difference 500')
    expect(g?.banner?.tone).toBe('bad')
  })
  it('shows the CA payment held for 2024', () => {
    const g = build('payments').groups.find((x) => x.key === 'F540NR.72')
    expect(g?.rows.some((r) => r.cells[2].v === 'held for another year')).toBe(true)
  })
})

describe('summary and swings', () => {
  it('summary lines carry 2024, v3 and a delta, with totals labelled estimate', () => {
    const t = build('summary')
    const agi = rowsOf(t).find((r) => r.key === 'F1040.11')
    expect(agi?.cells[3].v).toBe(445590)
    expect(t.notes[0].text).toContain('estimate')
  })
  it('swings put roots first', () => {
    const rows = rowsOf(build('swings'))
    const firstNonRoot = rows.findIndex((r) => r.cells[6].v !== 'root')
    expect(rows.slice(firstNonRoot).some((r) => r.cells[6].v === 'root')).toBe(false)
  })
})

describe('tax computation', () => {
  it('is a tree from F1040.24 that stops at line 11', () => {
    const rows = rowsOf(build('tax-computation'))
    expect(rows[0].key).toBe('F1040.24')
    expect(rows.some((r) => r.key === 'F1040.11')).toBe(true)
    expect(rows.some((r) => r.key === 'F1040.9')).toBe(false)
    expect(rows.some((r) => r.key.startsWith('F6251.'))).toBe(true)
  })
})

describe('state split, depreciation, carryovers, basis', () => {
  it('pivots Schedule CA into columns A–E', () => {
    const wages = rowsOf(build('state-split')).find((r) => r.key === '1')
    expect(wages?.cells[2].v).toBe(212400)
    expect(wages?.cells[6].v).toBe(218400)
  })
  it('lists the 9 v3 assets with the disposal recapture', () => {
    const rows = build('depreciation').groups[0].rows
    expect(rows).toHaveLength(9)
    expect(rows.find((r) => r.key === 'AUS-BLDG')?.exception).toBe(true)
  })
  it('carries capital loss in from 2024 and flags it used', () => {
    const cap = build('carryovers').groups[0].rows.find((r) => r.key === 'capital_loss_long')
    expect(cap?.cells[1].v).toBe(11000)
    expect(cap?.cells[3].v).toBe(0)
  })
  it('links a document cited as a basis source', () => {
    expect(rowsOf(build('basis')).flatMap((r) => r.cells).some((c) => c.ref === 'D54')).toBe(true)
  })
  it('flags null basis years and client worksheets', () => {
    expect(basisFlags({ year: 2023, ending_stock_basis: null, source: 'missing - 2023 K-1 not in prior file' })).toEqual(['no ending stock basis', 'missing record'])
    expect(basisFlags({ year: 2022, ending_stock_basis: 21300, source: 'client worksheet in prior preparer file' })).toEqual(['client worksheet only'])
  })
})

describe('books to tax', () => {
  it('pools telephone and internet onto SchC.25 and flags uncited book items', () => {
    const t = build('books-to-tax')
    const util = t.groups[0].rows.find((r) => r.key === 'SchC.25')
    expect(util?.cells[1].v).toBe(3480)
    expect(util?.cells[4].v).toBe(0)
    expect(t.groups[1].rows.some((r) => r.key === 'ev-0094')).toBe(true)
  })
})

describe('record page', () => {
  // Page is a sync Suspense shell; its only child is the async component that reads params and may notFound().
  const render = (name: string) => {
    const child = (Page({ params: Promise.resolve({ name }) }) as { props: { children: { type: (p: object) => Promise<unknown>; props: object } } }).props.children
    return child.type(child.props)
  }
  it('answers an unknown record name with notFound (404)', async () => {
    await expect(render('nope')).rejects.toMatchObject({ digest: expect.stringContaining('404') })
    await expect(render('sales')).resolves.toBeTruthy()
  })
})
