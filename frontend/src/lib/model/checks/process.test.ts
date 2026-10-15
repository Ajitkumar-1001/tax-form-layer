import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { maskPacket } from '@/lib/server/mask'
import { buildModel } from '../build'
import type { Packet } from '../packet-types'
import { checks } from './process'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)
const run = (id: string) => checks.find((c) => c.id === id)!.run(m)
const at = (timelineId: string) => packet.timeline.find((t) => t.id === timelineId)!.at

describe('CHK-53 client approval gate', () => {
  it('the scripted 8879 approval came while v3 had open items', () => {
    const found = run('CHK-53')
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-53:tl-20'])
    const f = found[0]
    expect(f.severity).toBe('high')
    expect(f.knownSince).toBe(at('tl-20'))
    expect(f.why).toContain("F8867.status is 'Not completed'")
    expect(f.why).toContain('7 engine warnings were open on v3')
    expect(f.why).toContain('msg-07, msg-08 arrived after v3')
    expect(f.claims).toEqual(['step:12', 'msg-07', 'msg-08'])
  })
})

describe('CHK-54 due diligence', () => {
  it('Form 8867 not completed in every version while the credit is claimed', () => {
    const found = run('CHK-54')
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-54:F8867.status'])
    expect(found[0].severity).toBe('high')
    expect(found[0].why).toContain('F1040.19 1,250 / 1,200 / 400 in v1 / v2 / v3')
    expect(found[0].claims).toEqual(['F8867.status', 'F1040.19', 'step:8', 'diag:DUE_DILIGENCE_REQUIRED'])
  })
})

describe('CHK-55 no self-review', () => {
  it('the assigned reviewer prepared the extension that produced Sch3.10', () => {
    const found = run('CHK-55')
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-55:extension-2026-04-14'])
    expect(found[0].claims).toEqual(['Sch3.10', 'step:10'])
    expect(found[0].title).toContain('st-02')
  })
})

describe('CHK-56 changes after review', () => {
  const found = run('CHK-56')
  const byId = (id: string) => found.find((f) => f.id === id)!
  it('v3 changed 89 lines after review; roots over 1,000 need the partner', () => {
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-56:v3', 'chk:CHK-56:F7203.1', 'chk:CHK-56:SchE.28B'])
    expect(found[0].title).toContain('changed 89 lines')
    expect(found[0].why).toContain('D26, D37, D38, D40, D43')
  })
  it('an unpriced root is priced where its change lands (F7203.1 via the post-move S corp gain: no CA effect)', () => {
    const f = byId('chk:CHK-56:F7203.1')
    expect(f.why).toContain('Tax effect fed 1,404, CA 0.')
    expect(f.signal).toBe('computed')
  })
  it('a root with no priced federal path is an ordinary-income estimate, said as such', () => {
    const f = byId('chk:CHK-56:SchE.28B')
    expect(f.why).toContain('fed 2,604, CA 342, estimated at the ordinary-income rate')
    expect(f.signal).toBe('heuristic')
  })
  it('regression: partner-routing findings carry no stake (a legitimate change is not money at risk)', () => {
    for (const f of found) expect(f.stake).toBeUndefined()
    for (const f of m.findings.filter((x) => x.check === 'CHK-56')) expect(f.stake).toBeUndefined()
  })
  it('the extension payment (Sch3.10) re-opens review but is not an adjustment routed to the partner', () => {
    expect(found.some((f) => f.id === 'chk:CHK-56:Sch3.10')).toBe(false)
    expect(found[0].claims).toContain('Sch3.10')
  })
  it('regression: a root priced only on the California side keeps that CA amount in the estimate', () => {
    // SchE.28B's change reaches SchCA540NR.17.E (California-source column), which is priced; only fed is estimated.
    const v3 = packet.return_versions[2]
    const c = v3.changes_from_previous.find((x) => x.key === 'SchCA540NR.17.E')!
    const ca = Math.round((Number(c.new) - Number(c.old)) * v3.tax_effect_rates.ca_source_income.california_per_dollar)
    expect(ca).toBe(342)
    expect(byId('chk:CHK-56:SchE.28B').why).toContain(`fed 2,604, CA ${ca}, estimated`)
  })
})

describe('CHK-59 bank account', () => {
  it('the refund/debit account appears on no document', () => {
    const found = run('CHK-59')
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-59:household#bank_account'])
    expect(found[0].claims).toEqual(['household#bank_account', 'qa-43'])
  })
  it('regression: says the same on the masked packet the app runs (no raw-only checksum sentence)', () => {
    const masked = buildModel(maskPacket(packet).masked)
    const [raw] = run('CHK-59')
    const [onMasked] = checks.find((c) => c.id === 'CHK-59')!.run(masked)
    expect(onMasked.why).toBe(raw.why)
    expect(raw.why).not.toMatch(/checksum/i)
  })
})

describe('CHK-60 extension sizing', () => {
  const found = run('CHK-60')
  it('v2 tax 77,470 less transcript payments needs 37,000; 36,000 was paid', () => {
    const f = found.find((x) => x.id === 'chk:CHK-60:extension')!
    expect([f.expected, f.actual]).toEqual([37000, 36000])
    expect(f.why).toContain('= 36,728')
    expect(f.knownSince).toBe(at('extension-2026-04-14'))
  })
  it('the 5,220 balance paid 96 days late: interest 96.11, failure-to-pay 104.40', () => {
    const f = found.find((x) => x.id === 'chk:CHK-60:late-payment')!
    expect(f.title).toBe('The 5,220 balance was paid 96 days late; about 96.11 interest and 104.40 failure-to-pay are not in the workpaper')
    expect(f.knownSince).toBe(at('tl-25'))
  })
})

it('every finding keeps an existing claim, survives runChecks, and names no canonical error id', () => {
  for (const c of checks) {
    for (const f of c.run(m)) {
      expect(f.claims.length).toBeGreaterThan(0)
      expect(f.claims.every((id) => m.claims[id])).toBe(true)
      expect(m.findingsById[f.id]?.claims).toEqual(f.claims)
      expect(`${f.title} ${f.why}`).not.toMatch(/\bE\d{2}\b/)
    }
  }
})
