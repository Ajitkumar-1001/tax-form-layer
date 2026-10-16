// filing-status.ts over the masked model the browser uses (spec 3, §13): refs in words, in-page links, step owners, the
// status line, act reasons (gateBlock, apartFromGate) and the sign-off view. Logs are derived like the server (without
// authorize) and re-projected as the viewer after each act (playOn).
import { describe, expect, it } from 'vitest'
import {
  apartFromGate, type FilingStatus, filingStatus, gateBlock, itemHref, type Jur, labelOf, nameOf, PLAIN_WHAT, plainWhat,
  type SignoffCellView, signoffView, stepFix, stepOwner,
} from '@/components/filing/filing-status'
import { blockersOf } from '@/components/overview/overview-model'
import { latestSignoffs } from '@/components/queue/queue-model'
import type { OpenActRequest } from '@/components/workspace/types'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel, type Model } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import { isMasked } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import type { ApprovalView, AuthResult, State, Viewer } from '@/lib/model/state'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { readPacket } from '../records/fixture'

// ── Shared helpers (the Task 4 cases reuse them) ─────────────────────────────────────────────

const model = buildModel(maskPacket(readPacket()).masked)
const viewer = (id: string): Viewer => viewerOf(model.packet, id)
const at = (id: string, acts: Act[] = []): State => project(model, acts, viewer(id))
const can = (state: State, id: string) => (i: ActInput): AuthResult => authorize(model, state, i, viewer(id))

type Step = [string, ActInput] | Act

/**
 * §13: derives like filing-logic.test.ts's `play` (no authorize), from the state projected as viewerId, and re-projects as
 * viewerId after each act. A raw Act (an agency result) is appended as given with its seq set, as screens-render's `log`.
 */
function playOn(model: Model, viewerId: string, steps: Step[]): State {
  const people = identities(model.packet)
  const acts: Act[] = []
  let state = project(model, acts, viewerOf(model.packet, viewerId))
  for (const s of steps) {
    const seq = acts.length + 1
    if (!Array.isArray(s)) {
      acts.push({ ...s, seq })
      state = project(model, acts, viewerOf(model.packet, viewerId))
      continue
    }
    const [actor, input] = s
    acts.push({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: state.clock, season_at: state.clock, actor,
      actor_role: people.find((v) => v.id === actor)?.role ?? 'system',
      type: input.type, target: input.target, refs: refsOf(input), body: input.body as Record<string, unknown>,
      derived: deriveFor(model, state, input), batch_id: null, hash: '', prev_hash: '',
    })
    state = project(model, acts, viewerOf(model.packet, viewerId))
  }
  return state
}

const adjustSchC: ActInput = {
  type: 'adjust', target: 'SchC.1',
  body: { field: 'value', to: 151300, reason: 'Paywell 1099-K is already inside the Atlas deposits', evidence: ['D14'] },
}
const signoff = (target: string, level: 'preparer' | 'reviewer' | 'partner'): ActInput => ({ type: 'signoff', target, body: { level } })
const agency = (fileSeq: number, jurisdiction: Jur, status: 'accepted' | 'rejected' | 'held', errors: { code: string; message: string }[] = []): Act => ({
  seq: 0, id: 'a', engagement: 'test', recorded_at: '2026-10-14T12:00:00Z', season_at: '2026-07-14T16:22:00Z', actor: 'system', actor_role: 'system',
  type: 'agency_result', target: `act:${fileSeq}`, refs: [`act:${fileSeq}`], body: { jurisdiction, status, errors, rule: 'disclosed test rule' },
  derived: status === 'accepted' ? { retain_until: '2033-07-14T16:22:00Z' } : {}, batch_id: null, hash: 'x', prev_hash: '',
})
const request: [string, ActInput] = ['st-03', { type: 'request_approval', target: 'return', body: {} }]
const approve = (who: string): [string, ActInput] => [who, { type: 'client_approve', target: 'act:1', body: { pin: '12345' } }]
const submit: [string, ActInput] = ['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal', 'california'] } }]
const FILED: Step[] = [
  request, approve('cu-01'), approve('cu-02'), submit, agency(4, 'federal', 'accepted'), agency(4, 'california', 'accepted'),
  ['st-03', { type: 'clock', target: 'season', body: { to: '2028-01-27T00:00:00Z' } }],
]
const REJECTED: Step[] = [
  submit, agency(1, 'federal', 'rejected', [{ code: 'R0000-504-02', message: 'Dependent TIN mismatch' }]),
  agency(1, 'california', 'held', [{ code: 'STATE-HOLD', message: 'held' }]),
]

