// Team, next steps, the sentence and summarize() over the real packet, on the MASKED model the browser builds.
// The values at the packet's "now" (season clock 2026-06-23T06:05:00Z, no acts) are pinned literals.
// One case server-renders the next-steps section, to pin the verb on a row's button (ACT_LABEL).
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildInput, canOpen, initialDraft } from '@/components/acts/draft'
import { actsOf, readPacket } from '../records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'
import type { ActInput } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import type { FilingView, State } from '@/lib/model/state'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { NextStepsSection } from '@/components/overview/next-steps'
import { nextOf, sentenceOf, summarize, teamOf } from '@/components/overview/overview-model'

const packet = maskPacket(readPacket()).masked
const model = buildModel(packet)
const viewer = (id: string) => viewerOf(packet, id)
const live = (id: string) => project(model, [], viewer(id), 'main')
const IDS = identities(packet).map((v) => v.id)

const PRIYA = { id: 'st-01', name: 'Priya Raman', inactiveUntil: null }
const AREA_ROWS: [string, string, number, number | null][] = [
  ['intake_and_engagement', 'Intake & identity', 70, 1.5],
  ['wages_and_stock_compensation', 'Wages & stock comp', 9, 3],
  ['investments_and_digital_assets', 'Investments & crypto', 22, 4],
  ['business', 'Business (Sch C)', 18, 3.5],
  ['rentals_and_sale', 'Rentals & sale', 12, 3.5],
  ['pass_throughs_and_basis', 'K-1s & basis', 7, 2],
  ['deductions_and_credits', 'Deductions & credits', 17, 2],
  ['california', 'California split', 3, 1.5],
  ['payments_and_filing', 'Payments & filing', 24, null],
]

// The RSU basis correction: it moves the amounts and needs the partner's cover.
const N1_FIX: ActInput = { type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to: 19100, reason: 'Adjusted basis per the D11 stock plan supplement', evidence: ['D11'], findings: ['chk:CHK-06:F8949.B.N1'] } }

describe('teamOf at the packet\'s "now"', () => {
  it('has one row per area, all with Priya, nothing signed and no hours', () => {
    expect(teamOf(model, live('st-01'))).toEqual(AREA_ROWS.map(([key, label, open, budget]) => ({
      key, label, href: `/queue?area=${key}&mine=0`, assignee: PRIYA, open, signoffs: 'none', hours: 0, budget, over: false,
    })))
  })

  it('counts open claims in the file only, never the area claim totals', () => {
    const state = live('st-01')
    const open = teamOf(model, state).reduce((n, r) => n + r.open, 0)
    expect(open).toBe(182)
    expect(open).toBe(summarize(model, state, viewer('st-01')).where.claims.parts.find((p) => p.key === 'open')?.count)
    expect(state.areas.reduce((n, a) => n + a.claims, 0)).toBe(818) // includes the 6 claims not yet in the file
  })
})

