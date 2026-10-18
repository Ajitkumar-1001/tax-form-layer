import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Act, type ActInput, ActInputZ, refsOf } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import type { Finding } from '@/lib/model/checks/types'
import { deriveFor } from '@/lib/model/derive'
import { needsPartner } from '@/lib/model/effects'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import type { State } from '@/lib/model/state'
import { viewerOf } from '@/lib/model/viewer'
import type { OpenActRequest } from '@/components/workspace/types'
import {
  DUE_DILIGENCE_QUESTIONS, RESOLUTION_LABEL, type Draft, buildInput, canOpen, fixToRequest, formErrors, initialDraft, issuesByField,
  levelsFor, normalizeRequest, parseAmount, parseTo, previewAdjust, probeDraft, proposalText, suggestMethod,
} from '@/components/acts/draft'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const preparer = viewerOf(packet, 'st-01')
const state = project(model, [], preparer)
const reviewerState = project(model, [], viewerOf(packet, 'st-02'))

/** A log written the way the server writes it: each act derived against the state before it. */
function stateAfter(inputs: ActInput[]): State {
  const acts: Act[] = []
  for (const input of inputs) {
    const s = project(model, acts, preparer)
    const seq = acts.length + 1
    acts.push({
      seq, id: `t-${seq}`, engagement: 'main', recorded_at: s.clock, season_at: s.clock, actor: 'st-01', actor_role: 'preparer',
      type: input.type, target: input.target, refs: refsOf(input), body: { ...input.body }, derived: deriveFor(model, s, input),
      batch_id: null, hash: '', prev_hash: '',
    })
  }
  return project(model, acts, preparer)
}

/** Open a form with its defaults, apply edits, and validate exactly as the dialog does. */
function submit(req: OpenActRequest, edits: Partial<ReturnType<typeof initialDraft>> = {}, s = state) {
  const r = normalizeRequest(req)
  const d = { ...initialDraft(r, model, s), ...edits }
  const input = buildInput(r, d, s)
  const parsed = ActInputZ.safeParse(input)
  return { input, parsed, errors: { ...(parsed.success ? {} : issuesByField(parsed.error.issues)), ...formErrors(r, d, s) } }
}