// State overrides (§13 "Test setup", as overview-summary.test.ts does) for states the logs cannot reach cheaply.
const withSteps = (s: State, ok: (n: number) => boolean): State => ({
  ...s, steps: s.steps.map((st) => (ok(st.n) ? { ...st, ok: true, reasons: [] } : st)),
})
const withGates = (s: State, gates: Partial<Record<'request_approval' | 'submit', boolean>>): State => {
  const gate = (g: 'request_approval' | 'submit') =>
    gates[g] === undefined ? s.gates[g] : gates[g] ? { ok: true, reasons: [] } : { ...s.gates[g], ok: false }
  return { ...s, gates: { request_approval: gate('request_approval'), submit: gate('submit') } }
}
const withApproval = (s: State, approval: ApprovalView | undefined): State => ({ ...s, approval })

// ── Refs in words, links and owners ────────────────────────────────────────────────────────

describe('labelOf', () => {
  it('names a ref by the first of: refLabel, a person, targetText, a packet location, the ref itself', () => {
    expect(labelOf(model, 'D01')).toBe('Engagement letter, tax year 2025 (signed)')
    expect(labelOf(model, 'area:intake_and_engagement')).toBe('Intake & identity')
    expect(labelOf(model, 'return')).toBe('the return')
    expect(labelOf(model, 'act:12')).toBe('change 12')
    expect(labelOf(model, 'cu-01')).toBe('Ngozi Okafor')
    expect(labelOf(model, 'st-02')).toBe('Daniel Ortiz')
    expect(labelOf(model, 'chk:CHK-48:D01')).toBe('D01 is used in v3 but lands on no line')
    expect(labelOf(model, 'agency:/efile')).toBe('Tax agency record')
    expect(labelOf(model, 'py:/prior_preparer_workpaper/notes/0')).toMatch(/^Woodworks S corp basis/)
    expect(labelOf(model, 'nope:x')).toBe('nope:x')
  })
})

describe('plainWhat', () => {
  it("shows the model's three coded phrases in words and every other phrase as it is", () => {
    expect(plainWhat('Identity not verified D or T (or decided with authority)')).toBe(
      'Identity not verified to a document or a third-party record, or decided with authority',
    )
    expect(plainWhat("Due diligence not documented (F8867 'Not completed')")).toBe('Due diligence not documented: Form 8867 says not completed')
    expect(plainWhat('Identity (step 2) not green')).toBe('Step 2 (identity) not done')
    expect(plainWhat('Not disposed')).toBe('Not disposed')
    // Keyed by the model's exact text: all three phrases are step reasons on the empty log.
    const whats = at('st-01').steps.flatMap((s) => s.reasons.map((r) => r.what))
    for (const what of Object.keys(PLAIN_WHAT)) expect(whats).toContain(what)
  })
})

describe('itemHref', () => {
  it('sends steps, areas, the return and clients to this page, and any other item to its trace page', () => {
    expect(itemHref(8, 'step:2')).toBe('#step-2')
    expect(itemHref(10, 'area:business')).toBe('#signoff-business')
    expect(itemHref(11, 'return')).toBe('#signoff-return')
    expect(itemHref(12, 'return')).toBe('#approval')
    expect(itemHref(12, 'cu-01')).toBe('#approval')
    expect(itemHref(12, 'cu-02')).toBe('#approval')
    expect(itemHref(1, 'D01')).toBe('/r/D01')
  })
})