describe('nextOf at the packet\'s "now"', () => {
  const N1 = 'F8949.B.N1 uses basis 0; the D11 stock plan supplement gives adjusted basis 19,100 for lot RSU-2502'

  it('gives the preparer, reviewer and partner the RSU basis fix as the top item, and it can be opened', () => {
    for (const id of ['st-01', 'st-02', 'st-03']) {
      const state = live(id)
      const { top } = nextOf(model, state, viewer(id))
      expect(top, id).toMatchObject({
        what: N1, ref: 'F8949.B.N1',
        request: { type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis', to: 19100 }, findings: ['chk:CHK-06:F8949.B.N1'] },
      })
      const can = (i: ActInput) => authorize(model, state, i, viewer(id))
      expect(canOpen(top!.request!, { model, state, can }).auth.ok, id).toBe(true)
    }
  })

  it('lists the preparer\'s first five unmet checklist items, area by area', () => {
    expect(nextOf(model, live('st-01'), viewer('st-01')).items).toEqual([
      { kind: 'checklist', text: 'Intake & identity: Every document landed or disposed', context: 'area:intake_and_engagement', href: '/r/D01' },
      { kind: 'checklist', text: 'Intake & identity: Every finding resolved or decided', context: 'area:intake_and_engagement', href: '/r/chk%3ACHK-03%3AD07' },
      { kind: 'checklist', text: 'Intake & identity: Every engine diagnostic disposed', context: 'area:intake_and_engagement', href: '/r/diag%3AQUESTIONNAIRE_SALES_CONFLICT' },
      { kind: 'checklist', text: 'Intake & identity: Preparer then reviewer sign-off, both valid', context: 'area:intake_and_engagement', href: '/r/area%3Aintake_and_engagement' },
      { kind: 'checklist', text: 'Wages & stock comp: Every document landed or disposed', context: 'area:wages_and_stock_compensation', href: '/r/D10' },
    ])
  })

  it('has the reviewer wait for preparer sign-offs, and offers no client approval while the gate is blocked', () => {
    expect(nextOf(model, live('st-02'), viewer('st-02')).items).toEqual([
      { kind: 'waiting', text: 'Waiting for preparer sign-offs (9 areas)', context: 'return' },
    ])
  })

  it('gives the partner nothing more: no adjustments to cover, the gate is blocked and step 10 is not ok', () => {
    expect(nextOf(model, live('st-03'), viewer('st-03')).items).toEqual([])
  })

  it('sends Marcus, who owns no areas, to the first red step', () => {
    expect(nextOf(model, live('st-04'), viewer('st-04'))).toEqual({
      top: { what: 'Step 1: Engagement letter and consents signed', why: expect.any(String), doneWhen: expect.any(String), ref: 'D01', request: null },
      total: 0, items: [],
    })
  })

  it('gives the administrator a fresh copy only', () => {
    expect(nextOf(model, live('st-05'), viewer('st-05'))).toEqual({
      top: null, total: 1, items: [{ kind: 'fresh_copy', text: 'Start a fresh copy', context: 'return', href: '/firm#engagements' }],
    })
  })

  it('tells staff who are not active yet when they will be, and nothing else', () => {
    expect(nextOf(model, live('st-06'), viewer('st-06'))).toEqual({
      top: null, total: 1, items: [{ kind: 'inactive', text: 'You are not active until 2027-01-04; your actions are refused until then.', context: 'return' }],
    })
  })

  it('sends clients to the client portal', () => {
    for (const id of ['cu-01', 'cu-02']) {
      expect(nextOf(model, live(id), viewer(id)), id).toEqual({
        top: null, total: 1, items: [{ kind: 'client_portal', text: 'Clients use the client portal', context: 'return', href: '/client' }],
      })
    }
  })
})

describe('sentenceOf', () => {
  const state = live('st-01')
  const o = summarize(model, state, viewer('st-01'))

  it('reads the packet\'s "now" exactly', () => {
    expect(o.sentence).toBe(
      'Preparation. 0 of 12 required steps done; 12 reasons block filing; 114 days to the extended due date (Oct 15); $24,316 federal and $13,610 California at stake in errors.',
    )
  })

  it('words one reason, a passing gate, the original due date, the last day and a passed deadline', () => {
    const say = (clock: string, reasons: number, errors: number) =>
      sentenceOf(packet, { ...state, clock }, o.where, { ...o.blockers, ok: reasons === 0, total: reasons }, { ...o.money, errors: { ...o.money.errors, count: errors } })
    expect(say('2026-03-01T00:00:00Z', 1, 39)).toBe(
      'Preparation. 0 of 12 required steps done; 1 reason blocks filing; 45 days to the original due date (Apr 15); $24,316 federal and $13,610 California at stake in errors.',
    )
    expect(say('2026-10-14T23:59:59Z', 0, 0)).toBe('Preparation. 0 of 12 required steps done; every filing gate passes; 1 day to the extended due date (Oct 15).')
    expect(say('2026-10-15T00:00:00Z', 12, 0)).toBe('Preparation. 0 of 12 required steps done; 12 reasons block filing; past the extended due date.')
  })

  it('opens with the stage label', () => {
    expect(sentenceOf(packet, { ...state, stage: 'approval' }, o.where, o.blockers, o.money)).toMatch(/^Client approval\. 0 of 12 required steps done; /)
  })
})

describe('season leakage', () => {
  const FUTURE_FINDINGS = ['chk:CHK-03:D72', 'chk:CHK-25:msg-07', 'chk:CHK-25:msg-08', 'chk:CHK-25:msg-10', 'chk:CHK-53:tl-20', 'chk:CHK-60:late-payment']
  const NOT_YET_CLAIMS = ['D71', 'D72', 'msg-07', 'msg-08', 'msg-09', 'msg-10']

  it('fixture: these are the findings and claims after the season clock', () => {
    const state = live('st-01')
    expect(model.findings.filter((f) => f.knownSince > state.clock).map((f) => f.id).sort()).toEqual([...FUTURE_FINDINGS].sort())
    expect(Object.values(state.claims).filter((c) => c.flags.includes('not_yet_in_file')).map((c) => c.id).sort()).toEqual([...NOT_YET_CLAIMS].sort())
  })

  it('never names a finding or a claim the season clock has not reached, for any viewer', () => {
    for (const id of IDS) {
      const text = JSON.stringify(summarize(model, live(id), viewer(id)))
      for (const f of FUTURE_FINDINGS) expect(text, `${id} ${f}`).not.toContain(f)
      const words = new Set(text.split(/[^\w-]+/))
      for (const c of NOT_YET_CLAIMS) expect(words.has(c), `${id} ${c}`).toBe(false)
    }
  })

  it('never counts the claims not yet in the file', () => {
    const o = summarize(model, live('st-01'), viewer('st-01'))
    expect(o.where.claims.total).toBe(812)
    expect(o.where.claims.parts.reduce((n, p) => n + p.count, 0)).toBe(812)
    expect(o.team.reduce((n, r) => n + r.open, 0)).toBe(182)
  })
})

describe('replay', () => {
  const STEPS: [string, ActInput][] = [
    ['st-01', { type: 'time', target: 'area:intake_and_engagement', body: { hours: 2 } }],
    ['st-01', { type: 'signoff', target: 'area:investments_and_digital_assets', body: { level: 'preparer' } }],
    ['st-01', N1_FIX],
    ['st-01', { type: 'signoff', target: 'area:wages_and_stock_compensation', body: { level: 'preparer' } }],
    ['st-02', { type: 'signoff', target: 'area:wages_and_stock_compensation', body: { level: 'reviewer' } }],
    ['st-05', { type: 'assign', target: 'area:business', body: { assignee: 'st-02' } }],
    ['st-05', { type: 'assign', target: 'area:california', body: { assignee: 'st-06' } }],
    ['st-03', { type: 'clock', target: 'season', body: { to: '2026-07-01' } }],
  ]
  const LOG = actsOf(model, STEPS)
  const at = (i: number, id: string) => project(model, LOG.slice(0, i), viewer(id), 'main')

  it('summarizes an empty log exactly as the live dashboard with no acts', () => {
    for (const id of IDS) expect(summarize(model, at(0, id), viewer(id)), id).toEqual(summarize(model, live(id), viewer(id)))
  })

  it('summarizes every prefix for every viewer without throwing, and the clock never goes back', { timeout: 20_000 }, () => {
    let clock = 0
    let inFile = 0
    for (let i = 0; i <= LOG.length; i++) {
      for (const id of IDS) expect(() => summarize(model, at(i, id), viewer(id)), `${i} ${id}`).not.toThrow()
      const state = at(i, 'st-01')
      expect(Date.parse(state.clock)).toBeGreaterThanOrEqual(clock)
      clock = Date.parse(state.clock)
      const { total } = summarize(model, state, viewer('st-01')).where.claims
      expect(total).toBeGreaterThanOrEqual(inFile)
      inFile = total
    }
    expect(at(LOG.length, 'st-01').clock).toBe('2026-07-01T00:00:00Z')
  })

  it('shows sign-off phrases, hours, reassignments and inactive assignees in the team rows', () => {
    expect(teamOf(model, at(4, 'st-01')).find((r) => r.key === 'wages_and_stock_compensation')?.signoffs).toBe('prepared')
    const end = at(LOG.length, 'st-05')
    expect(teamOf(model, end).map((r) => [r.key, r.assignee.name, r.assignee.inactiveUntil, r.signoffs, r.hours, r.over])).toEqual([
      ['intake_and_engagement', 'Priya Raman', null, 'none', 2, true],
      ['wages_and_stock_compensation', 'Priya Raman', null, 'reviewed', 0, false],
      ['investments_and_digital_assets', 'Priya Raman', null, 'changed', 0, false],
      ['business', 'Daniel Ortiz', null, 'none', 0, false],
      ['rentals_and_sale', 'Priya Raman', null, 'none', 0, false],
      ['pass_throughs_and_basis', 'Priya Raman', null, 'none', 0, false],
      ['deductions_and_credits', 'Priya Raman', null, 'none', 0, false],
      ['california', 'Sam Adeyemi', '2027-01-04', 'none', 0, false],
      ['payments_and_filing', 'Priya Raman', null, 'none', 0, false],
    ])
    // msg-07 entered the file with the clock: it is open, and the team counts it.
    const o = summarize(model, end, viewer('st-05'))
    expect(o.team.reduce((n, r) => n + r.open, 0)).toBe(o.where.claims.parts.find((p) => p.key === 'open')?.count)
    expect(o.where.claims.total).toBe(813)
  })

  it('gives each role its items as the log advances', () => {
    expect(nextOf(model, at(4, 'st-02'), viewer('st-02')).items).toEqual([{
      kind: 'signoff_owed', text: 'Review sign-off owed: Wages & stock comp', context: 'area:wages_and_stock_compensation',
      request: { type: 'signoff', target: 'area:wages_and_stock_compensation', prefill: { level: 'reviewer' } },
    }])
    expect(nextOf(model, at(LOG.length, 'st-02'), viewer('st-02')).items).toEqual([
      { kind: 'waiting', text: 'Waiting for preparer sign-offs (8 areas)', context: 'return' },
    ])
    // The partner's row acts in place: the area sign-off at partner level, not a link to a claim page that has no sign-off.
    const partnerState = at(LOG.length, 'st-03')
    const partner = nextOf(model, partnerState, viewer('st-03')).items
    expect(partner).toEqual([{
      kind: 'partner_adjust', text: 'Partner sign-off needed: F8949.B.N1 (Federal −6,647, California −1,222)', context: 'F8949.B.N1',
      request: { type: 'signoff', target: 'area:investments_and_digital_assets', prefill: { level: 'partner' } },
    }])
    const canPartner = (i: ActInput) => authorize(model, partnerState, i, viewer('st-03'))
    expect(canOpen(partner[0].request!, { model, state: partnerState, can: canPartner }).auth.ok).toBe(true)
    const end = at(LOG.length, 'st-05')
    const { items } = nextOf(model, end, viewer('st-05'))
    expect(items).toEqual([
      { kind: 'over_budget', text: 'Intake & identity is over budget (2 of 1.5 h)', context: 'area:intake_and_engagement', href: '/firm#time' },
      { kind: 'reassign', text: 'Reassign Business (Sch C): Daniel Ortiz is not a preparer', context: 'area:business', request: { type: 'assign', target: 'area:business' } },
      { kind: 'reassign', text: 'Reassign California split: Sam Adeyemi is not active until 2027-01-04', context: 'area:california', request: { type: 'assign', target: 'area:california' } },
      { kind: 'fresh_copy', text: 'Start a fresh copy', context: 'return', href: '/firm#engagements' },
    ])
    // The reassign button opens: the draft starts from the current assignee, a known staff member.
    const can = (i: ActInput) => authorize(model, end, i, viewer('st-05'))
    expect(canOpen(items[1].request!, { model, state: end, can }).auth.ok).toBe(true)
  })

  it('lets the partner sign off an adjustment over 1,000 in place, at the claim\'s area', () => {
    const state = at(LOG.length, 'st-03')
    const [item] = nextOf(model, state, viewer('st-03')).items
    const req = item.request!
    // Not a link, and the area is the claim's own: the one the sign-off matrix and the partner desk sign.
    expect(item.href).toBeUndefined()
    expect(req.target).toBe(`area:${model.claims[item.context].area}`)
    // Submitting the dialog as it opens posts that sign-off; it covers the adjustment, so the row goes.
    const input = buildInput(req, initialDraft(req, model, state), state)
    expect(input).toEqual({ type: 'signoff', target: req.target, body: { level: 'partner' } })
    expect(authorize(model, state, input, viewer('st-03')).ok).toBe(true) // actsOf does not run authorize
    const signed = project(model, actsOf(model, [...STEPS, ['st-03', input]]), viewer('st-03'), 'main')
    expect(signed.adjusts.find((v) => v.target === item.context)?.partner_covered).toBe(true)
    expect(nextOf(model, signed, viewer('st-03')).items).toEqual([])
  })

  it('falls back to signing the whole return when the adjusted target has no area', () => {
    const state = at(LOG.length, 'st-03')
    // No real log reaches this: authorize only accepts claim targets. Hand-built to pin signTargets' area-or-return rule.
    const orphaned: State = { ...state, adjusts: state.adjusts.map((v) => ({ ...v, target: 'F8949.B.GONE' })) }
    expect(nextOf(model, orphaned, viewer('st-03')).items.map((i) => i.request)).toEqual([
      { type: 'signoff', target: 'return', prefill: { level: 'partner' } },
    ])
  })

  it('shows the partner\'s row as a "Sign off" button, not an "Open" link', () => {
    const state = at(LOG.length, 'st-03')
    const v = viewer('st-03')
    const ws: Workspace = {
      model, state, viewer: v, identities: identities(packet), engagement: 'main', packetSha: 'sha-test',
      post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, v),
      reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
    }
    const html = renderToString(h(WorkspaceContext, { value: ws }, h(NextStepsSection, { next: nextOf(model, state, v) })))
    const row = (html.match(/<li>([\s\S]*?)<\/li>/)?.[1] ?? '').replaceAll('<!-- -->', '')
    expect(row).toContain('Partner sign-off needed:')
    expect(row).toMatch(/<button(?![^>]* disabled="")[^>]*>Sign off<\/button>/)
    expect(row).not.toContain('href="/r/F8949.B.N1"')
  })

  it('moves the deadline in the sentence with the replayed clock', () => {
    expect(summarize(model, at(LOG.length, 'st-01'), viewer('st-01')).sentence).toMatch(
      /^Review\. 0 of 12 required steps done; 12 reasons block filing; 106 days to the extended due date \(Oct 15\); \$[\d,]+ federal and \$[\d,]+ California at stake in errors\.$/,
    )
  })
})

