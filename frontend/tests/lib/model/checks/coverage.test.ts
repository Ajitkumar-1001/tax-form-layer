import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Act, type ActInput, ActInputZ, refsOf } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { type Model, buildModel } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)
const of = (check: string, model: Model = m) => model.findings.filter((f) => f.check === check)
const ids = (check: string) => of(check).map((f) => f.id.replace(`chk:${check}:`, ''))

describe('CHK-48 used documents that land nowhere', () => {
  it('lists the documents no more specific check explains', () => {
    expect(ids('CHK-48')).toEqual(['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D13', 'D15', 'D47', 'D54', 'D73'])
  })
  it('treats support and prior-year documents as info with a dispose fix', () => {
    const info = of('CHK-48').filter((f) => f.severity === 'info').map((f) => f.claims[0])
    expect(info).toEqual(['D01', 'D02', 'D04', 'D05', 'D06'])
    expect(of('CHK-48').find((f) => f.claims[0] === 'D01')?.fix).toMatchObject({ act: 'dispose', disposition: 'informational' })
  })
})

describe('one finding per claim where two checks say the same thing', () => {
  const primaries = (checks: string[]) => m.findings.filter((f) => checks.includes(f.check)).map((f) => f.claims[0])
  const shared = (a: string, b: string) => primaries([a]).filter((c) => primaries([b]).includes(c))

  it('leaves a copy to CHK-18 and a never-extracted document to CHK-03', () => {
    expect(shared('CHK-48', 'CHK-18')).toEqual([])
    expect(shared('CHK-48', 'CHK-03')).toEqual([])
    expect(m.findingsById['chk:CHK-18:D10']).toBeDefined()
    expect(m.findingsById['chk:CHK-03:D07'].why).toContain('lists it as used')
  })
  it('leaves an outside-filing diagnostic to CHK-50', () => {
    expect(shared('CHK-50', 'CHK-52')).toEqual([])
    expect(m.findingsById['chk:CHK-52:FBAR_OUTSIDE_RETURN']).toBeUndefined()
    expect(m.findingsById['chk:CHK-52:FORM_1099_FILING']).toBeUndefined()
  })
})

describe('CHK-49 required entries', () => {
  const f = (key: string) => m.findingsById[`chk:CHK-49:${key}`]
  it('flags the missing inventory entries, each on a real line', () => {
    expect(of('CHK-49')).toHaveLength(23)
    expect(of('CHK-49').every((x) => x.claims.length === 1 && m.claims[x.claims[0]]?.kind === 'line')).toBe(true)
  })
  it('derives forced answers from documents', () => {
    expect(f('F1040.digital_assets')).toMatchObject({ expected: 'Yes', evidence: ['D34'], claims: ['F1040.7'] })
    expect(f('SchB.7a.fincen')).toMatchObject({ expected: 'Yes', claims: ['SchB.7a'] })
    expect(f('SchB.7a.fincen').why).toContain('149,567')
    expect(f('SchC.F').expected).toBe('Cash')
    expect(f('SchC.H')).toMatchObject({ expected: 'No', evidence: ['py:/return_2024/lines/SchC.1'] })
    expect(f('SchC.45').expected).toBe('Yes')
    expect(f('SchE.28e').expected).toBe('Checked')
    expect(f('SchC.G').expected).toBeUndefined()
  })
  it('offers a completeness decision on the entry key, with the forced answer as the choice', () => {
    expect(f('F1040.digital_assets').fix).toEqual({ act: 'decide', target: 'F1040.digital_assets', to: 'Yes', label: 'Answer Yes' })
    expect(f('SchC.G').fix).toMatchObject({ act: 'decide', target: 'SchC.G', to: undefined })
    for (const x of of('CHK-49')) {
      expect(x.fix?.act, x.id).toBe('decide')
      expect(x.fix?.target, x.id).toBe(x.id.replace('chk:CHK-49:', ''))
      expect(m.claims[x.fix!.target], x.id).toBeUndefined() // never the anchor line: a decide there would clear its neighbours
    }
  })

  // Regression: the fixes were adjusts on keys that are not claims, so authorize refused every one of them.
  it('each fix is accepted for a preparer and clears only its own finding', () => {
    const st01 = identities(packet).find((v) => v.id === 'st-01')!
    const empty = project(m, [], st01)
    for (const x of of('CHK-49')) {
      const input: ActInput = ActInputZ.parse({
        type: 'decide', target: x.fix!.target,
        body: { kind: 'completeness', question: x.title, choice: String(x.fix!.to ?? 'Not required'), authority: 'Form instructions', evidence: x.evidence, findings: [x.id] },
      })
      expect(authorize(m, empty, input, st01), x.id).toEqual({ ok: true })
      const act: Act = {
        seq: 1, id: 't-1', engagement: 'test', recorded_at: empty.clock, season_at: empty.clock, actor: 'st-01', actor_role: 'preparer',
        type: input.type, target: input.target, refs: refsOf(input), body: input.body, derived: deriveFor(m, empty, input), batch_id: null, hash: '', prev_hash: '',
      }
      const after = project(m, [act], st01)
      expect(Object.values(after.findings).filter((s) => s.status === 'resolved').map((s) => s.id), x.id).toEqual([x.id])
    }
  })

  // Regression: entries without `near` fell back to F1040.1a (Wages area) and shared it with a swing decision.
  it('anchors entries in their own area, on lines no other finding decides or disposes', () => {
    expect(f('F1040.ip_pin').claims).toEqual(['F1040.33'])
    expect(f('F1040.designee').claims).toEqual(['F1040.33'])
    expect(m.claims['F1040.33'].area).toBe('payments_and_filing')
    const decided = new Set(m.findings.flatMap((x) => (x.fix && (x.fix.act === 'decide' || x.fix.act === 'dispose') ? [x.fix.target] : [])))
    expect(of('CHK-49').filter((x) => decided.has(x.claims[0])).map((x) => x.id)).toEqual([])
  })
})