describe('stepFix', () => {
  it("goes to the first item of steps 1 to 9 on the empty log, then the sign-offs, the return's sign-off and approval", () => {
    expect(at('st-01').steps.map((s) => stepFix(s).href)).toEqual([
      '/r/D01', '/r/household%3Angozi%23ssn', '/r/D06', '/r/chk%3ACHK-48%3AD01', '/r/chk%3ACHK-26%3AF1040.1a', '/r/F4797.8',
      '/r/F1040.26', '/r/F8867.status', '/r/diag%3ADIGITAL_ASSET_BASIS_MISSING', '#matrix', '#signoff-return', '#approval',
    ])
  })

  it('sends step 11 to the partner desk after an adjustment over 1,000', () => {
    const step11 = playOn(model, 'st-01', [['st-01', adjustSchC]]).steps.find((s) => s.n === 11)!
    expect(stepFix(step11).href).toBe('#desk')
  })
})

describe('stepOwner', () => {
  it("is the assignee of the area of the step's first item, so it follows reassignment", () => {
    const empty = at('st-01')
    expect(empty.steps.filter((s) => s.n <= 9).map((s) => stepOwner(model, empty, s))).toEqual(Array(9).fill('st-01'))
    const assigned = playOn(model, 'st-01', [['st-05', { type: 'assign', target: 'area:intake_and_engagement', body: { assignee: 'st-04' } }]])
    expect(stepOwner(model, assigned, assigned.steps[0])).toBe('st-04')
    // The same rule feeds the status line (stepOwner) and the "Who acts:" column (blockersOf): the two copies agree.
    for (const s of [empty, assigned]) {
      const work = s.steps.filter((step) => step.n <= 9)
      expect(work.map((step) => nameOf(model, stepOwner(model, s, step))))
        .toEqual(work.map((step) => blockersOf(model, s).items.find((b) => b.step === step.n)!.who))
    }
  })
})

// ── The status line ────────────────────────────────────────────────────────────────────────

/** The status line as §3.1 renders it, in plain text. */
const line = (s: FilingStatus): string => `${s.headline} ${s.next ? `Your next step for filing: ${s.next.text}.` : (s.none?.text ?? '')}`
const statusOf = (state: State, id: string): FilingStatus => filingStatus(model, state, viewer(id))
/** A request on the current or changed amounts that no client has approved yet. */
const pending = (current: boolean): ApprovalView => ({
  request_seq: 1, requested_by: 'st-03', amounts_hash: 'x', current, approvals: [], complete: false,
})