// ── Items that open late ────────────────────────────────────────────────────────────────
// At the packet's "now" the approval gate is blocked, step 10 is red and the only quality reviewer is inactive, so
// these start from a real projection of a real log and override only the pieces nextOf reads (gate, step 10,
// filings, clock). Each case also checks the opposite, so deleting or inverting the rule fails a test.

const gateOpen = (s: State): State => ({ ...s, gates: { ...s.gates, request_approval: { ok: true, reasons: [] } } })
const step10Done = (s: State): State => ({ ...s, steps: s.steps.map((st) => (st.n === 10 ? { ...st, ok: true, reasons: [] } : st)) })
const preparerSigns = (key: string): [string, ActInput] => ['st-01', { type: 'signoff', target: `area:${key}`, body: { level: 'preparer' } }]
const reviewerSigns = (key: string): [string, ActInput] => ['st-02', { type: 'signoff', target: `area:${key}`, body: { level: 'reviewer' } }]
const signoffRequest = (key: string): OpenActRequest => ({ type: 'signoff', target: `area:${key}`, prefill: { level: 'reviewer' } })
const owed = (key: string, label: string) => ({ kind: 'signoff_owed', text: `Review sign-off owed: ${label}`, context: `area:${key}`, request: signoffRequest(key) })
const WAGES = 'wages_and_stock_compensation'
const INVESTMENTS = 'investments_and_digital_assets'
const REQUEST_APPROVAL = { kind: 'request_approval', text: 'Request client approval', context: 'return', request: { type: 'request_approval', target: 'return' } }
const kindsFor = (state: State, id: string) => nextOf(model, state, viewer(id)).items.map((i) => i.kind)

