import { describe, expect, it } from 'vitest'
import { canReveal } from '@/lib/model/authorize'
import { seasonInstant } from '@/lib/model/project'
import { OK, adjust, decide, effective, log, model, openFindingIds, resolveFinding, signoff, verify, who } from './test-helpers'

const visibleNow = (id: string) => log().state.findings[id]?.visible
const sensitiveFinding = () => model.findings.find((f) => f.claims.some((c) => model.claims[c]?.sensitive) && visibleNow(f.id))!
const dispose = (target: string, extra: Record<string, unknown> = {}) => ({ type: 'dispose', target, body: { disposition: 'not_relevant', reason: 'Not relevant here', ...extra } })
const fileFederal = (l: ReturnType<typeof log>) => {
  expect(l.post('st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal'] } }, { force: true })).toEqual(OK)
  l.agency(l.last().seq, 'federal', 'accepted')
}
const FROZEN_FED = { ok: false, reason: expect.stringMatching(/^Return filed .* \(federal\); open an amendment\.$/) }

describe('authorize: firm rules', () => {
  it('refuses self-review through a packet timeline actor (st-02 prepared Sch3.10)', () => {
    const l = log()
    expect(l.post('st-02', signoff('area:payments_and_filing', 'reviewer'))).toEqual({
      ok: false, reason: 'You prepared Sch3.10 (timeline:extension-2026-04-14). Route to another reviewer or the partner.',
    })
    expect(l.post('st-02', verify('Sch3.10', 36000, 'reviewer'))).toMatchObject({ ok: false })
    expect(l.post('st-03', signoff('area:payments_and_filing', 'reviewer'))).toEqual(OK)
  })

  it('refuses an actor before active_from on the season clock', () => {
    const l = log()
    const note = { type: 'note', target: 'return', body: { kind: 'memo', text: 'Selected for quality review' } }
    expect(l.post('st-06', note)).toEqual({ ok: false, reason: 'Sam Adeyemi is active from 2027-01-04.' })
    expect(l.post('st-01', { type: 'clock', target: 'season', body: { to: '2027-01-04T15:00:00Z' } })).toMatchObject({ ok: false })
    expect(l.post('st-03', { type: 'clock', target: 'season', body: { to: '2027-01-04T15:00:00Z' } })).toEqual(OK)
    expect(l.post('st-03', { type: 'clock', target: 'season', body: { to: '2026-07-01T00:00:00Z' } })).toMatchObject({ ok: false })
    expect(l.post('st-06', note)).toEqual(OK)
  })

  it('st-04 has no clearance for sensitive facts', () => {
    const l = log()
    const fix = adjust('household:theo#ssn', '666-74-3390', { reason: 'Social Security card D71 shows 3390' })
    expect(l.post('st-04', fix)).toEqual({ ok: false, reason: 'Marcus Bell has no sensitive-data clearance (firm.staff st-04).' })
    expect(l.post('st-01', fix)).toEqual(OK)
    expect(canReveal(l.state, who('st-04'))).toEqual({ ok: false, reason: 'Marcus Bell has no sensitive-data clearance (firm.staff st-04).' })
    expect(canReveal(l.state, who('cu-01')).ok).toBe(false)
    expect(canReveal(l.state, who('st-01'))).toEqual(OK)
  })

  it('limits the administrator and the clients', () => {
    const l = log()
    expect(l.post('st-05', adjust('SchC.1', 151300))).toMatchObject({ ok: false })
    expect(l.post('st-05', signoff('area:business', 'preparer'))).toMatchObject({ ok: false })
    expect(l.post('st-05', { type: 'assign', target: 'area:business', body: { assignee: 'st-04' } })).toEqual(OK)
    expect(l.state.assignments.business).toBe('st-04')
    expect(l.post('cu-01', adjust('SchC.1', 151300))).toMatchObject({ ok: false })
    expect(l.post('st-01', { type: 'note', target: 'F1040.26', body: { kind: 'question_client', to: 'cu-01', text: 'Which day did you pay the Q4 estimate?' } })).toEqual(OK)
    const q = `act:${l.last().seq}`
    expect(l.post('cu-02', { type: 'reply', target: q, body: { text: 'Not mine to answer' } })).toMatchObject({ ok: false })
    expect(l.post('cu-01', { type: 'reply', target: q, body: { text: 'January 15, 3,000' } })).toEqual(OK)
    expect(l.state.notes[0].replies).toHaveLength(1)
  })

  it('blocking review notes come from reviewers and clear only by their author or higher', () => {
    const l = log()
    const note = { type: 'note', target: 'SchC.1', body: { kind: 'review_note', text: 'Tie gross receipts to D15', blocking: true } }
    expect(l.post('st-01', note)).toMatchObject({ ok: false })
    expect(l.post('st-02', note)).toEqual(OK)
    const ref = `act:${l.last().seq}`
    expect(l.state.gates.request_approval.reasons.some((r) => r.ref === ref)).toBe(true)
    expect(l.state.claims['SchC.1'].flags).toContain('blocks_filing')
    const resolve = { type: 'resolve', target: ref, body: { resolution: 'addressed', text: 'Tied out' } }
    expect(l.post('st-01', resolve)).toMatchObject({ ok: false })
    expect(l.post('st-03', resolve)).toEqual(OK)
    expect(l.state.notes[0].open).toBe(false)
  })
})