describe('filingStatus', () => {
  it('reads the pinned sentence for each staff viewer on the empty log (§3.4)', () => {
    expect(['st-01', 'st-02', 'st-03', 'st-04', 'st-05', 'st-06'].map((id) => line(statusOf(at(id), id)))).toEqual([
      'Filing is blocked: 0 of 12 required steps done. Your next step for filing: step 1, Engagement letter and consents signed.',
      'Filing is blocked: 0 of 12 required steps done. No review sign-off is owed yet: waiting for preparer sign-offs (9 areas).',
      'Filing is blocked: 0 of 12 required steps done. Nothing for filing needs you yet: the reviewer signs every area first (step 10).',
      'Filing is blocked: 0 of 12 required steps done. Nothing for filing is assigned to you: Priya Raman clears step 1 first.',
      'Filing is blocked: 0 of 12 required steps done. Nothing for filing is yours: the firm administrator is read-only on the return.',
      'Filing is blocked: 0 of 12 required steps done. You are not active until 2027-01-04; your actions are refused until then.',
    ])
    expect(statusOf(at('st-01'), 'st-01').next).toEqual({ text: 'step 1, Engagement letter and consents signed', href: '#step-1' })
  })

  it("reads the filed and rejected sentences on screens-render's logs (§3.4)", () => {
    const filed = statusOf(playOn(model, 'st-03', FILED), 'st-03')
    expect(line(filed)).toBe(
      'Filed and accepted: federal and California. The return is frozen; any change needs an amendment. Nothing for filing needs you: open an amendment only if a value must change.',
    )
    expect(filed.none?.link).toEqual({ text: 'open an amendment', href: '#filings' })
    for (const id of ['st-01', 'st-02', 'st-04', 'st-05', 'st-06']) {
      expect(statusOf(playOn(model, id, FILED), id).none, id).toEqual({ text: 'Nothing for filing needs you: the return is filed.', link: null })
    }
    expect(line(statusOf(playOn(model, 'st-03', REJECTED), 'st-03'))).toBe(
      'E-file rejected: federal R0000-504-02; California held. Filing is blocked: 0 of 12 required steps done. Nothing for filing needs you yet: the reviewer signs every area first (step 10).',
    )
  })

  it('sends the preparer to re-sign the sign-off her adjustment reopened', () => {
    const state = playOn(model, 'st-01', [['st-01', signoff('area:business', 'preparer')], ['st-01', adjustSchC]])
    expect(statusOf(state, 'st-01').next).toEqual({ text: 're-sign your reopened preparer sign-off on Business (Sch C)', href: '#signoff-business' })
  })

  it("puts a blocking review note on the preparer's work first, and counts it in the headline", () => {
    const token = model.packet.household.people.find((p) => p.id === 'theo')!.ssn
    expect(isMasked(token)).toBe(true)
    const text = `The dependent SSN on the return does not match the card in D05; confirm ${token} with the client.`
    const state = playOn(model, 'st-01', [['st-02', { type: 'note', target: 'F8949.B.N1', body: { kind: 'review_note', text, blocking: true } }]])
    const s = statusOf(state, 'st-01')
    expect(s.next?.text).toMatch(/^answer Daniel Ortiz's blocking review note on /)
    expect(s.next?.href).toBe('/r/act%3A1')
    expect(s.headline).toMatch(/; 1 blocking review note is open\.$/)
    expect(line(s)).not.toContain('«')
  })

  it('reads the approval and submit states over overridden steps, gates and approval (§13)', () => {
    const ready = statusOf(withGates(withSteps(at('st-02'), (n) => n <= 11), { request_approval: true }), 'st-02')
    expect(ready.headline).toBe('Ready to request client approval: 11 of 12 required steps done.')
    expect(ready.next).toEqual({ text: 'request client approval', href: '#approval' })

    const asked = withGates(withSteps(at('st-03'), (n) => n <= 11), { request_approval: true })
    expect(statusOf(withApproval(asked, pending(false)), 'st-03').headline).toBe(
      'Client approval must be requested again: an amount changed after the request.',
    )
    expect(statusOf(withApproval(asked, pending(true)), 'st-03').headline).toBe(
      'Waiting for client approval: Ngozi Okafor and Erik Lindqvist have not approved yet.',
    )

    const submitOk = withGates(at('st-03'), { request_approval: true, submit: true })
    expect(can(submitOk, 'st-03')(submit[1]).ok).toBe(true) // the partner row's own condition: authorize allows the submit
    const s = statusOf(submitOk, 'st-03')
    expect(s.headline).toBe('Ready to submit: all 12 required steps are done.')
    expect(s.next).toEqual({ text: 'submit the return', href: '#approval' })
  })

  it('ends with what the return waits for when the viewer has nothing to do (st-04 works no area)', () => {
    const yet = (s: State) => statusOf(s, 'st-04').none?.text
    const base = at('st-04')
    expect(yet(withSteps(base, (n) => n <= 9))).toBe('Nothing for filing needs you yet: the reviewer signs every area first (step 10).')
    expect(yet(withSteps(base, (n) => n <= 10))).toBe('Nothing for filing needs you yet: the partner signs next.')
    const eleven = withSteps(base, (n) => n <= 11)
    expect(yet(eleven)).toBe('Nothing for filing needs you yet: the reviewer or partner requests client approval next.')
    expect(yet(withApproval(eleven, pending(true)))).toBe('Nothing for filing needs you yet: waiting for the clients to approve.')
    // Keeps the current request: without one, "requests client approval next" matches first.
    expect(yet(withGates(withApproval(eleven, pending(true)), { submit: true }))).toBe('Nothing for filing needs you yet: the partner submits next.')
  })

  it('never asks to fix a rejection when the agencies only held the filing', () => {
    const held = playOn(model, 'st-03', [submit, agency(1, 'federal', 'held'), agency(1, 'california', 'held')])
    const s = statusOf(withGates(held, { request_approval: true, submit: true }), 'st-03')
    expect(s.headline).toMatch(/^E-file held: federal and California\./)
    expect(s.next).toEqual({ text: 'submit the return', href: '#approval' })
  })

  describe('a partial freeze: federal accepted, California held (P18)', () => {
    const PARTIAL: Step[] = [request, approve('cu-01'), approve('cu-02'), submit, agency(4, 'federal', 'accepted'), agency(4, 'california', 'held')]
    const HEADLINE = 'E-file held: California. Filed and accepted: federal. California is not filed and accepted yet.'
    const CA = 'area:california'
    const adjustCA: ActInput = {
      type: 'adjust', target: 'SchCA540NR.1.E',
      body: { field: 'value', to: 129569, reason: 'Box 16 is full-year; only wages after the 2025-07-14 move are California-source', evidence: ['D73'] },
    }
    // California was signed before the submit, and the preparer's fix to the open jurisdiction reopens both sign-offs.
    const REOPENED: Step[] = [
      request, approve('cu-01'), approve('cu-02'), ['st-01', signoff(CA, 'preparer')], ['st-02', signoff(CA, 'reviewer')],
      submit, agency(6, 'federal', 'accepted'), agency(6, 'california', 'held'), ['st-01', adjustCA],
    ]

    it('sends the partner to open an amendment and everyone else to wait for it while a step is red', () => {
      expect(can(playOn(model, 'st-01', REOPENED.slice(0, -1)), 'st-01')(adjustCA).ok).toBe(true) // California is still open
      const as = (id: string) => playOn(model, id, REOPENED)
      const partner = statusOf(as('st-03'), 'st-03')
      expect(line(partner)).toBe(`${HEADLINE} Your next step for filing: open an amendment.`)
      expect(partner.next).toEqual({ text: 'open an amendment', href: '#filings' })
      for (const [id, level] of [['st-01', 'preparer'], ['st-02', 'reviewer']] as const) {
        const state = as(id)
        // Their own sign-off reopened, but authorize's frozenFor refuses the re-sign: only an amendment moves filing on.
        expect(latestSignoffs(state.signoffs).find((s) => s.actor === id)?.valid, id).toBe(false)
        expect(can(state, id)(signoff(CA, level)), id).toMatchObject({ ok: false, reason: expect.stringMatching(/\(federal\); open an amendment\.$/) })
        expect(statusOf(state, id).none, id).toEqual({ text: 'Nothing for filing needs you yet: the partner opens an amendment first.', link: null })
      }
    })

    it('is unchanged with every step done: the partner submits the open jurisdiction', () => {
      const green = (id: string) => withGates(withSteps(playOn(model, id, PARTIAL), () => true), { request_approval: true, submit: true })
      expect(can(green('st-03'), 'st-03')({ type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['california'] } }).ok).toBe(true)
      const partner = statusOf(green('st-03'), 'st-03')
      expect(partner.headline).toBe(HEADLINE)
      expect(partner.next).toEqual({ text: 'submit the return', href: '#approval' })
      expect(statusOf(green('st-04'), 'st-04').none?.text).toBe('Nothing for filing needs you yet: the partner submits next.')
    })

    it('keeps the lines that send nobody to sign, and stops the reviewer requesting approval', () => {
      const as = (id: string) => playOn(model, id, PARTIAL)
      // Nothing was signed, so nothing reopened: rows that send nobody to sign or request approval keep their wording
      // (brief §C2).
      expect(statusOf(as('st-01'), 'st-01').next).toEqual({ text: 'step 1, Engagement letter and consents signed', href: '#step-1' })
      expect(statusOf(as('st-04'), 'st-04').none?.text).toBe('Nothing for filing is assigned to you: Priya Raman clears step 1 first.')
      expect(statusOf(as('st-02'), 'st-02').none?.text).toBe('No review sign-off is owed yet: waiting for preparer sign-offs (9 areas).')
      // Only step 12 red, the request no longer current (an amount changed after it): nextOf offers Request approval, which
      // frozenFor refuses.
      const twelve = (id: string): State => {
        const s = withApproval(withGates(withSteps(as(id), (n) => n <= 11), { request_approval: true, submit: false }), pending(false))
        return { ...s, steps: s.steps.map((st) => (st.n === 12 ? { ...st, ok: false } : st)) }
      }
      expect(twelve('st-02').steps.filter((s) => !s.ok).map((s) => s.n)).toEqual([12])
      expect(can(twelve('st-02'), 'st-02')(request[1])).toMatchObject({ ok: false, reason: expect.stringMatching(/\(federal\); open an amendment\.$/) })
      expect(statusOf(twelve('st-02'), 'st-02').none?.text).toBe('Nothing for filing needs you yet: the partner opens an amendment first.')
      expect(statusOf(twelve('st-03'), 'st-03').next).toEqual({ text: 'open an amendment', href: '#filings' })
    })
  })

  it('tells the active quality reviewer that review opens after an accepted filing', () => {
    const state = playOn(model, 'st-06', [['st-03', { type: 'clock', target: 'season', body: { to: '2027-01-05T00:00:00Z' } }]])
    expect(statusOf(state, 'st-06').none).toEqual({ text: 'Quality review opens after an accepted filing.', link: null })
  })
})