describe('request_approval and return_signoff', () => {
  const LOG = actsOf(model, [
    preparerSigns(WAGES), //                                                         1: wages now owes its reviewer sign-off
    ['st-02', { type: 'request_approval', target: 'return', body: {} }], //          2: a request on the current amounts
    ['st-01', N1_FIX], //                                                            3: the amounts move, so the request is stale
    ['st-03', { type: 'signoff', target: 'return', body: { level: 'partner' } }], // 4: the partner signs the whole return
  ])
  const at = (i: number, id: string) => project(model, LOG.slice(0, i), viewer(id), 'main')
  const WAGES_OWED = owed(WAGES, 'Wages & stock comp')

  it('is offered once the gate opens, after the sign-off the reviewer owes, and it can be opened', () => {
    const blocked = at(1, 'st-02')
    expect(blocked.gates.request_approval.ok).toBe(false)
    expect(nextOf(model, blocked, viewer('st-02')).items).toEqual([WAGES_OWED])

    const state = gateOpen(blocked)
    expect(state.approval).toBeUndefined()
    const { items } = nextOf(model, state, viewer('st-02'))
    expect(items).toEqual([WAGES_OWED, REQUEST_APPROVAL])
    const can = (i: ActInput) => authorize(model, state, i, viewer('st-02'))
    expect(canOpen(items[1].request!, { model, state, can }).auth.ok).toBe(true)
  })

  it('is not offered again while the clients\' request is current, and is once the amounts move', () => {
    const current = gateOpen(at(2, 'st-02'))
    expect(current.approval?.current).toBe(true)
    expect(nextOf(model, current, viewer('st-02')).items).toEqual([WAGES_OWED])
    expect(nextOf(model, gateOpen(at(2, 'st-03')), viewer('st-03')).items).toEqual([])

    const stale = gateOpen(at(3, 'st-02'))
    expect(stale.approval?.current).toBe(false)
    expect(nextOf(model, stale, viewer('st-02')).items).toEqual([WAGES_OWED, REQUEST_APPROVAL])
  })

  it('is a reviewer and partner item only, never the preparer\'s, the administrator\'s or the quality reviewer\'s', () => {
    for (const id of ['st-01', 'st-04', 'st-05']) expect(kindsFor(gateOpen(at(1, id)), id), id).not.toContain('request_approval')
  })

  it('puts the partner\'s items in order: adjustment to cover, then client approval, then the return sign-off', () => {
    const state = (id: string) => at(3, id)
    expect(kindsFor(state('st-03'), 'st-03')).toEqual(['partner_adjust'])
    expect(kindsFor(gateOpen(state('st-03')), 'st-03')).toEqual(['partner_adjust', 'request_approval'])
    expect(kindsFor(step10Done(state('st-03')), 'st-03')).toEqual(['partner_adjust', 'return_signoff'])
    const { items } = nextOf(model, step10Done(gateOpen(state('st-03'))), viewer('st-03'))
    expect(items.map((i) => i.kind)).toEqual(['partner_adjust', 'request_approval', 'return_signoff'])
    expect(items[2]).toEqual({ kind: 'return_signoff', text: 'Partner sign-off on the return', context: 'return', request: { type: 'signoff', target: 'return', prefill: { level: 'partner' } } })
  })

  it('stops asking for the return sign-off once the partner has signed it, and not before step 10 is green', () => {
    const signed = at(4, 'st-03')
    expect(signed.signoffs.some((s) => s.target === 'return' && s.level === 'partner' && s.valid)).toBe(true)
    expect(kindsFor(step10Done(signed), 'st-03')).not.toContain('return_signoff')
    expect(kindsFor(at(3, 'st-03'), 'st-03')).not.toContain('return_signoff') // step 10 is red
    expect(kindsFor(step10Done(at(3, 'st-03')), 'st-03')).toContain('return_signoff')
    // The return-level partner sign-off covers every area in the team table.
    expect(teamOf(model, signed).map((r) => r.signoffs)).toEqual(Array(9).fill('partner'))
  })
})