describe('authorize: an act clears only the findings it is about (review must-fix 2)', () => {
  it('refuses listing findings that are not about the target, and clears nothing', () => {
    const l = log()
    const before = openFindingIds(l.state)
    const unrelated = model.findings.filter((f) => before.includes(f.id) && !f.claims.includes('D01') && f.fix?.target !== 'D01').slice(0, 50).map((f) => f.id)
    const r = l.post('st-04', verify('D01', null, 'preparer', 'agreed_to_source_document', { findings: unrelated }))
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/ is not about D01; address it from /) })
    expect(openFindingIds(l.state)).toEqual(before)
  })

  it('clears a finding attached to the verified claim', () => {
    const l = log()
    const f = model.findings.find((x) => l.state.findings[x.id].visible && model.claims[x.claims[0]]?.kind === 'line' && !model.claims[x.claims[0]].sensitive)!
    const c = f.claims[0]
    expect(l.post('st-01', verify(c, effective(l.state, c), 'preparer', 'agreed_to_source_document', { findings: [f.id] }))).toEqual(OK)
    expect(l.state.findings[f.id]).toMatchObject({ status: 'resolved', resolvedBy: { actor: 'st-01', how: 'verify' } })
  })

  it('a verify on a California line cannot clear a federal finding after the federal return is accepted', () => {
    const l = log()
    expect(l.post('st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal'] } }, { force: true })).toEqual(OK)
    l.agency(l.last().seq, 'federal', 'accepted')
    const fed = model.findings.find((x) => l.state.findings[x.id].visible && model.claims[x.claims[0]]?.jurisdiction === 'federal')!
    const r = l.post('st-01', verify('F540NR.72', effective(l.state, 'F540NR.72'), 'preparer', 'agreed_to_third_party_record', { findings: [fed.id] }))
    expect(r.ok).toBe(false)
    expect(l.state.findings[fed.id].status).toBe('open')
    expect(l.post('st-01', resolveFinding(fed.id, 'Rev. Proc. 2005-18'))).toMatchObject({ ok: false, reason: expect.stringMatching(/^Return filed .* \(federal\); open an amendment\.$/) })
  })

  it('a notice response after filing clears only the findings it lists, and never a frozen one (round-2 must-fix A)', () => {
    const l = log()
    fileFederal(l)
    const f = model.findings.find((x) => {
      const c = model.claims[x.claims[0]]
      return l.state.findings[x.id].visible && c?.kind === 'line' && c.jurisdiction === 'federal' && !c.sensitive
    })!
    const c = f.claims[0]
    const { hash } = l.state.claims[c]
    const before = openFindingIds(l.state)
    expect(l.post('st-04', decide(c, 'notice_response', { findings: [f.id] }))).toEqual(FROZEN_FED)
    expect(l.post('st-04', decide(c, 'judgment'))).toEqual(FROZEN_FED)
    // The notice page's own act: answering the agency on the filed claim is allowed, and changes nothing.
    expect(l.post('st-04', decide(c, 'notice_response'))).toEqual(OK)
    expect(openFindingIds(l.state)).toEqual(before)
    expect(l.state.findings[f.id].status).toBe('open')
    expect(l.state.claims[c].hash).toBe(hash)
  })

  it('refuses a decide or dispose on a finding that is not in the file yet (round-2 must-fix B)', () => {
    const l = log()
    const f = model.findings.find((x) => !l.state.findings[x.id].visible)!
    const notYet = { ok: false, reason: `${f.id} is not in the file yet.` }
    expect(l.post('st-01', dispose(f.id))).toEqual(notYet)
    expect(l.post('st-01', decide(f.id, 'judgment'))).toEqual(notYet)
    expect(l.state.acts).toHaveLength(0)
  })

  it('answering one required entry does not clear its siblings on the same line (round-2 should-fix D)', () => {
    const l = log()
    const byLine: Record<string, string[]> = {}
    for (const f of model.findings) if (f.check === 'CHK-49' && l.state.findings[f.id].visible) (byLine[f.claims[0]] ??= []).push(f.id)
    const [mine, sibling] = Object.values(byLine).find((ids) => ids.length > 1)!
    const key = mine.slice('chk:CHK-49:'.length)
    expect(l.post('st-01', decide(key, 'completeness', { findings: [mine, sibling] }))).toEqual({
      ok: false, reason: `${sibling} is not about ${key}; address it from ${model.findingsById[sibling].claims[0]}.`,
    })
    expect(l.post('st-01', decide(key, 'completeness', { findings: [mine] }))).toEqual(OK)
    expect(l.state.findings[mine].status).toBe('resolved')
    expect(l.state.findings[sibling].status).toBe('open')
  })

  it('accepts a decide on a required-entry key (CHK-49 lead decision) and clears only that finding', () => {
    const l = log()
    const f = model.findings.find((x) => x.check === 'CHK-49' && l.state.findings[x.id].visible)!
    const key = f.id.slice('chk:CHK-49:'.length)
    expect(model.claims[key]).toBeUndefined()
    const before = openFindingIds(l.state)
    expect(l.post('st-01', decide(key, 'completeness', { findings: [f.id] }))).toEqual(OK)
    expect(openFindingIds(l.state)).toEqual(before.filter((id) => id !== f.id))
    expect(l.state.findings[f.id].resolvedBy).toMatchObject({ actor: 'st-01', how: 'decide' })
    expect(l.state.claims[f.claims[0]].preparedBy).toContain('st-01') // the answer prepares the line it anchors to
  })
})