describe('parsing helpers', () => {
  it('parses amounts as typed by a preparer', () => {
    expect(parseAmount('19,100')).toBe(19100)
    expect(parseAmount('$19,100.50')).toBe(19100.5)
    expect(parseAmount('(860)')).toBe(-860)
    expect(parseAmount('−860')).toBe(-860)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
  it('suggests a verification type from the evidence kind', () => {
    expect(suggestMethod(['ev-0493'])).toBe('agreed_to_source_document')
    expect(suggestMethod(['agency:/irs_account_transcript_2025/0'])).toBe('agreed_to_third_party_record')
    expect(suggestMethod(['qa-01'])).toBe('confirmed_with_client')
    expect(suggestMethod(['py:/return_2024/lines/F1040.11'])).toBe('agreed_to_prior_year')
    expect(suggestMethod([])).toBe('agreed_to_source_document')
  })
  it('levels follow the role, default first', () => {
    expect(levelsFor('preparer')).toEqual(['preparer'])
    expect(levelsFor('firm_administrator')).toEqual([])
  })
  it('a partner may act at every level authorize() allows a partner (review should-fix)', () => {
    expect(levelsFor('partner')).toEqual(['partner', 'reviewer', 'preparer'])
  })
})

describe('adjust preview', () => {
  it('basis on an RSU lot: rate effect, opposite sign, routes to partner', () => {
    const p = previewAdjust(model, state, 'F8949.B.N1', 'basis', 19100, '')
    expect(p.from).toBe(0)
    expect(p.effect?.basis).toBe('rate')
    expect(p.effect!.fed).toBeLessThan(0)
    expect(needsPartner(p.effect!)).toBe(true)
  })
  it('a credit moves tax 1:1', () => {
    const p = previewAdjust(model, state, 'F1040.19', 'value', 0, '')
    expect(p.from).toBe(400)
    expect(p.effect).toMatchObject({ fed: 400, ca: 0, basis: 'direct' })
  })
  it('a cited what-if replaces the rate with the exact engine result', () => {
    const p = previewAdjust(model, state, 'F1040.12', 'value', 31500, 'standard_deduction')
    expect(p.effect?.basis).toBe('what_if')
  })
  it('household facts and labels have no tax effect', () => {
    expect(previewAdjust(model, state, 'household#filing_status', 'value', 'single', '').effect).toBeNull()
    expect(previewAdjust(model, state, 'F1040.19', 'label', 'x', '').effect).toMatchObject({ fed: 0, ca: 0, basis: 'none' })
  })
  it('no amount typed yet: no effect shown, not a zero effect', () => {
    expect(previewAdjust(model, state, 'F1040.19', 'value', null, '').effect).toBeNull()
  })

  // Regression (review must-fix 2): the preview starts from the value the server derives, not the row label.
  const same = (s: State, target: string, field: 'value' | 'basis', to: number) => {
    const p = previewAdjust(model, s, target, field, to, '')
    const d = deriveFor(model, s, { type: 'adjust', target, body: { field, to, reason: '', evidence: [] } })
    expect({ from: p.from, effect: p.effect }).toEqual({ from: d.from, effect: d.effect })
    return p
  }
  it('a total row with no basis read: measured from 0 as the server does, and says so', () => {
    const p = same(state, 'F8949.A.total', 'basis', 175000)
    expect(p.from).toBeNull()
    expect(needsPartner(p.effect!)).toBe(true)
    expect(p.hint).toMatch(/No basis was read/)
  })
  it('after a basis and then a value adjust, a basis preview starts from the live basis', () => {
    const reason = 'D11 supplemental statement'
    const s = stateAfter([
      { type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to: 19100, reason, evidence: [] } },
      { type: 'adjust', target: 'F8949.B.N1', body: { field: 'value', to: 50000, reason, evidence: [] } },
    ])
    expect(same(s, 'F8949.B.N1', 'basis', 20000).from).toBe(19100)
  })
  it('matches deriveFor for every numeric adjust fix in the packet', () => {
    for (const f of model.findings) {
      if (f.fix?.act !== 'adjust' || typeof f.fix.to !== 'number' || !model.lines[f.fix.target]) continue
      same(state, f.fix.target, f.fix.field === 'basis' ? 'basis' : 'value', f.fix.to)
    }
  })

  // Lead decision: needs_partner is judged on the move from the packet value, so "Routes to partner" is the server's flag.
  it('routes to partner exactly when the server would, after an earlier adjust on the same row', () => {
    const s = stateAfter([{ type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to: 19100, reason: 'D11 supplemental statement', evidence: [] } }])
    for (const to of [19000, 19600, 0]) {
      const p = previewAdjust(model, s, 'F8949.B.N1', 'basis', to, '')
      const d = deriveFor(model, s, { type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to, reason: '', evidence: [] } })
      expect(p.partner).toBe(d.needs_partner)
    }
    expect(previewAdjust(model, state, 'F8949.B.N1', 'basis', 19100, '').partner).toBe(true)
    expect(previewAdjust(model, state, 'F8949.B.N1', 'basis', null, '').partner).toBe(false)
  })
})