describe('return_signoff after the amounts move', () => {
  it('asks again when a change after the partner signed made that sign-off stale', () => {
    const LOG = actsOf(model, [['st-03', { type: 'signoff', target: 'return', body: { level: 'partner' } }], ['st-01', N1_FIX]])
    const fresh = project(model, LOG.slice(0, 1), viewer('st-03'), 'main')
    const stale = project(model, LOG, viewer('st-03'), 'main')
    expect(fresh.signoffs.find((s) => s.target === 'return' && s.level === 'partner')?.valid).toBe(true)
    expect(kindsFor(step10Done(fresh), 'st-03')).not.toContain('return_signoff')
    expect(stale.signoffs.find((s) => s.target === 'return' && s.level === 'partner')?.valid).toBe(false)
    expect(kindsFor(step10Done(stale), 'st-03')).toContain('return_signoff')
    expect(teamOf(model, stale).some((r) => r.signoffs === 'changed')).toBe(true)
  })
})

describe('quality_wait', () => {
  // st-06 is active from 2027-01-04: a clock act puts the season past it, so the role rule applies.
  const state = project(model, actsOf(model, [['st-03', { type: 'clock', target: 'season', body: { to: '2027-01-05' } }]]), viewer('st-06'), 'main')
  const filing = (kind: FilingView['kind'], results: FilingView['results'][number]['status'][]): FilingView => ({
    seq: 7, kind, jurisdictions: ['federal', 'california'], actor: 'st-03', recorded_at: '2027-01-05T00:00:00Z',
    results: results.map((status, i) => ({ seq: 8 + i, jurisdiction: 'federal', status, errors: [] })),
  })
  const WAIT = { kind: 'quality_wait', text: 'Quality review opens after an accepted filing', context: 'return' }

  it('waits until a submitted filing is accepted', () => {
    expect(state.clock).toBe('2027-01-05T00:00:00Z')
    expect(nextOf(model, state, viewer('st-06'))).toEqual({ top: null, total: 1, items: [WAIT] })
    expect(nextOf(model, { ...state, filings: [filing('submit', ['accepted'])] }, viewer('st-06'))).toEqual({ top: null, total: 0, items: [] })
    expect(nextOf(model, { ...state, filings: [filing('submit', ['rejected', 'accepted'])] }, viewer('st-06')).items).toEqual([])
  })

  it('keeps waiting while the filing is rejected, held, unanswered or only an extension', () => {
    for (const filings of [[filing('submit', ['rejected'])], [filing('submit', ['held'])], [filing('submit', [])], [filing('extension', ['accepted'])]]) {
      expect(nextOf(model, { ...state, filings }, viewer('st-06')).items, JSON.stringify(filings)).toEqual([WAIT])
    }
  })
})