describe('authorize: a cited what-if must be the change it prices (review must-fix 3)', () => {
  it('refuses citing a what-if that does not change the target line', () => {
    const l = log()
    const r = l.post('st-01', adjust('SchC.1', 63700, { what_if: 'penalty_annualized' }))
    expect(r).toEqual({ ok: false, reason: 'What-if penalty_annualized does not change SchC.1, so its engine result cannot price this adjustment.' })
    expect(l.post('st-01', adjust('SchC.1', 63700))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ needs_partner: true })
  })

  it('refuses a value the what-if does not produce, and a second cite on the same line', () => {
    const l = log()
    expect(l.post('st-01', adjust('SchE.14A', 50, { what_if: 'hvac_improvement' }))).toEqual({
      ok: false, reason: 'What-if hvac_improvement moves SchE.14A from 13,300 to 2,300; this adjustment does not.',
    })
    expect(l.post('st-01', adjust('SchE.14A', 2300, { what_if: 'hvac_improvement' }))).toEqual(OK)
    expect(l.post('st-01', adjust('SchE.14A', 13300))).toEqual(OK)
    expect(l.post('st-01', adjust('SchE.14A', 2300, { what_if: 'hvac_improvement' }))).toEqual({
      ok: false, reason: 'What-if hvac_improvement already moved SchE.14A (act:1).',
    })
  })
})

