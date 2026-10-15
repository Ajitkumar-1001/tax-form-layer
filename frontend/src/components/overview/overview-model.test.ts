// Overview model over the masked packet the browser uses: at the packet's "now" (no acts) and over small logs.
import { describe, expect, it } from 'vitest'
import { collapseToRoots, findingOrder, groupOf, openFindings } from '@/components/queue/queue-model'
import { actsOf, readPacket } from '@/components/records/fixture'
import type { Act } from '@/lib/model/acts'
import { buildModel, type Model } from '@/lib/model/build'
import type { Finding } from '@/lib/model/checks/types'
import { MASK_RE, isMasked } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import { viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { blockersOf, moneyOf, whereOf } from './overview-model'

const model = buildModel(maskPacket(readPacket()).masked)
const at = (acts: Act[] = [], viewer = 'st-01') => project(model, acts, viewerOf(model.packet, viewer), 'main')
const now = at()

describe('whereOf', () => {
  it('lists the 12 required steps, none done, at the packet clock', () => {
    expect(now.clock).toBe('2026-06-23T06:05:00Z')
    const where = whereOf(now)
    expect(where.done).toBe(0)
    expect(where.steps).toEqual([
      { n: 1, label: 'Engagement letter and consents signed', ok: false },
      { n: 2, label: 'Identity verified', ok: false },
      { n: 3, label: 'Prior-year return reviewed', ok: false },
      { n: 4, label: 'All documents accounted for', ok: false },
      { n: 5, label: 'Prior-year variances explained', ok: false },
      { n: 6, label: 'Carryovers agreed to prior year', ok: false },
      { n: 7, label: 'Estimated payments agreed to IRS and FTB records', ok: false },
      { n: 8, label: 'Due diligence completed', ok: false },
      { n: 9, label: 'Diagnostics resolved', ok: false },
      { n: 10, label: 'Reviewer sign-off', ok: false },
      { n: 11, label: 'Partner sign-off', ok: false },
      { n: 12, label: 'Client approval and e-file authorization', ok: false },
    ])
  })

  it('counts only claims in the file: 812 of the 818', () => {
    const { claims } = whereOf(now)
    expect(Object.keys(now.claims)).toHaveLength(818)
    expect(claims).toEqual({
      total: 812,
      parts: [
        { key: 'checked', label: 'Checked by staff', tone: 'bg-success', count: 0 },
        { key: 'corrected', label: 'Corrected', tone: 'bg-info', count: 0 },
        { key: 'matches', label: 'Matches the page (automatic)', tone: 'bg-info/70', count: 350 },
        { key: 'unchecked', label: 'Not checked yet', tone: 'ring-1 ring-inset ring-foreground/55', count: 280 },
        { key: 'open', label: 'Has an open issue', tone: 'bg-danger', count: 182 },
      ],
    })
  })
})

describe('blockersOf', () => {
  const blockers = blockersOf(model, now)

  it('has one item per gate reason, in step order, with who acts and where it is fixed', () => {
    expect(blockers.ok).toBe(false)
    expect(blockers.total).toBe(now.gates.submit.reasons.length)
    expect(blockers.total).toBe(12)
    expect(blockers.beforeApproval).toBeNull()
    expect(blockers.items.map(({ step, label, context, who, href }) => ({ step, label, context, who, href }))).toEqual([
      { step: 1, label: 'Engagement letter and consents signed', context: 'D01', who: 'Priya Raman', href: '/r/D01' },
      { step: 2, label: 'Identity verified', context: 'household:ngozi#ssn', who: 'Priya Raman', href: '/r/household%3Angozi%23ssn' },
      { step: 3, label: 'Prior-year return reviewed', context: 'D06', who: 'Priya Raman', href: '/r/D06' },
      { step: 4, label: 'All documents accounted for', context: 'chk:CHK-48:D01', who: 'Priya Raman', href: '/r/chk%3ACHK-48%3AD01' },
      { step: 5, label: 'Prior-year variances explained', context: 'chk:CHK-26:F1040.1a', who: 'Priya Raman', href: '/r/chk%3ACHK-26%3AF1040.1a' },
      { step: 6, label: 'Carryovers agreed to prior year', context: 'F4797.8', who: 'Priya Raman', href: '/r/F4797.8' },
      { step: 7, label: 'Estimated payments agreed to IRS and FTB records', context: 'F1040.26', who: 'Priya Raman', href: '/r/F1040.26' },
      { step: 8, label: 'Due diligence completed', context: 'F8867.status', who: 'Priya Raman', href: '/r/F8867.status' },
      { step: 9, label: 'Diagnostics resolved', context: 'diag:DIGITAL_ASSET_BASIS_MISSING', who: 'Priya Raman', href: '/r/diag%3ADIGITAL_ASSET_BASIS_MISSING' },
      { step: 10, label: 'Reviewer sign-off', context: 'area:intake_and_engagement', who: 'Daniel Ortiz', href: '/filing#steps' },
      { step: 11, label: 'Partner sign-off', context: 'return', who: 'Helen Strand', href: '/filing#steps' },
      { step: 12, label: 'Client approval and e-file authorization', context: 'return', who: 'Helen Strand', href: '/filing#steps' },
    ])
  })

  it("keeps each step's first reason in full: the gate's reason without its step prefix", () => {
    expect(blockers.items.map((b) => b.text)).toEqual([
      'Not verified to the signed document: D01, D02',
      'Identity not verified D or T (or decided with authority): household:ngozi#ssn, household:ngozi#dob, household:erik#ssn and 5 more',
      'Not disposed: D06, D07, py:/prior_preparer_workpaper/notes/0 and 8 more',
      'Document not accounted for: chk:CHK-48:D01, chk:CHK-48:D02, chk:CHK-48:D03 and 13 more',
      'Prior-year swing not explained: chk:CHK-26:F1040.1a, chk:CHK-26:F1040.25a, chk:CHK-26:F1040.26 and 16 more',
      'Carryover not agreed to prior year: F4797.8, SchD.6, SchD.14 and 3 more',
      'Not agreed to the IRS or FTB record: F1040.26, F540NR.72',
      "Due diligence not documented (F8867 'Not completed'): F8867.status",
      'Engine diagnostic or alternative without a disposition: diag:DIGITAL_ASSET_BASIS_MISSING, diag:AMT_CREDIT_CARRYFORWARD, diag:AOTC_PHASED_OUT and 15 more',
      'No valid reviewer sign-off: area:intake_and_engagement, area:wages_and_stock_compensation, area:investments_and_digital_assets and 6 more',
      'No valid partner sign-off on the return: return',
      'Client approval not requested: return',
    ])
    blockers.items.forEach((b, i) => {
      expect(now.gates.submit.reasons[i]).toEqual({ text: `Step ${b.step} (${b.label}): ${b.text}`, ref: b.context })
    })
  })

  it('quotes blocking review notes in full after the steps, so no masked token is cut, and still matches the gate', () => {
    const token = model.packet.household.people.find((p) => p.id === 'theo')!.ssn
    expect(isMasked(token)).toBe(true)
    const text = `The dependent SSN on the return does not match the card in D05; confirm ${token} with the client.`
    // The gate clips note text to 80 characters: this token straddles the cut.
    expect(text.indexOf('«')).toBeLessThan(79)
    expect(text.indexOf('»')).toBeGreaterThan(79)
    const acts = actsOf(model, [
      ['st-02', { type: 'note', target: 'F8949.B.N1', body: { kind: 'review_note', text, blocking: true } }],
      ['st-02', { type: 'note', target: 'return', body: { kind: 'review_note', to: 'st-04', text: 'Tie the extension payment to the IRS transcript.', blocking: true } }],
    ])
    const state = at(acts)
    const b = blockersOf(model, state)
    expect(b.total).toBe(state.gates.submit.reasons.length)
    expect(b.total).toBe(14)
    expect(b.items.slice(12)).toEqual([
      { step: null, label: 'Blocking review note by Daniel Ortiz', text, context: 'act:1', who: 'Priya Raman', href: '/r/act%3A1' },
      { step: null, label: 'Blocking review note by Daniel Ortiz', text: 'Tie the extension payment to the IRS transcript.', context: 'act:2', who: 'Marcus Bell', href: '/r/act%3A2' },
    ])
    const gateCopy = state.gates.submit.reasons[12].text
    expect(gateCopy).toContain('«')
    expect(gateCopy).not.toContain(token)
    for (const item of b.items) expect((item.text.match(/«/g) ?? []).length, item.context).toBe((item.text.match(MASK_RE) ?? []).length)
  })

  it('follows reassignment for steps 1 to 9', () => {
    const state = at(actsOf(model, [['st-05', { type: 'assign', target: 'area:intake_and_engagement', body: { assignee: 'st-04' } }]]))
    const who = blockersOf(model, state).items.map((b) => b.who)
    expect(who.slice(0, 5)).toEqual(['Marcus Bell', 'Marcus Bell', 'Marcus Bell', 'Marcus Bell', 'Priya Raman'])
  })

  it('names the clients still to sign once approval is requested', () => {
    const state = at(actsOf(model, [['st-03', { type: 'request_approval', target: 'return', body: {} }]]))
    expect(blockersOf(model, state).items.find((b) => b.step === 12)).toEqual({
      step: 12, label: 'Client approval and e-file authorization', text: 'Not yet approved by: cu-01, cu-02', context: 'cu-01',
      who: 'Ngozi Okafor and Erik Lindqvist', href: '/filing#steps',
    })
  })

  it('adds the partner sign-offs owed before client approval', () => {
    const state = at(actsOf(model, [
      ['st-01', { type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to: 19100, reason: 'Adjusted basis from the D11 stock plan supplement', evidence: ['D11'] } }],
    ]))
    expect(state.adjusts[0]).toMatchObject({ needs_partner: true, partner_covered: false, reverted: false })
    expect(blockersOf(model, state).beforeApproval).toBe('Before client approval also: partner sign-off for 1 adjustment over $1,000')
  })
})