describe('waiting for preparer sign-offs', () => {
  const AREAS_SIGNED = AREA_ROWS.slice(0, 8).map(([key]) => key) // everything but payments_and_filing
  const reviewed = actsOf(model, [...AREAS_SIGNED.map(preparerSigns), ...AREAS_SIGNED.map(reviewerSigns)])

  it('counts one area as "1 area" and says nothing else once everything signed is reviewed', () => {
    const state = project(model, reviewed, viewer('st-02'), 'main')
    expect(nextOf(model, state, viewer('st-02')).items).toEqual([{ kind: 'waiting', text: 'Waiting for preparer sign-offs (1 area)', context: 'return' }])
  })

  it('swaps the waiting line for the sign-off the reviewer owes as soon as there is one', () => {
    const state = project(model, reviewed.slice(0, 15), viewer('st-02'), 'main') // the eighth review is still owed
    expect(nextOf(model, state, viewer('st-02')).items).toEqual([owed('california', 'California split')])
  })
})

describe('a sign-off the reviewer cannot give', () => {
  // st-02 adjusted a claim in investments, so the server refuses their review of that area (they prepared it).
  const LOG = actsOf(model, [['st-02', N1_FIX], preparerSigns(INVESTMENTS), preparerSigns(WAGES)])
  const state = project(model, LOG, viewer('st-02'), 'main')
  const can = (i: ActInput) => authorize(model, state, i, viewer('st-02'))

  it('is left out of the owed list, while the area they did not touch is still offered', () => {
    expect(state.claims['F8949.B.N1'].preparedBy).toContain('st-02')
    const refused = canOpen(signoffRequest(INVESTMENTS), { model, state, can }).auth
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toContain('You prepared F8949.B.N1')
    expect(nextOf(model, state, viewer('st-02')).items).toEqual([owed(WAGES, 'Wages & stock comp')])
  })

  it('refuses only the person who prepared it: the partner can still give that review', () => {
    const partner = project(model, LOG, viewer('st-03'), 'main')
    const canPartner = (i: ActInput) => authorize(model, partner, i, viewer('st-03'))
    expect(canOpen(signoffRequest(INVESTMENTS), { model, state: partner, can: canPartner }).auth.ok).toBe(true)
  })
})