describe('authorization probe (review must-fix 1)', () => {
  const can = (req: OpenActRequest, d = initialDraft(req, model, state)) => authorize(model, state, buildInput(req, probeDraft(req, d, state, model), state), preparer)
  it('stands in for a new value not typed yet, of the type authorize() checks', () => {
    expect(can({ type: 'adjust', target: 'F1040.19' })).toEqual({ ok: true })
    expect(can({ type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis' } })).toEqual({ ok: true })
    expect(can({ type: 'adjust', target: 'household#filing_status' })).toEqual({ ok: true })
    const unchanged = { type: 'adjust' as const, target: 'F1040.19', prefill: { to: 400 } }
    expect(can(unchanged)).toEqual({ ok: true })
  })
  it('stands in for a missing disposition ref and finding-resolve authority; a decide needs none to be judged', () => {
    expect(can({ type: 'dispose', target: 'D12', prefill: { disposition: 'duplicate_of' } })).toEqual({ ok: true })
    expect(can({ type: 'decide', target: 'F1040.19' })).toEqual({ ok: true })
    const r: OpenActRequest = { type: 'resolve', target: 'chk:CHK-01:x' }
    expect(probeDraft(r, initialDraft(r, model, state), state, model).authority).not.toBe('')
  })
  // Review defect 2: a cited what-if accepts only the value it moves the line to, so that is the stand-in.
  it('an adjust citing a what-if, before an amount is typed, is judged on the what-if\'s own new value', () => {
    const alts = packet.what_if.alternatives.filter((a) => a.changed_lines.some((c) => model.lines[c.key]))
    expect(alts.length).toBe(4)
    for (const a of alts) {
      const line = a.changed_lines.find((c) => model.lines[c.key])!
      const req: OpenActRequest = { type: 'adjust', target: line.key, prefill: { what_if: a.id } }
      expect(probeDraft(req, initialDraft(req, model, state), state, model).to).toBe(String(line.new))
      expect(can(req)).toEqual({ ok: true })
    }
  })
  it('a valid draft is judged as typed', () => {
    const req: OpenActRequest = { type: 'adjust', target: 'F1040.19' }
    const d = { ...initialDraft(req, model, state), to: '0', reason: 'Credit not supported by D40' }
    expect(probeDraft(req, d, state, model)).toEqual(d)
    const r: OpenActRequest = { type: 'dispose', target: 'D12' }
    const dd = { ...initialDraft(r, model, state), disposition: 'duplicate_of' as const, ref: 'D11', reason: 'same 1099' }
    expect(probeDraft(r, dd, state, model)).toEqual(dd)
  })
  it('a note addressed to no one is not stood in for (authorize allows it)', () => {
    const req: OpenActRequest = { type: 'note', target: 'D59', prefill: { kind: 'question_client' } }
    const d = initialDraft(req, model, state)
    expect(probeDraft(req, d, state, model)).toEqual(d)
  })
})

// Review defect 3: one pure judgment for every "open this act" control, so other screens need not copy it.
describe('canOpen', () => {
  const ws = (s: State, v = preparer) => ({ model, state: s, can: (i: ActInput) => authorize(model, s, i, v) })
  it('opens the fixes the queue showed as refused (a number or a ref still to type)', () => {
    const fixes = model.findings.filter((f) => ['CHK-08', 'CHK-09', 'CHK-25'].includes(f.check) && f.fix && state.findings[f.id]?.visible)
    expect(new Set(fixes.map((f) => f.check))).toEqual(new Set(['CHK-08', 'CHK-09', 'CHK-25']))
    for (const f of fixes) expect(canOpen(fixToRequest(f), ws(state)).auth).toEqual({ ok: true })
    // The unprobed judgment the queue copied refuses at least one of them.
    const raw = fixes.map((f) => normalizeRequest(fixToRequest(f))).map((r) => authorize(model, state, buildInput(r, initialDraft(r, model, state), state), preparer))
    expect(raw.some((a) => !a.ok)).toBe(true)
  })
  it('a verify without a level opens at the first level the role may use', () => {
    const r = canOpen({ type: 'verify', target: 'Sch3.10' }, ws(reviewerState, viewerOf(packet, 'st-02')))
    expect(r.auth).toEqual({ ok: true })
    expect(r.req.prefill?.level).toBe('preparer')
  })
  it('refusals typing cannot fix still come back, with the reason', () => {
    const r = canOpen({ type: 'adjust', target: 'F1040.19' }, ws(project(model, [], viewerOf(packet, 'st-05')), viewerOf(packet, 'st-05')))
    expect(r.auth.ok).toBe(false)
  })
})

describe('proposal text (review should-fix: masking leak)', () => {
  it('copies the typed value for an ordinary line', () => {
    expect(proposalText(model, 'F1040.19', 'value', 400, '0', 'Not supported')).toBe('Proposed value: 400 → 0. Not supported')
  })
  it('prints a typed amount the way the line shows it', () => {
    expect(proposalText(model, 'F1040.19', 'value', 400, '6850', 'r')).toBe('Proposed value: 400 → 6,850. r')
  })
  it('words a yes/no answer the way the claim shows it, not as true or false', () => {
    // The packet's yes/no claim, answered yes. The adjust form's yes/no choice sends 'true' or 'false', read as a boolean.
    const yesNo = model.claimList.find((c) => typeof c.value === 'boolean' && !c.sensitive)!
    expect(yesNo.value).toBe(true)
    expect(parseTo('false', 'value', yesNo.value ?? null)).toBe(false)
    const text = proposalText(model, yesNo.id, 'value', yesNo.value ?? null, 'false', 'r')
    expect(text).toBe('Proposed value: yes → no. r')
    expect(text).not.toMatch(/true|false/)
  })
  it('never copies a typed value for a sensitive claim into free text', () => {
    const sensitive = model.claimList.find((c) => c.sensitive)!
    const text = proposalText(model, sensitive.id, 'value', sensitive.value ?? null, '123-45-6789', 'Typo on organizer')
    expect(text).not.toContain('123-45-6789')
    expect(text).toContain('withheld')
  })
})

describe('findings open the right form', () => {
  const base: Finding = {
    id: 'chk:CHK-01:F8949.B.N1', check: 'CHK-01', family: 'printed_vs_extracted', title: 'Basis read as 0',
    why: 'D11 prints 19,100', severity: 'high', signal: 'computed', claims: ['F8949.B.N1'], evidence: ['ev-0493', 'D11'],
    knownSince: '2026-01-12T17:06:00Z',
  }
  it('a suggested fix pre-fills the act, its evidence and the finding id', () => {
    const r = fixToRequest({ ...base, fix: { act: 'adjust', target: 'F8949.B.N1', field: 'basis', to: 19100, label: 'Set basis' } })
    expect(r).toEqual({
      type: 'adjust', target: 'F8949.B.N1', findings: [base.id],
      prefill: { evidence: ['ev-0493', 'D11'], field: 'basis', to: 19100 },
    })
    const d = initialDraft(r, model, state)
    expect(d).toMatchObject({ field: 'basis', to: '19100', evidence: 'ev-0493, D11' })
  })
  it('no fix: a generic resolve on the finding', () => {
    expect(fixToRequest(base)).toEqual({ type: 'resolve', target: base.id })
  })
  it('a dispose fix pre-fills body.ref from fix.ref (lead decision); other acts have no body.ref', () => {
    const r = fixToRequest({ ...base, claims: ['D10'], fix: { act: 'dispose', target: 'D10', disposition: 'duplicate_of', ref: 'D09', label: 'Duplicate' } })
    expect(r.prefill).toMatchObject({ disposition: 'duplicate_of', ref: 'D09' })
    expect(initialDraft(r, model, state).ref).toBe('D09')
    expect(fixToRequest({ ...base, fix: { act: 'decide', target: 'F1040.19', ref: 'D09', label: 'Decide' } }).prefill).not.toHaveProperty('ref')
  })
  it('a dispose fix with no ref falls back to the other item the finding names (review must-fix 1)', () => {
    const fix = { act: 'dispose' as const, target: 'D31', disposition: 'superseded_by', label: 'Superseded' }
    expect(fixToRequest({ ...base, claims: ['D31', 'D32'], evidence: ['D31'], fix }).prefill?.ref).toBe('D32')
    expect(fixToRequest({ ...base, claims: ['qa-14'], evidence: ['qa-14', 'D28'], fix: { ...fix, target: 'qa-14' } }).prefill?.ref).toBe('D28')
    expect(fixToRequest({ ...base, claims: ['D06'], fix: { ...fix, target: 'D06', disposition: 'informational' } }).prefill?.ref).toBeUndefined()
  })
  it('CHK-49: a decide on a required-entry key is a completeness call with the forced answer as the choice', () => {
    const f: Finding = {
      ...base, id: 'chk:CHK-49:F1040.digital_assets', check: 'CHK-49', family: 'coverage_completeness', claims: ['F1040.1a'],
      evidence: ['D11'], expected: 'Yes', fix: { act: 'decide', target: 'F1040.digital_assets', label: 'Answer Yes' },
    }
    expect(fixToRequest(f).prefill).toMatchObject({ kind: 'completeness' })
    const d = initialDraft(fixToRequest(f), model, state)
    expect(d).toMatchObject({ decideKind: 'completeness', choice: 'Yes' })
    // Keyed on the check (C1's request), not on the target's shape: even a CHK-49 fix on a claim is a completeness call.
    expect(initialDraft(fixToRequest({ ...f, fix: { ...f.fix!, target: 'F1040.19' } }), model, state).decideKind).toBe('completeness')
    // The fix's `to` is the decide's choice: it reaches body.choice.
    const cash = fixToRequest({ ...f, expected: undefined, fix: { ...f.fix!, to: 'Cash' } })
    const sent = buildInput(cash, initialDraft(cash, model, state), state)
    expect(sent.type === 'decide' && sent.body).toMatchObject({ kind: 'completeness', choice: 'Cash' })
    expect(initialDraft(fixToRequest({ ...f, expected: undefined, fix: { ...f.fix!, to: 'No' } }), model, state).choice).toBe('No')
    expect(initialDraft({ type: 'decide', target: 'F1040.19' }, model, state).decideKind).toBe('judgment')
  })
})

describe('draft → ActInput', () => {
  it('adjust: requires a 10-character reason and sends the finding ids', () => {
    const req: OpenActRequest = { type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis', to: 19100 }, findings: ['chk:x'] }
    expect(submit(req, { reason: 'short' }).errors.reason).toBeTruthy()
    const ok = submit(req, { reason: 'D11 supplemental statement shows basis 19,100' })
    expect(ok.errors).toEqual({})
    expect(ok.parsed.success && ok.parsed.data).toMatchObject({ body: { field: 'basis', to: 19100, findings: ['chk:x'] } })
  })
  it('adjust: an unparsable amount or an unchanged value is a field error', () => {
    const req: OpenActRequest = { type: 'adjust', target: 'F1040.19' }
    expect(submit(req, { reason: 'a long enough reason' }).errors.to).toBe('Enter the new value')
    expect(submit(req, { to: 'lots', reason: 'a long enough reason' }).errors.to).toBe('Enter an amount')
    expect(submit({ type: 'adjust', target: 'household#filing_status' }, { to: '  ', reason: 'a long enough reason' }).errors.to).toBe('Enter the new value')
    expect(submit(req, { to: '400', reason: 'a long enough reason' }).errors.to).toBe('That is the current value')
  })
  it('verify: seen value is the effective value and evidence defaults to the claim sources', () => {
    const { parsed } = submit({ type: 'verify', target: 'F1040.19' })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.type === 'verify') {
      expect(parsed.data.body.seen_value).toBe(400)
      expect(parsed.data.body.level).toBe('preparer')
    }
  })
  it('verify: the value seen when the form opened is what posts, so a value polled in later is refused, not attested', () => {
    const req: OpenActRequest = { type: 'verify', target: 'F1040.19' }
    const d = initialDraft(req, model, state)
    const moved = stateAfter([{ type: 'adjust', target: 'F1040.19', body: { field: 'value', to: 500, reason: 'moved under the dialog', evidence: [] } }])
    const input = buildInput(req, d, moved)
    expect(input.type === 'verify' && input.body.seen_value).toBe(400)
    const auth = authorize(model, moved, input, preparer)
    expect(auth.ok).toBe(false)
    expect(!auth.ok && auth.reason).toMatch(/F1040\.19 changed to 500 since you saw 400/) // the stale check, not some other refusal
  })
  // Rule 5: an attesting field starts unanswered, so Verify then Save records nothing until the person says how they checked.
  it('verify: no method is chosen until the person picks one', () => {
    const req: OpenActRequest = { type: 'verify', target: 'F1040.19' }
    expect(initialDraft(req, model, state).method).toBeNull()
    expect(submit(req).errors.method).toBe('Choose how you checked it')
    expect(submit(req, { method: 'recalculated' }).errors).toEqual({})
    // A method the opener passes is still the one the form opens with.
    expect(initialDraft({ ...req, prefill: { method: 'recalculated' } }, model, state).method).toBe('recalculated')
  })
  it('decide on a what-if pre-fills question, alternatives and the citation', () => {
    const d = initialDraft({ type: 'decide', target: 'whatif:standard_deduction' }, model, state)
    expect(d).toMatchObject({ decideKind: 'election', what_if: 'standard_deduction' })
    expect(d.alternatives.split('\n')).toHaveLength(2)
    expect(submit({ type: 'decide', target: 'whatif:standard_deduction' }).errors).toMatchObject({ choice: expect.any(String), authority: expect.any(String) })
  })
  it('due diligence needs every checklist answer', () => {
    const req: OpenActRequest = { type: 'decide', target: 'F8867.status' }
    const filled = { choice: 'Completed', authority: 'IRC 6695(g); Treas. Reg. 1.6695-2' }
    expect(submit(req, filled).errors.checklist).toMatch(/Answer every question/)
    const checklist = Object.fromEntries(DUE_DILIGENCE_QUESTIONS.map((q) => [q.key, 'yes' as const]))
    const ok = submit(req, { ...filled, checklist })
    expect(ok.errors).toEqual({})
    expect(ok.parsed.success && ok.parsed.data.type === 'decide' && ok.parsed.data.body.checklist).toEqual(checklist)
  })
  it('note: blocking only sticks on review notes; reviewers default to review notes', () => {
    expect(initialDraft({ type: 'note', target: 'F1040.19' }, model, reviewerState).noteKind).toBe('review_note')
    const memo = submit({ type: 'note', target: 'F1040.19' }, { text: 'memo', blocking: true })
    expect(memo.parsed.success && memo.parsed.data.type === 'note' && memo.parsed.data.body.blocking).toBe(false)
  })
  it('dispositions that point elsewhere need the ref; questions need an addressee', () => {
    expect(submit({ type: 'dispose', target: 'D12' }, { disposition: 'duplicate_of', reason: 'same 1099' }).errors.ref).toBeTruthy()
    expect(submit({ type: 'dispose', target: 'D12' }, { disposition: 'duplicate_of', ref: 'D11', reason: 'same 1099' }).errors).toEqual({})
    expect(submit({ type: 'note', target: 'D59' }, { noteKind: 'question_client', text: 'Was Ada full-time?' }).errors.to).toBeTruthy()
    expect(submit({ type: 'note', target: 'D59' }, { noteKind: 'question_client', addressee: 'cu-01', text: 'Was Ada full-time?' }).errors).toEqual({})
  })
  it('every resolution the form offers is accepted by the contract', () => {
    for (const resolution of Object.keys(RESOLUTION_LABEL)) {
      const r = submit({ type: 'resolve', target: 'chk:CHK-01:x' }, { resolution: resolution as never, text: 'done', authority: 'IRC §1012' })
      expect(r.errors).toEqual({})
    }
  })
  it('resolving a finding needs an authority; resolving a note does not (lead decision)', () => {
    expect(submit({ type: 'resolve', target: 'chk:CHK-01:x' }, { text: 'done' }).errors.authority).toBeTruthy()
    expect(submit({ type: 'resolve', target: 'act:7' }, { text: 'done' }).errors).toEqual({})
  })
  it('the season clock needs a date', () => {
    expect(submit({ type: 'clock', target: 'season' }, { clockTo: 'soon' }).errors.to).toBeTruthy()
    expect(submit({ type: 'clock', target: 'season' }, { clockTo: '2027-01-04T09:00:00Z' }).errors).toEqual({})
  })
  it('attach needs text or a file; a file over 2 MB is refused by the schema', () => {
    expect(submit({ type: 'attach', target: 'D11' }, { label: 'Statement' }).errors.text).toBeTruthy()
    const big = { name: 'a.pdf', mime: 'application/pdf', size: 2_000_001, data_base64: '' }
    expect(submit({ type: 'attach', target: 'D11' }, { label: 'Statement', file: big }).errors.file).toBeTruthy()
    const ok = submit({ type: 'attach', target: 'D11' }, { label: 'Statement', text: 'pasted email' })
    expect(ok.errors).toEqual({})
    expect(ok.parsed.success && ok.parsed.data.type === 'attach' && ok.parsed.data.body.filed_against).toEqual(['D11'])
  })
  it('area acts accept a bare area key', () => {
    expect(submit({ type: 'signoff', target: 'business' }).input.target).toBe('area:business')
    expect(submit({ type: 'time', target: 'business' }, { hours: '1.5' }).errors).toEqual({})
    expect(submit({ type: 'time', target: 'business' }).errors.hours).toBeTruthy()
    expect(submit({ type: 'assign', target: 'business' }).input.body).toMatchObject({ assignee: 'st-01' })
  })
  it('return-level acts and the PIN', () => {
    expect(submit({ type: 'request_approval', target: 'return' }).errors).toEqual({})
    expect(submit({ type: 'file', target: 'return' }).input.body).toEqual({ kind: 'submit', jurisdictions: ['federal', 'california'] })
    expect(submit({ type: 'amend_open', target: 'return' }, { reason: 'too short' }).errors.reason).toBeTruthy()
    expect(submit({ type: 'client_approve', target: 'act:7' }, { pin: '1234' }).errors.pin).toBeTruthy()
    expect(submit({ type: 'client_approve', target: 'act:7' }, { pin: '12345' }).errors).toEqual({})
  })
})

// UX rule 7: no Zod text in a field error. The schema is shared with the server, so the forms put its issues into formErrors'
// plain words (text and list bounds by issue code, the PIN and the hours by field); an issue this mapping does not cover keeps
// Zod's text. The sweeps below cover every form opened untouched plus the states a control can send past a schema bound (no
// field but the PIN sets a maxLength).
describe('field errors in plain words', () => {
  /** How Zod's own sentences begin: rule 7's mechanical check. */
  const ZOD_WORDING = /^(Too small|Too big|Invalid|Expected)/

  it('field errors are plain words, not Zod\'s defaults', () => {
    expect({
      reason: submit({ type: 'adjust', target: 'F1040.19' }, { to: '0', reason: 'short' }).errors.reason,
      text: submit({ type: 'note', target: 'F1040.19' }).errors.text,
      pin: submit({ type: 'client_approve', target: 'act:7' }, { pin: '1234' }).errors.pin,
      jurisdictions: submit({ type: 'file', target: 'return' }, { jurisdictions: [] }).errors.jurisdictions,
    }).toEqual({
      reason: 'Write at least 10 characters',
      text: 'Required',
      pin: 'Enter 5 digits',
      jurisdictions: 'Choose at least one',
    })
  })
  it('a text field names the minimum its schema asks for; whitespace alone counts as empty', () => {
    expect(submit({ type: 'revert', target: 'act:7' }, { reason: 'no' }).errors.reason).toBe('Write at least 3 characters')
    expect(submit({ type: 'decide', target: 'F1040.19' }).errors.authority).toBe('Write at least 3 characters')
    expect(submit({ type: 'note', target: 'F1040.19' }, { text: '   ' }).errors.text).toBe('Required')
  })
  it('a schema bound is put into plain words by its issue code, naming the bound', () => {
    expect(issuesByField([
      { path: ['body', 'text'], message: 'Too big: string', code: 'too_big', origin: 'string', maximum: 4000 },
      { path: ['body', 'alternatives'], message: 'Too big: array', code: 'too_big', origin: 'array', maximum: 10 },
      { path: ['body', 'hours'], message: 'Too small: number', code: 'too_small', origin: 'number', minimum: 0 },
    ])).toEqual({ text: 'Write at most 4000 characters', alternatives: 'Use at most 10 items', hours: 'Enter hours above 0, up to 24' })
    // The top of the hours range reads the same as its bottom.
    expect(issuesByField([{ path: ['body', 'hours'], message: 'Too big: number', code: 'too_big', origin: 'number', maximum: 24 }]))
      .toEqual({ hours: 'Enter hours above 0, up to 24' })
    // Hours that are not a number are formErrors' to word: its message wins the merge, though the schema's issue also lands on hours.
    expect(submit({ type: 'time', target: 'business' }, { hours: 'abc' }).errors.hours).toBe('Enter hours, e.g. 1.5')
  })
  it('an issue with no plain wording keeps Zod\'s text, and the first issue per field wins', () => {
    // The file picker refuses a file over 2 MB before the schema sees its size, so no form reaches this one.
    const size = 'Too big: expected number to be <=2000000'
    expect(issuesByField([{ path: ['body', 'file', 'size'], message: size, code: 'too_big', origin: 'number', maximum: 2_000_000 }])).toEqual({ file: size })
    expect(issuesByField([
      { path: ['body', 'reason'], message: 'first', code: 'too_small', origin: 'string', minimum: 10 },
      { path: ['body', 'reason'], message: 'second', code: 'too_small', origin: 'string', minimum: 1 },
      { path: ['target'], message: 'Invalid input' },
    ])).toEqual({ reason: 'Write at least 10 characters', target: 'Invalid input' })
  })
  it('no act form, opened untouched, shows an error in Zod\'s wording', () => {
    const forms: OpenActRequest[] = [
      { type: 'verify', target: 'F1040.19' }, { type: 'adjust', target: 'F1040.19' }, { type: 'decide', target: 'F1040.19' },
      { type: 'dispose', target: 'D12' }, { type: 'note', target: 'F1040.19' }, { type: 'reply', target: 'act:7' },
      { type: 'resolve', target: 'act:7' }, { type: 'attach', target: 'D11' }, { type: 'signoff', target: 'business' },
      { type: 'request_approval', target: 'return' }, { type: 'client_approve', target: 'act:7' }, { type: 'file', target: 'return' },
      { type: 'amend_open', target: 'return' }, { type: 'revert', target: 'act:7' }, { type: 'assign', target: 'business' },
      { type: 'time', target: 'business' }, { type: 'clock', target: 'season' },
    ]
    // A new act type fails here until its form is listed, so its wording gets looked at too.
    expect(forms.map((f) => f.type).sort()).toEqual(ActInputZ.options.map((o) => o.shape.type.value).sort())
    for (const f of forms) {
      for (const message of Object.values(submit(f).errors)) expect(message, f.type).not.toMatch(ZOD_WORDING)
    }
  })
  it('no state a control can send past a schema bound shows an error in Zod\'s wording', () => {
    const x = (n: number) => 'x'.repeat(n)
    const refs = (n: number) => Array.from({ length: n }, (_, i) => `ev-${i}`).join(', ')
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Alternative ${i + 1}`).join('\n')
    const chars = (n: number) => `Write at most ${n} characters`
    const items = (n: number) => `Use at most ${n} items`
    const HOURS = 'Enter hours above 0, up to 24'
    const decide: Partial<Draft> = { question: 'Which method?', choice: 'Cash', authority: 'IRC §451' }
    const reason = 'a long enough reason'
    // [name, the form, what is typed, the field that answers, what it says]. Each is a text or number an input or textarea
    // takes (none but the PIN sets a maxLength) or a list it splits, so only the schema stops it. A bound on a value the
    // person does not type is not listed: a target, a what-if, a Choice, a date input, or the attachment the file picker caps.
    const BEYOND: [string, OpenActRequest, Partial<Draft>, string, string][] = [
      ['hours 0', { type: 'time', target: 'business' }, { hours: '0' }, 'hours', HOURS],
      ['hours -1', { type: 'time', target: 'business' }, { hours: '-1' }, 'hours', HOURS],
      ['hours 25', { type: 'time', target: 'business' }, { hours: '25' }, 'hours', HOURS],
      ['time note 501 characters', { type: 'time', target: 'business' }, { hours: '1', timeNote: x(501) }, 'note', chars(500)],
      ['note text 4001 characters', { type: 'note', target: 'F1040.19' }, { text: x(4001) }, 'text', chars(4000)],
      ['reply text 4001 characters', { type: 'reply', target: 'act:7' }, { text: x(4001) }, 'text', chars(4000)],
      ['attach text 20001 characters', { type: 'attach', target: 'D11' }, { label: 'Statement', text: x(20001) }, 'text', chars(20000)],
      ['attach label 4001 characters', { type: 'attach', target: 'D11' }, { label: x(4001), text: 'pasted' }, 'label', chars(4000)],
      ['attach filed against 201 refs', { type: 'attach', target: 'D11' }, { label: 'Statement', text: 'pasted', filedAgainst: refs(201) }, 'filed_against', items(200)],
      ['attach filed against a 201-character ref', { type: 'attach', target: 'D11' }, { label: 'Statement', text: 'pasted', filedAgainst: x(201) }, 'filed_against', chars(200)],
      ['alternatives 11 lines', { type: 'decide', target: 'F1040.19' }, { ...decide, alternatives: lines(11) }, 'alternatives', items(10)],
      ['alternatives a 501-character line', { type: 'decide', target: 'F1040.19' }, { ...decide, alternatives: x(501) }, 'alternatives', chars(500)],
      ['decide question 4001 characters', { type: 'decide', target: 'F1040.19' }, { ...decide, question: x(4001) }, 'question', chars(4000)],
      ['decide choice 4001 characters', { type: 'decide', target: 'F1040.19' }, { ...decide, choice: x(4001) }, 'choice', chars(4000)],
      ['decide authority 4001 characters', { type: 'decide', target: 'F1040.19' }, { ...decide, authority: x(4001) }, 'authority', chars(4000)],
      ['decide evidence 201 refs', { type: 'decide', target: 'F1040.19' }, { ...decide, evidence: refs(201) }, 'evidence', items(200)],
      ['verify evidence a 201-character ref', { type: 'verify', target: 'F1040.19' }, { evidence: x(201) }, 'evidence', chars(200)],
      ['adjust reason 4001 characters', { type: 'adjust', target: 'F1040.19' }, { to: '0', reason: x(4001) }, 'reason', chars(4000)],
      ['adjust label 2001 characters', { type: 'adjust', target: 'F1040.19', prefill: { field: 'label' } }, { to: x(2001), reason }, 'to', chars(2000)],
      ['adjust evidence 201 refs', { type: 'adjust', target: 'F1040.19' }, { to: '0', reason, evidence: refs(201) }, 'evidence', items(200)],
      ['dispose reason 4001 characters', { type: 'dispose', target: 'D12' }, { reason: x(4001) }, 'reason', chars(4000)],
      ['dispose ref 201 characters', { type: 'dispose', target: 'D12' }, { disposition: 'duplicate_of', ref: x(201), reason: 'same 1099' }, 'ref', chars(200)],
      ['resolve text 4001 characters', { type: 'resolve', target: 'act:7' }, { text: x(4001) }, 'text', chars(4000)],
      ['resolve authority 501 characters', { type: 'resolve', target: 'act:7' }, { text: 'done', authority: x(501) }, 'authority', chars(500)],
      ['revert reason 4001 characters', { type: 'revert', target: 'act:7' }, { reason: x(4001) }, 'reason', chars(4000)],
      ['amend reason 4001 characters', { type: 'amend_open', target: 'return' }, { reason: x(4001) }, 'reason', chars(4000)],
      // Date.parse reads this, so formErrors lets it through; it is 62 characters and the schema allows 30.
      ['clock a 62-character date', { type: 'clock', target: 'season' }, { clockTo: 'Mon Jan 04 2027 09:00:00 GMT+0000 (Coordinated Universal Time)' }, 'to', chars(30)],
    ]
    for (const [name, req, edits, field, want] of BEYOND) {
      const { errors } = submit(req, edits)
      expect.soft(errors[field], name).toBe(want)
      for (const message of Object.values(errors)) expect.soft(message, name).not.toMatch(ZOD_WORDING)
    }
  })
})