describe('CHK-50 outside filings', () => {
  it('raises FBAR, 1099-NEC and Form 3520 on their claims', () => {
    expect(Object.fromEntries(of('CHK-50').map((x) => [x.id, x.claims]))).toEqual({
      'chk:CHK-50:fbar_2025': ['diag:FBAR_OUTSIDE_RETURN', 'F8938.1.max'],
      'chk:CHK-50:1099nec_2025': ['diag:FORM_1099_FILING', 'SchC.I', 'SchC.J'],
      'chk:CHK-50:f3520_2023': ['py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/3'],
    })
    expect(m.findingsById['chk:CHK-50:fbar_2025'].why).toContain('2026-10-15')
    expect(m.findingsById['chk:CHK-50:1099nec_2025'].why).toContain('2026-02-02')
  })

  it('counts named contractor payees not paid by card, and calls it a heuristic', () => {
    const nec = m.findingsById['chk:CHK-50:1099nec_2025']
    expect(nec).toMatchObject({ signal: 'heuristic', evidence: ['ev-0487', 'ev-0488', 'SchC.J', 'D01'] })
    expect(nec.title).toContain('2 contractors paid 7,400')

    const byCard = structuredClone(packet)
    const page = byCard.documents.find((d) => d.id === 'D27')!.pages[0]
    page.printed_content = page.printed_content.replace('2,600.00, paid by ACH', '2,600.00, paid by credit card')
    expect(of('CHK-50', buildModel(byCard)).find((x) => x.id === 'chk:CHK-50:1099nec_2025')?.title).toContain('1 contractor paid 4,800')
  })
})

describe('CHK-52 diagnostics and alternatives', () => {
  const current = packet.return_versions[2].diagnostics.map((d) => d.code)
  const outside = ['FBAR_OUTSIDE_RETURN', 'FORM_1099_FILING']
  it('raises every current diagnostic CHK-50 does not cover, warnings as warnings', () => {
    expect(current).toHaveLength(11)
    for (const code of current.filter((c) => !outside.includes(c))) expect(m.findingsById[`chk:CHK-52:${code}`]?.claims[0]).toBe(`diag:${code}`)
    const warnings = of('CHK-52').filter((x) => x.severity === 'warning' && !x.id.includes('whatif:') && current.some((c) => x.id.endsWith(`:${c}`)))
    expect(warnings.map((x) => x.id.replace('chk:CHK-52:', '')).sort()).toEqual([
      'BROKER_SUMMARY_DETAIL_MISMATCH', 'CA_AMT_NOT_COMPUTED', 'DIGITAL_ASSET_BASIS_MISSING', 'DUE_DILIGENCE_REQUIRED',
      'LOW_CONFIDENCE_READ', 'QUESTIONNAIRE_SALES_CONFLICT',
    ])
  })
  it('raises the two diagnostics that vanished after v2', () => {
    const vanished = of('CHK-52').filter((x) => x.title.includes('disappeared')).map((x) => x.claims[0])
    expect(vanished.sort()).toEqual(['diag:K1_EXPECTED_NOT_RECEIVED', 'diag:SCORP_BASIS_INCOMPLETE'])
  })
  it('asks for a decision on every engine alternative', () => {
    const sev = Object.fromEntries(of('CHK-52').filter((x) => x.id.includes('whatif:')).map((x) => [x.claims[0], x.severity]))
    expect(sev).toEqual({
      'whatif:equipment_section179': 'warning', // dominant: fed 0, CA −1,050
      'whatif:hvac_improvement': 'warning', // treatment question
      'whatif:equipment_no_bonus': 'info',
      'whatif:standard_deduction': 'info',
      'whatif:penalty_annualized': 'info',
    })
    expect(m.findingsById['chk:CHK-52:whatif:equipment_section179'].stake).toEqual({ fed: 0, ca: -1050 })
    expect(m.findingsById['chk:CHK-52:whatif:hvac_improvement'].stake).toEqual({ fed: 3633, ca: 896 })
  })
})

describe('my checks', () => {
  const mine = m.findings.filter((x) => /^CHK-(01|02|03|04|16|17|18|48|49|50|52)$/.test(x.check))
  it('attach every finding to at least one existing claim and use deterministic ids', () => {
    for (const x of mine) {
      expect(x.claims.length, x.id).toBeGreaterThan(0)
      expect(x.id.startsWith(`chk:${x.check}:`), x.id).toBe(true)
    }
  })
  it('never run into a crash', () => {
    expect(m.findings.filter((x) => x.id.endsWith(':crashed') && mine.some((y) => y.check === x.check))).toEqual([])
  })
  it('never name canonical error ids', () => {
    for (const file of ['printed-vs-extracted', 'sum-vs-detail', 'duplicates', 'coverage']) {
      expect(readFileSync(path.join(__dirname, '../../../../src/lib/model/checks', `${file}.ts`), 'utf8')).not.toMatch(/E[0-9]{2}/)
    }
  })
})