describe('the administrator\'s list', () => {
  const OVER = AREA_ROWS.slice(0, 6) // six areas with a budget
  const LOG = actsOf(model, OVER.map(([key]): [string, ActInput] => ['st-01', { type: 'time', target: `area:${key}`, body: { hours: 5 } }]))
  const state = project(model, LOG, viewer('st-05'), 'main')

  it('stops at five items and keeps the fresh copy, so the fifth and sixth over-budget areas are the ones cut', () => {
    expect(teamOf(model, state).filter((r) => r.over)).toHaveLength(6)
    const { items, total } = nextOf(model, state, viewer('st-05'))
    expect(total).toBe(7) // six over-budget areas and the fresh copy
    expect(items.map((i) => i.text)).toEqual([
      'Intake & identity is over budget (5 of 1.5 h)',
      'Wages & stock comp is over budget (5 of 3 h)',
      'Investments & crypto is over budget (5 of 4 h)',
      'Business (Sch C) is over budget (5 of 3.5 h)',
      'Start a fresh copy',
    ])
    expect(items.slice(0, 4).every((i) => i.kind === 'over_budget' && i.href === '/firm#time')).toBe(true)
  })
})

// ── The cap ──────────────────────────────────────────────────────────────────────────────
// Lists stop at five (spec §4.3) and `total` says how many there were. The cap cuts the repeated rows (per area, per
// adjustment, per document) and never the one-off actions that advance the return: request_approval, return_signoff
// and fresh_copy. Those keep the end of the list, so the order the spec gives each role still reads top to bottom.
describe('the five-item cap', () => {
  const SIGNED = AREA_ROWS.slice(0, 8).map(([key]) => key) // everything but payments_and_filing

  it('counts a preparer\'s whole checklist in total and shows the first five', () => {
    const state = live('st-01')
    const unmet = state.areas.flatMap((a) => a.done.filter((d) => !d.ok)).length
    expect(unmet).toBeGreaterThan(5)
    const next = nextOf(model, state, viewer('st-01'))
    expect(next.total).toBe(unmet)
    expect(next.items).toHaveLength(5)
  })

  it('keeps the reviewer\'s client approval when eight sign-offs are owed, and counts all nine', () => {
    const state = gateOpen(project(model, actsOf(model, SIGNED.map(preparerSigns)), viewer('st-02'), 'main'))
    const next = nextOf(model, state, viewer('st-02'))
    expect(next.total).toBe(9)
    expect(next.items.map((i) => i.kind)).toEqual(['signoff_owed', 'signoff_owed', 'signoff_owed', 'signoff_owed', 'request_approval'])
    expect(next.items.slice(0, 4).map((i) => i.text)).toEqual(AREA_ROWS.slice(0, 4).map(([, label]) => `Review sign-off owed: ${label}`))
    expect(next.items[4]).toEqual(REQUEST_APPROVAL)
  })

  it('keeps the partner\'s client approval and return sign-off when six adjustments need cover, and counts all eight', () => {
    const base = project(model, actsOf(model, [['st-01', N1_FIX]]), viewer('st-03'), 'main')
    const real = base.adjusts.find((a) => a.target === 'F8949.B.N1')!
    expect(real.needs_partner && !real.partner_covered).toBe(true)
    const adjusts = Array.from({ length: 6 }, (_, i) => ({ ...real, seq: real.seq + i, target: `F8949.B.N${i + 1}` }))
    const state = step10Done(gateOpen({ ...base, adjusts }))
    const next = nextOf(model, state, viewer('st-03'))
    expect(next.total).toBe(8)
    expect(next.items.map((i) => i.kind)).toEqual(['partner_adjust', 'partner_adjust', 'partner_adjust', 'request_approval', 'return_signoff'])
    expect(next.items.slice(0, 3).map((i) => i.context)).toEqual(['F8949.B.N1', 'F8949.B.N2', 'F8949.B.N3'])
  })

  it('has total equal to the item count whenever nothing was cut', () => {
    for (const id of IDS) {
      const next = nextOf(model, live(id), viewer(id))
      if (next.items.length < 5) expect(next.total, id).toBe(next.items.length)
      expect(next.total, id).toBeGreaterThanOrEqual(next.items.length)
    }
  })
})