// ── T4: act reasons (§5) and the sign-off view (§6) ─────────────────────────────────────

describe('gateBlock', () => {
  it('counts the red steps behind each gate and the open blocking review notes on the empty log', () => {
    const s = at('st-03')
    expect(gateBlock(s, 'request_approval')).toEqual({ steps: 11, notes: 0 })
    expect(gateBlock(s, 'submit')).toEqual({ steps: 12, notes: 0 })
  })

  it('is null when the gate passes', () => {
    const s = withGates(at('st-03'), { request_approval: true, submit: true })
    expect(gateBlock(s, 'request_approval')).toBeNull()
    expect(gateBlock(s, 'submit')).toBeNull()
  })
})

describe('apartFromGate: the server verdict with the gate set aside', () => {
  const REQUEST_APPROVAL: OpenActRequest = { type: 'request_approval', target: 'return' }
  // The §5 Submit request, as ApprovalSubmit opens it on the empty log (nothing filed, so both jurisdictions).
  const SUBMIT_BOTH: OpenActRequest = { type: 'file', target: 'return', prefill: { kind: 'submit', jurisdictions: ['federal', 'california'] } }

  it('lets the reviewer request approval: only the gate refuses him', () => {
    const s = at('st-02')
    expect(s.gates.request_approval.ok).toBe(false)
    expect(apartFromGate(model, s, viewer('st-02'), REQUEST_APPROVAL, 'request_approval')).toEqual({ ok: true })
  })

  it('refuses the preparer the request in authorize() words', () => {
    expect(apartFromGate(model, at('st-01'), viewer('st-01'), REQUEST_APPROVAL, 'request_approval')).toEqual({
      ok: false, reason: 'Requesting client approval is a reviewer or partner act.',
    })
  })

  it('lets the partner submit, judged with the prefilled body, and does not throw', () => {
    const s = at('st-03')
    expect(s.gates.submit.ok).toBe(false)
    expect(() => apartFromGate(model, s, viewer('st-03'), SUBMIT_BOTH, 'submit')).not.toThrow()
    expect(apartFromGate(model, s, viewer('st-03'), SUBMIT_BOTH, 'submit')).toEqual({ ok: true })
  })

  it('refuses the preparer Submit in authorize() words', () => {
    expect(apartFromGate(model, at('st-01'), viewer('st-01'), SUBMIT_BOTH, 'submit')).toEqual({
      ok: false, reason: 'Only the partner (the paid preparer) can file.',
    })
  })
})