describe('authorize: the season clock is time-zone independent (review must-fix 4)', () => {
  it('accepts only a date or a UTC time', () => {
    expect(seasonInstant('2027-01-04')).toBe('2027-01-04T00:00:00Z')
    expect(seasonInstant('2027-01-04T15:00Z')).toBe('2027-01-04T15:00:00Z')
    expect(seasonInstant('2027-01-04T15:00:00Z')).toBe('2027-01-04T15:00:00Z')
    expect(seasonInstant('2027-01-04T15:00:00.000Z')).toBe('2027-01-04T15:00:00Z') // the clock form sends toISOString()
    expect(seasonInstant('2027-01-04T15:00')).toBeNull()
    expect(seasonInstant('2027-01-04T15:00:00+02:00')).toBeNull()
    expect(seasonInstant('Jan 4 2027')).toBeNull()
    expect(seasonInstant('2027-02-30')).toBeNull()
  })

  it('refuses a zoneless clock act; the projection ignores one that got stored anyway', () => {
    const l = log()
    const start = l.state.clock
    expect(l.post('st-03', { type: 'clock', target: 'season', body: { to: '2027-01-04T15:00' } })).toMatchObject({ ok: false, reason: expect.stringMatching(/is not a season date/) })
    expect(l.post('st-03', { type: 'clock', target: 'season', body: { to: '2027-01-04T15:00' } }, { force: true })).toEqual(OK)
    expect(l.state.clock).toBe(start)
    expect(l.post('st-03', { type: 'clock', target: 'season', body: { to: '2027-01-04' } })).toEqual(OK)
    expect(l.state.clock).toBe('2027-01-04T00:00:00Z')
  })
})

describe('authorize: clearance covers decisions, dispositions and findings (review must-fix 5)', () => {
  it('refuses st-04 a judgment on an SSN, so it cannot stand in for the refused verify', () => {
    const l = log()
    const clearance = { ok: false, reason: 'Marcus Bell has no sensitive-data clearance (firm.staff st-04).' }
    expect(l.post('st-04', decide('household:theo#ssn', 'judgment'))).toEqual(clearance)
    expect(l.post('st-04', { type: 'dispose', target: 'household:theo#ssn', body: { disposition: 'accepted_as_is', reason: 'Matches the card' } })).toEqual(clearance)
    const f = sensitiveFinding()
    expect(l.post('st-04', { type: 'dispose', target: f.id, body: { disposition: 'not_relevant', reason: 'Looks fine' } })).toEqual(clearance)
    expect(l.post('st-04', resolveFinding(f.id, 'Pub 17'))).toEqual(clearance)
    expect(l.state.acts).toHaveLength(0)
    expect(l.post('st-01', decide('household:theo#ssn', 'judgment'))).toEqual(OK)
  })
})

describe('authorize: resolving a finding needs an authority (lead decision, review should-fix 8)', () => {
  it('refuses a resolve without one and records who resolved it', () => {
    const l = log()
    const id = openFindingIds(l.state).find((x) => !model.findingsById[x].claims.some((c) => model.claims[c]?.sensitive))!
    expect(l.post('st-04', resolveFinding(id))).toEqual({ ok: false, reason: 'Resolving a finding needs an authority: the rule, document or standard relied on.' })
    expect(l.post('st-04', resolveFinding(id, '   '))).toMatchObject({ ok: false })
    expect(l.post('st-04', resolveFinding(id, 'Treas. Reg. 1.6001-1'))).toEqual(OK)
    expect(l.state.findings[id].resolvedBy).toMatchObject({ actor: 'st-04', how: 'resolve' })
  })
})