describe('moneyOf', () => {
  // The masked model the browser uses, at the packet's "now" (2026-06-23T06:05:00Z) with no acts.
  const { masked } = maskPacket(readPacket())
  const model = buildModel(masked)
  const state = project(model, [], viewerOf(masked, 'st-01'))
  const money = moneyOf(model, state)

  const open = openFindings(model, state)
  const { hidden } = collapseToRoots(model, open)
  const roots = open.filter((f) => !hidden.has(f.id))
  const isError = (f: Finding) => groupOf(model, f) === 'contradicted'
  const isUnproven = (f: Finding) => groupOf(model, f) === 'weak' || groupOf(model, f) === 'swings'
  const isChoice = (f: Finding) => groupOf(model, f) === 'decisions' && model.claims[f.claims[0]]?.kind === 'whatif'

  it('pins errors: count, exposure, net and the top 5 picks in findingOrder', () => {
    expect(state.clock).toBe('2026-06-23T06:05:00Z')
    expect(money.errors.count).toBe(39)
    expect(money.errors.exposure).toEqual({ fed: 24316, ca: 13610 })
    expect(money.errors.net).toEqual({ fed: -16882, ca: -5120 })
    expect(money.errors.top.map(({ finding, claim, fed, ca }) => ({ finding, claim, fed, ca }))).toEqual([
      { finding: 'chk:CHK-06:F8949.B.N1', claim: 'F8949.B.N1', fed: -6647, ca: -1222 },
      { finding: 'chk:CHK-06:F8949.B.N3', claim: 'F8949.B.N3', fed: -6647, ca: -1222 },
      { finding: 'chk:CHK-44:SchCA540NR.1.E', claim: 'SchCA540NR.1.E', fed: 0, ca: -5685 },
      { finding: 'chk:CHK-07:SchC.1', claim: 'SchC.1', fed: -4402, ca: -384 },
      { finding: 'chk:CHK-19:F540NR.72', claim: 'F540NR.72', fed: 0, ca: 3500 },
    ])
    for (const p of money.errors.top) expect(p.title).toBe(model.findingsById[p.finding].title)
  })

  it('puts F8949.B.N1 before F8949.B.N3: equal stakes and severity, so the finding id breaks the tie', () => {
    const [n1, n3] = ['chk:CHK-06:F8949.B.N1', 'chk:CHK-06:F8949.B.N3'].map((id) => model.findingsById[id])
    expect(n1.stake).toEqual(n3.stake)
    expect(n1.severity).toBe(n3.severity)
    expect(money.errors.top.findIndex((p) => p.finding === n1.id)).toBeLessThan(money.errors.top.findIndex((p) => p.finding === n3.id))
  })

  it('pins unproven, choices and already corrected', () => {
    expect(money.unproven).toEqual({ count: 70, exposure: { fed: 4464, ca: 605 } })
    expect(money.choices).toBe(5)
    expect(money.adjusted).toEqual({ fed: 0, ca: 0 })
  })

  it('keeps errors, unproven and choices disjoint', () => {
    const counted = roots.filter((f) => isError(f) || isUnproven(f) || isChoice(f))
    expect(money.errors.count + money.unproven.count + money.choices).toBe(counted.length)
    for (const p of money.errors.top) expect(isError(model.findingsById[p.finding])).toBe(true)
  })

  it('never adds choices to any total', () => {
    const choices = roots.filter(isChoice)
    expect(choices.some((f) => (f.stake?.fed ?? 0) !== 0)).toBe(true) // the standard deduction option is +12,306
    const inflated: Model = { ...model, findings: model.findings.map((f) => (isChoice(f) ? { ...f, stake: { fed: 1e9, ca: 1e9 } } : f)) }
    expect(moneyOf(inflated, state)).toEqual(money)
  })

  it('makes exposure.fed the sum of |fed| over every error pick, one pick per primary claim', () => {
    const byClaim = new Map<string, Finding>()
    for (const f of roots.filter(isError)) {
      const k = f.claims[0] ?? f.id
      const best = byClaim.get(k)
      if (!best || findingOrder(f, best) < 0) byClaim.set(k, f)
    }
    const picks = [...byClaim.values()]
    expect(picks).toHaveLength(29)
    expect(money.errors.exposure.fed).toBe(picks.reduce((s, f) => s + Math.abs(f.stake?.fed ?? 0), 0))
    expect(money.errors.exposure.ca).toBe(picks.reduce((s, f) => s + Math.abs(f.stake?.ca ?? 0), 0))
  })

  it('counts nothing that arrives after the season clock', () => {
    const later = model.findings.filter((f) => f.knownSince > state.clock)
    expect(later.map((f) => f.id).sort()).toEqual([
      'chk:CHK-03:D72', 'chk:CHK-25:msg-07', 'chk:CHK-25:msg-08', 'chk:CHK-25:msg-10', 'chk:CHK-53:tl-20', 'chk:CHK-60:late-payment',
    ])
    expect(money.errors.top.some((p) => later.some((f) => f.id === p.finding))).toBe(false)
    expect(moneyOf({ ...model, findings: model.findings.filter((f) => f.knownSince <= state.clock) }, state)).toEqual(money)
  })

  it('moves a fixed error out of errors and into already corrected', () => {
    const acts = actsOf(model, [['st-01', {
      type: 'adjust', target: 'F8949.B.N1',
      body: { field: 'basis', to: 19100, reason: 'Adjusted basis per the D11 stock plan supplement', evidence: ['D11'], findings: ['chk:CHK-06:F8949.B.N1'] },
    }]])
    const after = project(model, acts, viewerOf(masked, 'st-01'))
    const m = moneyOf(model, after)
    expect(m.adjusted).toEqual({ fed: after.totals.federal.delta, ca: after.totals.california.delta })
    expect(m.adjusted).toEqual({ fed: -6647, ca: -1222 })
    expect(m.errors.count).toBe(38)
    expect(m.errors.top.map((p) => p.finding)).not.toContain('chk:CHK-06:F8949.B.N1')
  })
})
