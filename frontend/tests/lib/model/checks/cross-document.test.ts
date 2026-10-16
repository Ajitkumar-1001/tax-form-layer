import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { maskPacket } from '@/lib/server/mask'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { checks as agency, paymentTieOuts } from '@/lib/model/checks/agency'
import { checks as answers } from '@/lib/model/checks/client-answers'
import { checks as cross } from '@/lib/model/checks/cross-document'
import { checks as swings, swingRows } from '@/lib/model/checks/swings'
import type { CheckContext, Finding } from '@/lib/model/checks/types'

const raw = readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')
const packet = JSON.parse(raw) as Packet

const run = (ctx: CheckContext, id: string) => cross.find((c) => c.id === id)!.run(ctx)
const byId = (fs: Finding[]) => Object.fromEntries(fs.map((f) => [f.id, f]))
/** A copy of the packet with one change, to show a check does not fire on a near miss. */
function variant(change: (p: Packet) => void): CheckContext {
  const p = structuredClone(packet)
  change(p)
  return buildModel(p)
}
const doc = (p: Packet, id: string) => p.documents.find((d) => d.id === id)!

describe('cross-document checks on the real packet', () => {
  const m = buildModel(packet)

  it('CHK-06 matches supplement lots to broker lots and flags the three zero-basis RSU lots', () => {
    const fs = byId(run(m, 'CHK-06'))
    expect(Object.keys(fs).sort()).toEqual(['chk:CHK-06:F8949.B.N1', 'chk:CHK-06:F8949.B.N3', 'chk:CHK-06:F8949.E.N4'])
    expect(Object.values(fs).map((f) => [f.expected, f.actual])).toEqual([[19100, 0], [19100, 0], [9420, 0]])
    expect(Object.values(fs).reduce((s, f) => s + (f.expected as number), 0)).toBe(47620)
    const n1 = fs['chk:CHK-06:F8949.B.N1']
    expect(n1.fix).toMatchObject({ act: 'adjust', target: 'F8949.B.N1', field: 'basis', to: 19100 })
    expect(n1.evidence).toEqual(expect.arrayContaining(['ev-0066', 'ev-0497', 'doc:D11#page2']))
    expect(n1.stake!.fed).toBeLessThan(0)
    expect(n1.knownSince).toBe('2026-02-15T13:00:00Z')
    // Lots sold after the California move date carry no California effect. Each lot rounds on its own, so
    // California sums to -2,444 here against -2,445 for the 38,200 combined.
    expect(Object.values(fs).map((f) => f.stake)).toEqual([{ fed: -6647, ca: -1222 }, { fed: -6647, ca: -1222 }, { fed: -2242, ca: 0 }])
    expect(Object.values(fs).reduce((s, f) => s + f.stake!.fed, 0)).toBe(-15536)
    // ESPP lot N2 uses the supplement basis (6,600 - 2,100 = 4,500): no finding.
    expect(fs['chk:CHK-06:F8949.A.N2']).toBeUndefined()
  })

  it('CHK-07 ties books to information returns and finds the 1099-K counted on top', () => {
    const fs = byId(run(m, 'CHK-07'))
    const f = fs['chk:CHK-07:SchC.1']
    expect(f).toMatchObject({ expected: 151300, actual: 163700, signal: 'computed' })
    expect(f.evidence).toEqual(expect.arrayContaining(['ev-0103', 'ev-0127', 'ev-0109', 'ev-0111']))
    expect(f.fix).toMatchObject({ target: 'SchC.1', to: 151300 })
    expect(fs['chk:CHK-07:qa-24']).toMatchObject({ signal: 'heuristic', claims: ['qa-24', 'SchC.1'] })
  })

  it('CHK-07 counts card receipts as booked only when the books name a 1099-NEC payer', () => {
    const ctx = variant((p) => {
      p.extracted_values.find((e) => e.id === 'ev-0109')!.label = 'Card receipts via Paywell'
    })
    // Without the payer, the 1099-K money is unbooked: books plus 1099-K equals line 1, so nothing to flag.
    expect(run(ctx, 'CHK-07')).toEqual([])
  })

  it('CHK-08 flags only the dependent SSN, known from the prior-year return', () => {
    const fs = run(m, 'CHK-08')
    expect(fs.map((f) => f.id)).toEqual(['chk:CHK-08:household:theo#ssn'])
    expect([...fs[0].evidence].sort()).toEqual(['ev-0012', 'ev-1080', 'py:/return_2024/dependents/1/ssn'])
    expect(fs[0].knownSince).toBe('2026-01-21T00:00:00Z')
  })

  it('CHK-08 text names only the sightings in the file when the finding first shows', () => {
    const [f] = run(m, 'CHK-08')
    // D71 (ev-1080) arrives 2026-07-13, after the season clock starts: evidence, but not in the text.
    expect(f.title).toContain('does not match 2 of 2 places')
    expect(f.why).toContain('D06, the 2024 return show')
    expect(`${f.title} ${f.why} ${f.fix?.label}`).not.toContain('D71')
    expect(f.evidence).toContain('ev-1080')
    expect(f.expected).toBe(m.ev['ev-0012'].value)
  })

  it('CHK-09 checks label names and TINs against the cited page', () => {
    const fs = byId(run(m, 'CHK-09'))
    expect(Object.keys(fs).sort()).toEqual(['chk:CHK-09:F2441.1a:name', 'chk:CHK-09:F2441.1b:tin'])
    expect(fs['chk:CHK-09:F2441.1a:name'].fix?.to).toBe('Care provider: Bright Oak Kids Club, tax ID 68-0412257')
    expect(fs['chk:CHK-09:F2441.1b:tin'].evidence).toEqual(['ev-1045', 'doc:D62#page1'])
  })

  it('CHK-10 removes payoff interest already inside the 1098', () => {
    const fs = run(m, 'CHK-10')
    expect(fs.map((f) => [f.id, f.expected, f.actual])).toEqual([['chk:CHK-10:SchA.8a', 19697, 21847]])
    expect(fs[0].evidence).toEqual(expect.arrayContaining(['ev-1032', 'ev-1029']))
  })

  it('CHK-10 needs the statement and the cited 1098 to come from the same lender', () => {
    const ctx = variant((p) => {
      doc(p, 'D56').issuer = 'Another Lender LLC'
    })
    expect(run(ctx, 'CHK-10')).toEqual([])
  })

  it('CHK-11 takes the seller credit out of the home real estate tax', () => {
    const fs = run(m, 'CHK-11')
    expect(fs.map((f) => [f.id, f.expected, f.actual])).toEqual([['chk:CHK-11:SchA.5b', 6508, 13420]])
    expect(fs[0].evidence).toContain('ev-1027')
  })

  it('CHK-11 ignores a larger levy for another property cited on the same line', () => {
    const ctx = variant((p) => {
      p.extracted_values.find((e) => e.id === 'ev-1007')!.value = 20000 // 1450 Fremont Way, not the purchased home
      p.return_versions[2].lines.find((l) => l.key === 'SchA.5b')!.sources.push('ev-1007')
    })
    const fs = run(ctx, 'CHK-11')
    expect(fs.map((f) => [f.id, f.expected])).toEqual([['chk:CHK-11:SchA.5b', 6508]])
    expect(fs[0].evidence).not.toContain('ev-1007')
  })

  it('CHK-12 caps the vehicle at the 1098-C gross proceeds', () => {
    const fs = run(m, 'CHK-12')
    expect(fs.map((f) => [f.id, f.expected, f.actual])).toEqual([['chk:CHK-12:F8283.A1.vehicle', 2900, 6000]])
    expect(fs[0].claims).toEqual(['F8283.A1.vehicle', 'qa-39'])
  })

  it('CHK-12 does not cap when box 4a is printed as not checked', () => {
    const ctx = variant((p) => {
      const pg = doc(p, 'D66').pages[0]
      pg.printed_content = pg.printed_content.replace('unrelated party checked', 'unrelated party not checked')
    })
    expect(doc(ctx.packet, 'D66').pages[0].printed_content).toContain('not checked')
    expect(run(ctx, 'CHK-12')).toEqual([])
  })
})