describe('authorize: the partner decides elections and still signs the return (lead decision)', () => {
  it('a partner decide does not make the partner a preparer; a reviewer decide does', () => {
    const l = log()
    expect(l.post('st-03', decide('whatif:equipment_section179', 'election', { choice: 'Keep bonus depreciation' }))).toEqual(OK)
    expect(l.state.claims['whatif:equipment_section179']).toMatchObject({ decision: { actor: 'st-03', kind: 'election' } })
    expect(l.state.claims['whatif:equipment_section179'].preparedBy).not.toContain('st-03')
    expect(l.post('st-03', signoff('return', 'partner'))).toEqual(OK)

    const area = `area:${model.claims['whatif:hvac_improvement'].area}`
    expect(l.post('st-02', decide('whatif:hvac_improvement', 'election'))).toEqual(OK)
    expect(l.state.claims['whatif:hvac_improvement'].preparedBy).toContain('st-02')
    expect(l.post('st-02', signoff(area, 'reviewer'))).toMatchObject({
      ok: false, reason: expect.stringMatching(/^You prepared /),
    })
  })
})

describe('authorize: what can be judged (lead decisions)', () => {
  it('steps are derived: verify, decide and dispose on a step are refused', () => {
    const l = log()
    const derived = { ok: false, reason: 'Steps are derived; record the work they check instead.' }
    expect(l.post('st-02', decide('step:12', 'judgment'))).toEqual(derived)
    expect(l.post('st-01', verify('step:12', null))).toEqual(derived)
    expect(l.post('st-01', dispose('step:12', { disposition: 'informational' }))).toEqual(derived)
    expect(l.state.acts).toHaveLength(0)
  })

  it('refuses a decide or dispose on an act, or on a target that is nothing (round-2 should-fix C)', () => {
    const l = log()
    expect(l.post('st-01', adjust('household:theo#ssn', '666-74-3390', { reason: 'Social Security card D71 shows 3390' }))).toEqual(OK)
    const onAct = { ok: false, reason: 'act:1 is an act; judge the claim it targets instead.' }
    expect(l.post('st-04', decide('act:1', 'judgment'))).toEqual(onAct)
    expect(l.post('st-04', dispose('act:1'))).toEqual(onAct)
    expect(l.post('st-01', decide('act:1', 'judgment'))).toEqual(onAct)
    for (const t of ['nonsense-target', 'zzz', 'Fake.line', 'return', 'area:business']) {
      expect(l.post('st-01', decide(t, 'judgment'))).toEqual({ ok: false, reason: `Nothing to decide at ${t}: pick a claim, a finding or a required entry.` })
      expect(l.post('st-01', dispose(t))).toMatchObject({ ok: false, reason: `Nothing to dispose at ${t}: pick a claim, a finding or a required entry.` })
    }
    expect(l.state.acts).toHaveLength(1)
    expect(l.state.claims['household:theo#ssn'].preparedBy).not.toContain('st-04')
    // A page of a document stands for the document (CHK-03's unread-page fix disposes the page).
    expect(l.post('st-01', dispose('doc:D31#page32', { disposition: 'informational' }))).toEqual(OK)
  })
})

describe('authorize: a stale verify says what moved, in words that match the screen (UX review acts-masking-10)', () => {
  it('a verify of a value that moved names the new value and asks for a fresh check, not a reload', () => {
    const l = log()
    expect(l.post('st-01', adjust('F1040.19', 500))).toEqual(OK)
    const r = l.post('st-01', verify('F1040.19', 400))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('500')
    // The form has already pulled the log by now and shows the new value, so "reload" would send the person away from it.
    expect(!r.ok && r.reason).not.toMatch(/reload/i)
    expect(r).toEqual({ ok: false, reason: 'F1040.19 changed to 500 since you saw 400. Check the new value, then verify it.' })
  })
})