describe('logged hours', () => {
  const time = (hours: number): [string, ActInput] => ['st-01', { type: 'time', target: 'area:intake_and_engagement', body: { hours } }]
  const LOG = actsOf(model, [time(0.4), time(0.8), time(0.3), time(0.1)])
  const intake = (state: State) => teamOf(model, state).find((r) => r.key === 'intake_and_engagement')

  it('adds decimal hours exactly: 0.4 + 0.8 + 0.3 h meets the 1.5 h budget, it does not pass it', () => {
    expect(0.4 + 0.8 + 0.3).not.toBe(1.5) // the float noise the sum has to survive
    const state = project(model, LOG.slice(0, 3), viewer('st-05'), 'main')
    expect(state.areas.find((a) => a.key === 'intake_and_engagement')?.hours).toBe(1.5)
    expect(intake(state)).toMatchObject({ hours: 1.5, budget: 1.5, over: false })
    expect(nextOf(model, state, viewer('st-05')).items.map((i) => i.kind)).toEqual(['fresh_copy'])
  })

  it('rounds in teamOf too, whatever state it is given', () => {
    const live5 = project(model, [], viewer('st-05'), 'main')
    const noisy: State = { ...live5, areas: live5.areas.map((a) => (a.key === 'intake_and_engagement' ? { ...a, hours: 0.4 + 0.8 + 0.3 } : a)) }
    expect(intake(noisy)).toMatchObject({ hours: 1.5, over: false })
    expect(nextOf(model, noisy, viewer('st-05')).items.map((i) => i.kind)).toEqual(['fresh_copy'])
  })

  it('names the hours cleanly once they pass the budget', () => {
    const state = project(model, LOG, viewer('st-05'), 'main')
    expect(intake(state)).toMatchObject({ hours: 1.6, over: true })
    expect(nextOf(model, state, viewer('st-05')).items[0].text).toBe('Intake & identity is over budget (1.6 of 1.5 h)')
  })
})