describe('C2 checks on the packet the server masker produces', () => {
  const all = [...cross, ...agency, ...answers, ...swings]
  const plain = buildModel(packet)
  const { masked, secrets } = maskPacket(packet)
  const mask = buildModel(masked)

  it('the masker really hid the identifiers', () => {
    expect(JSON.stringify(mask.packet)).not.toContain(packet.household.people[3].ssn)
    expect(mask.packet.household.people[3].ssn).toMatch(/^«ssn·3309·eq:/)
  })

  it('produces the same findings as the unmasked packet', () => {
    const ids = (ctx: CheckContext) => all.flatMap((c) => c.run(ctx).map((f) => f.id)).sort()
    expect(ids(mask)).toEqual(ids(plain))
  })

  it('never returns a value the masker hides, in findings, payment rows or swing rows', () => {
    const text = JSON.stringify([...all.flatMap((c) => c.run(mask)), ...paymentTieOuts(mask), ...swingRows(mask)])
    expect(secrets.size).toBeGreaterThan(10)
    for (const s of secrets.values()) expect(text.includes(s.value), `${s.kind} leaked`).toBe(false)
    expect(text).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
  })
})

describe('C2 checks inside buildModel', () => {
  const m = buildModel(packet)
  const mine = new Set([...cross, ...agency, ...answers, ...swings].map((c) => c.id))

  it('none crash, ids are unique and every claim exists', () => {
    const fs = m.findings.filter((f) => mine.has(f.check))
    expect(fs.filter((f) => f.id.endsWith(':crashed'))).toEqual([])
    expect(new Set(fs.map((f) => f.id)).size).toBe(fs.length)
    for (const f of fs) expect(f.claims.length, f.id).toBeGreaterThan(0)
  })

  it('heuristic findings say in why that they can misfire', () => {
    const fs = m.findings.filter((f) => mine.has(f.check) && f.signal === 'heuristic')
    expect(fs.length).toBeGreaterThan(0)
    for (const f of fs) expect(f.why, f.id).toMatch(/misfire|not proof/)
  })

  it('source files never name canonical error ids', () => {
    for (const f of ['cross-document', 'agency', 'client-answers', 'swings']) {
      for (const ext of ['.ts', '.test.ts']) {
        expect(readFileSync(path.join(__dirname, ext === '.ts' ? '../../../../src/lib/model/checks' : '.', f + ext), 'utf8')).not.toMatch(/\bE\d{2}\b/)
      }
    }
  })
})
