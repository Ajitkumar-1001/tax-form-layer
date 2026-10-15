import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '../build'
import type { Packet } from '../packet-types'
import { checks } from './state-sourcing'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)
const run = (id: string, model = m) => checks.find((c) => c.id === id)!.run(model)
const withCaResidency = (from: string, to: string) =>
  buildModel({ ...packet, household: { ...packet.household, residency: packet.household.residency.map((r) => (r.state === 'CA' ? { ...r, from, to } : r)) } })

describe('CHK-44 part-year state wages', () => {
  it('Corvane box 16 (ended before the move) + Halvorsen paystub to 07/15 = 129,569 vs 218,400', () => {
    const found = run('CHK-44')
    expect(found).toHaveLength(1)
    const f = found[0]
    expect(f.id).toBe('chk:CHK-44:SchCA540NR.1.E')
    expect([f.expected, f.actual]).toEqual([129569, 218400])
    expect(f.title).toContain('overstated by 88,831')
    expect(f.stake).toEqual({ fed: 0, ca: -5685 })
    expect(f.severity).toBe('high')
    expect(f.claims).toEqual(['SchCA540NR.1.E', 'D73', 'D09'])
    expect(f.knownSince).toBe('2026-03-27T16:30:00Z') // the paystub's arrival
    expect(f.fix).toMatchObject({ act: 'adjust', target: 'SchCA540NR.1.E', field: 'value', to: 129569 })
  })
  it('regression: a CA W-2 with no printed employment dates is not taken at full box 16', () => {
    const undated = buildModel({
      ...packet,
      documents: packet.documents.map((d) =>
        d.id === 'D08' ? { ...d, pages: d.pages.map((pg) => ({ ...pg, printed_content: pg.printed_content.replace(/employment ended \S+/i, '') })) } : d,
      ),
    })
    const [f] = run('CHK-44', undated)
    expect(f.signal).toBe('heuristic')
    expect(f.expected).toBeUndefined()
    expect(f.title).toContain('for Corvane Systems, Inc. cannot be split')
    expect(f.why).toContain('no employment dates printed; no pay record dated at the move')
  })
  it('a move into the state is not rebuilt from pay at the move (that only works for a move out)', () => {
    expect(run('CHK-44', withCaResidency('2025-03-01', '2025-12-31'))).toEqual([])
  })
  it('without a pay record dated at the move it asks for one instead of guessing', () => {
    const noStub = buildModel({ ...packet, documents: packet.documents.filter((d) => d.document_type !== 'paystub') })
    const [f] = run('CHK-44', noStub)
    expect(f.signal).toBe('heuristic')
    expect(f.expected).toBeUndefined()
    expect(f.title).toContain('Halvorsen Data LLC')
  })
})

describe('CHK-45 state capital gain from sale dates', () => {
  it('rebuild 43,840 vs 55,174; the gap is the post-move S corp gain prorated 195/365', () => {
    const found = run('CHK-45')
    expect(found).toHaveLength(1)
    const f = found[0]
    expect([f.expected, f.actual]).toEqual([43840, 55174])
    expect(f.signal).toBe('heuristic')
    expect(f.claims).toEqual(['SchCA540NR.7.E', 'F8949.F.SCORP'])
    expect(f.why).toContain('49,732.83')
    expect(f.why).toContain('11,334.04')
    expect(f.why).toContain('F8949.B.N1, F8949.B.N3, F8949.H.C6')
    expect(f.stake).toEqual({ fed: 0, ca: -725 })
    expect(f.fix?.act).toBe('decide')
  })
})

describe('CHK-45 residency window is clamped to the tax year', () => {
  it('regression: CA residency that began years earlier still prorates 195/365', () => {
    const [f] = run('CHK-45', withCaResidency('2019-06-01', '2025-07-14'))
    expect([f.expected, f.actual]).toEqual([43840, 55174])
    expect(f.stake).toEqual({ fed: 0, ca: -725 })
    expect(f.why).toContain('× 195/365')
    expect(f.why).toContain('sales dated 2025-01-01 to 2025-07-14')
  })
  it('regression: sales before the residency starts are not California sales', () => {
    const all = run('CHK-45')[0]
    const late = run('CHK-45', withCaResidency('2025-06-01', '2025-07-14'))[0]
    const count = (f: { why: string }) => Number(/Rebuilt: (\d+) sales/.exec(f.why)?.[1])
    expect(count(late)).toBeLessThan(count(all))
    expect(late.why).toContain('× 44/365')
  })
})

it('every finding keeps an existing claim and survives runChecks', () => {
  for (const c of checks) {
    for (const f of c.run(m)) {
      expect(f.claims.length).toBeGreaterThan(0)
      expect(f.claims.every((id) => m.claims[id])).toBe(true)
      expect(m.findingsById[f.id]?.claims).toEqual(f.claims)
    }
  }
})