describe('signoffView', () => {
  const E49 = 'You prepared Sch3.10 (timeline:extension-2026-04-14). Route to another reviewer or the partner.'
  const PAYMENTS = 'area:payments_and_filing'
  const viewAs = (id: string, s: State = at(id)) => signoffView(model, s, viewer(id), can(s, id))
  const cellsOf = (v: ReturnType<typeof signoffView>): SignoffCellView[] => v.rows.flatMap((r) => r.cells)
  const cellOf = (v: ReturnType<typeof signoffView>, target: string, level: SignoffCellView['level']): SignoffCellView =>
    v.rows.find((r) => r.target === target)!.cells.find((c) => c.level === level)!

  it('offers Sign by role on the empty log (criterion 7)', () => {
    const ids = ['st-01', 'st-02', 'st-03', 'st-04', 'st-05', 'st-06']
    const signs = Object.fromEntries(ids.map((id) => [id, cellsOf(viewAs(id)).filter((c) => c.action === 'Sign').length]))
    expect(signs).toEqual({ 'st-01': 10, 'st-02': 18, 'st-03': 30, 'st-04': 10, 'st-05': 0, 'st-06': 0 })
  })

  it("shows Daniel's E49 refusal on his own level only, and who signs his partner cells", () => {
    const v = viewAs('st-02')
    expect(v.note).toBeNull()
    expect(cellsOf(v).filter((c) => c.refusal !== null).map((c) => `${c.target}|${c.level}`)).toEqual([`${PAYMENTS}|reviewer`, 'return|reviewer'])
    expect(cellOf(v, PAYMENTS, 'reviewer').refusal).toBe(E49)
    expect(cellOf(v, 'return', 'reviewer').refusal).toBe(E49)
    for (const r of v.rows) {
      const partner = cellOf(v, r.target, 'partner')
      expect(partner.refusal).toBeNull()
      expect(partner.whoSigns).toBe('Helen Strand signs')
    }
  })

  it("names who signs Priya's reviewer cells: Daniel, or Helen where Daniel is refused", () => {
    const v = viewAs('st-01')
    const reviewer = v.rows.map((r) => [r.target, cellOf(v, r.target, 'reviewer').whoSigns])
    expect(reviewer.filter(([, w]) => w === 'Daniel Ortiz signs')).toHaveLength(8)
    expect(reviewer.filter(([, w]) => w === 'Helen Strand signs').map(([t]) => t)).toEqual([PAYMENTS, 'return'])
  })

  it('gives the administrator one note instead of per-cell refusals, and still names who signs', () => {
    const v = viewAs('st-05')
    expect(v.note).toBe('Jo Kimura is the firm administrator: read-only on return claims (no value changes or sign-offs).')
    expect(cellsOf(v).every((c) => c.refusal === null)).toBe(true)
    expect(cellsOf(v).every((c) => c.action === null)).toBe(true)
    for (const r of v.rows) expect(cellOf(v, r.target, 'preparer').whoSigns).toBe('Priya Raman or Marcus Bell signs')
  })

  it('offers Re-sign on a reopened cell and lists the changed claim', () => {
    const s = playOn(model, 'st-01', [['st-01', signoff('area:business', 'preparer')], ['st-01', adjustSchC]])
    const c = cellOf(viewAs('st-01', s), 'area:business', 'preparer')
    expect(c.state).toBe('reopened')
    expect(c.changed).toContain('SchC.1')
    expect(c.action).toBe('Re-sign')
  })

  it('offers nothing on a valid cell', () => {
    const s = playOn(model, 'st-01', [['st-01', signoff('area:business', 'preparer')]])
    const c = cellOf(viewAs('st-01', s), 'area:business', 'preparer')
    expect(c.state).toBe('valid')
    expect(c.action).toBeNull()
  })

  it("shows no refusal under a valid cell: Helen's reviewer sign-off on Payments & filing, as Daniel sees it (P17)", () => {
    expect(can(at('st-03'), 'st-03')(signoff(PAYMENTS, 'reviewer')).ok).toBe(true) // authorize lets Helen sign at reviewer level
    const v = viewAs('st-02', playOn(model, 'st-02', [['st-03', signoff(PAYMENTS, 'reviewer')]]))
    expect(cellOf(v, PAYMENTS, 'reviewer')).toMatchObject({ state: 'valid', by: 'Helen Strand', action: null, refusal: null })
    // His empty Whole-return reviewer cell keeps the E49 refusal.
    expect(cellOf(v, 'return', 'reviewer')).toMatchObject({ state: 'empty', refusal: E49 })
  })
})
