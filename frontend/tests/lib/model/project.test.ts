import { describe, expect, it } from 'vitest'
import { project } from '@/lib/model/project'
import type { AuthResult } from '@/lib/model/state'
import { OK, WALL, adjust, effective, log, model, openFindingIds, resolveFinding, signoff, verify, who } from './test-helpers'

describe('project: sign-offs, reverts, gates, approval and freeze', () => {
  it('attaching a message to a claim in a signed area reopens the sign-off with that claim changed', () => {
    const l = log()
    expect(l.post('st-02', signoff('area:investments_and_digital_assets', 'reviewer'))).toEqual(OK)
    expect(l.state.signoffs[0].valid).toBe(true)
    expect(l.post('st-01', { type: 'attach', target: 'F8949.H.C6', body: { label: 'Client email: BTC bought 2025-06-01 for 4,900', text: 'Bought on Coinbase', filed_against: ['F8949.H.C6'] } })).toEqual(OK)
    expect(l.state.signoffs[0]).toMatchObject({ valid: false, changed: ['F8949.H.C6'] })
    expect(l.state.claims['F8949.H.C6'].flags).toContain('reopened')
  })

  it('a verify that clears no finding never reopens a sign-off, at any level', () => {
    const l = log()
    expect(l.post('st-02', signoff('area:business', 'reviewer'))).toEqual(OK)
    expect(l.post('st-03', verify('SchC.1', 163700, 'partner'))).toEqual(OK)
    expect(l.post('st-01', verify('SchC.8', effective(l.state, 'SchC.8')))).toEqual(OK)
    expect(l.state.signoffs[0].valid).toBe(true)
    expect(l.state.claims['SchC.1'].support).toContainEqual({ letter: 'D', how: 'filled', by: 'st-03' })
  })

  it('reverting a batch restores effective values and totals', () => {
    const l = log()
    l.post('st-01', adjust('SchC.1', 151300), { batch: 'b1' })
    l.post('st-01', adjust('F1040.26', 12000), { batch: 'b1' })
    expect(effective(l.state, 'SchC.1')).toBe(151300)
    expect(l.post('st-01', { type: 'revert', target: 'batch:b1', body: { reason: 'Wrong client file' } })).toEqual(OK)
    expect(effective(l.state, 'SchC.1')).toBe(163700)
    expect(effective(l.state, 'F1040.26')).toBe(13000)
    expect(l.state.totals.federal.delta).toBe(0)
    expect(l.state.adjusts.every((a) => a.reverted)).toBe(true)
    expect(l.post('st-01', { type: 'revert', target: 'batch:b1', body: { reason: 'again' } })).toMatchObject({ ok: false })
  })

  it('refuses reverting an adjust under a later live one on the same field', () => {
    const l = log()
    l.post('st-01', adjust('SchC.1', 151300))
    l.post('st-01', adjust('SchC.1', 150000))
    expect(l.post('st-01', { type: 'revert', target: 'act:1', body: { reason: 'undo first' } })).toEqual({
      ok: false, reason: 'Revert the later change to SchC.1 (act:2) first.',
    })
  })

  it('gates refuse with reasons and refs on an empty log', () => {
    const s = log().state
    expect(s.gates.request_approval.ok).toBe(false)
    expect(s.gates.submit.ok).toBe(false)
    const refs = s.gates.request_approval.reasons.map((r) => r.ref)
    expect(refs).toEqual(expect.arrayContaining(['D01', 'F1040.26', 'F8867.status', 'area:intake_and_engagement', 'return']))
    expect(s.steps.filter((x) => x.n !== 5 && x.ok)).toEqual([]) // step 5 has nothing to explain until CHK-26 finds swings
    const l = log()
    const r = l.post('st-02', { type: 'request_approval', target: 'return', body: {} })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/^Client approval cannot be requested yet: Step 1/)
  })

  it('a partner sign-off covers adjusts over 1,000', () => {
    const l = log()
    l.post('st-01', adjust('SchC.1', 151300))
    expect(l.state.gates.request_approval.reasons.map((r) => r.text)).toContain('1 item over 1,000 lacks a valid partner sign-off.')
    expect(l.post('st-03', signoff('area:business', 'partner'))).toEqual(OK)
    expect(l.state.adjusts[0].partner_covered).toBe(true)
    expect(l.state.claims['SchC.1'].flags).not.toContain('needs_partner')
  })

  it('client approval survives an identity-only fix but not an amount change', () => {
    const l = log()
    expect(l.post('st-02', { type: 'request_approval', target: 'return', body: {} }, { force: true })).toEqual(OK)
    const req = `act:${l.last().seq}`
    expect(l.post('cu-01', { type: 'client_approve', target: req, body: { pin: '12345' } })).toEqual(OK)
    expect(l.post('cu-01', { type: 'client_approve', target: req, body: { pin: '12345' } })).toMatchObject({ ok: false })
    expect(l.post('cu-02', { type: 'client_approve', target: req, body: { pin: '54321' } })).toEqual(OK)
    expect(l.state.approval?.complete).toBe(true)
    const { amountsHash, identityHash } = l.state
    expect(l.post('st-01', adjust('household:theo#ssn', '666-74-3390', { reason: 'Social Security card D71 shows 3390' }))).toEqual(OK)
    expect(l.state.amountsHash).toBe(amountsHash)
    expect(l.state.identityHash).not.toBe(identityHash)
    expect(l.state.approval?.complete).toBe(true)
    expect(l.post('st-01', adjust('F1040.26', 12000))).toEqual(OK)
    expect(l.state.approval).toMatchObject({ current: false, complete: false })
    expect(l.post('cu-02', { type: 'client_approve', target: req, body: { pin: '54321' } })).toMatchObject({ ok: false })
  })

  it('an accepted filing freezes value acts until an amendment opens', () => {
    const l = log()
    expect(l.post('st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal', 'california'] } }, { force: true })).toEqual(OK)
    const fileSeq = l.last().seq
    l.agency(fileSeq, 'federal', 'accepted')
    expect(l.state.frozen).toEqual({ federal: true, california: false })
    const fed = l.post('st-01', adjust('SchC.1', 151300))
    expect(!fed.ok && fed.reason).toMatch(/^Return filed \d{4}-\d{2}-\d{2} \(federal\); open an amendment\.$/)
    expect(l.post('st-01', adjust('F540NR.72', 10500))).toEqual(OK)
    l.agency(fileSeq, 'california', 'accepted')
    expect(l.state.stage).toBe('filed')
    expect(l.state.claims['SchC.1'].flags).toContain('frozen')
    expect(l.post('st-01', { type: 'amend_open', target: 'return', body: { reason: 'Letter 566 corrections' } })).toMatchObject({ ok: false })
    expect(l.post('st-03', { type: 'amend_open', target: 'return', body: { reason: 'Letter 566 corrections' } })).toEqual(OK)
    expect(l.state.stage).toBe('amending')
    expect(l.post('st-01', adjust('SchC.1', 151300))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ amendment: 1 })
  })

  it('a clean engagement opens both gates end to end', () => {
    const l = log()
    const must = (r: AuthResult) => expect(r).toEqual(OK)
    const s = () => l.state
    const known = (kind: string) => model.claimList.filter((c) => c.kind === kind && c.knownAt <= s().clock).map((c) => c.id)

    must(l.post('st-01', verify('D01', null)))
    must(l.post('st-01', verify('D02', null)))
    for (const c of model.claimList.filter((x) => /^household:[^#]+#(ssn|dob)$/.test(x.id))) must(l.post('st-01', verify(c.id, effective(s(), c.id))))
    for (const id of ['D06', 'D07', ...known('prior_item'), ...known('diag'), ...known('whatif')]) {
      must(l.post('st-01', { type: 'dispose', target: id, body: { disposition: 'informational', reason: 'Reviewed and recorded' } }))
    }
    for (const id of known('comm').filter((id) => s().claims[id].status === 'open')) {
      must(l.post('st-01', { type: 'dispose', target: id, body: { disposition: 'informational', reason: 'Read; no return effect' } }))
    }
    for (const c of model.claimList.filter((x) => x.sources.some((r) => r.startsWith('py:/carryovers_into_2025')))) {
      must(l.post('st-01', verify(c.id, effective(s(), c.id), 'preparer', 'agreed_to_prior_year')))
    }
    must(l.post('st-01', verify('F1040.26', 13000, 'preparer', 'agreed_to_third_party_record')))
    must(l.post('st-01', verify('F540NR.72', 14000, 'preparer', 'agreed_to_third_party_record')))
    must(l.post('st-01', verify('Sch3.10', 36000, 'preparer', 'recalculated')))
    must(l.post('st-01', verify('D59', null)))
    must(l.post('st-01', {
      type: 'decide', target: 'F8867.status',
      body: { kind: 'due_diligence', question: 'CTC/ODC due diligence', choice: 'Completed', authority: 'IRC 6695(g); Treas. Reg. 1.6695-2', evidence: [], checklist: { residency: 'yes' } },
    }))
    for (const f of Object.values(s().findings).filter((x) => x.visible && x.status === 'open')) {
      must(l.post('st-01', resolveFinding(f.id, 'Firm standard 4.2; worked in test')))
    }
    expect(s().steps.slice(0, 9).filter((x) => !x.ok)).toEqual([])

    for (const k of model.claimList.map((c) => c.area).filter((a, i, all) => all.indexOf(a) === i)) {
      must(l.post(k === 'payments_and_filing' ? 'st-03' : 'st-02', signoff(`area:${k}`, 'reviewer')))
    }
    must(l.post('st-03', signoff('return', 'partner')))
    expect(s().gates.request_approval).toEqual({ ok: true, reasons: [] })
    must(l.post('st-02', { type: 'request_approval', target: 'return', body: {} }))
    const req = `act:${l.last().seq}`
    must(l.post('cu-01', { type: 'client_approve', target: req, body: { pin: '11111' } }))
    must(l.post('cu-02', { type: 'client_approve', target: req, body: { pin: '22222' } }))
    expect(s().gates.submit).toEqual({ ok: true, reasons: [] })
    must(l.post('st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal', 'california'] } }))
    const fileSeq = l.last().seq
    l.agency(fileSeq, 'federal', 'accepted')
    l.agency(fileSeq, 'california', 'accepted')
    expect(s().frozen).toEqual({ federal: true, california: true })
    expect(l.post('st-01', adjust('F540NR.72', 10500))).toMatchObject({ ok: false })
  }, 30_000) // ~250 posts, each re-projecting the whole packet: about 1.5 s alone, slower under the full suite
})

describe('project: step 4 accounts for every document', () => {
  it('counts duplicate copies (CHK-18) and never-extracted documents (CHK-03), not unread pages', () => {
    const l = log()
    const open = (re: RegExp) => openFindingIds(l.state).filter((id) => re.test(id))
    const docLevel = open(/^chk:CHK-(18|03):D\d+$/)
    expect(docLevel.length).toBeGreaterThan(0)
    for (const id of open(/^chk:CHK-48:/)) expect(l.post('st-01', resolveFinding(id, 'Firm standard 4.2'))).toEqual(OK)
    const docReason = () => l.state.steps[3].reasons.find((r) => r.text.startsWith('Document not accounted for'))
    expect(docReason()?.ref).toMatch(/^chk:CHK-(18|03):D\d+$/)
    for (const id of docLevel) expect(l.post('st-01', resolveFinding(id, 'Firm standard 4.2'))).toEqual(OK)
    expect(docReason()).toBeUndefined()
    expect(open(/^chk:CHK-03:D\d+#page/).length).toBeGreaterThan(0) // a page-level CHK-03 is still open and does not count
  })
})

describe('project: verifications (review must-fix 1)', () => {
  it('evidence added after a verify reopens the claim; verifying again closes it', () => {
    const l = log()
    const c = model.claimList.find((x) => x.kind === 'line' && typeof x.value === 'number' && x.sources.some((s) => s.startsWith('ev-')) && l.state.claims[x.id].openFindings.length === 0)!.id
    expect(l.post('st-01', verify(c, effective(l.state, c)))).toEqual(OK)
    expect(l.state.claims[c].status).toBe('verified')
    expect(l.post('st-01', { type: 'attach', target: c, body: { label: 'Receipt', text: 'Vendor invoice', filed_against: [c] } })).toEqual(OK)
    expect(l.state.claims[c].status).toBe('open')
    expect(l.post('st-01', verify(c, effective(l.state, c)))).toEqual(OK)
    expect(l.state.claims[c].status).toBe('verified')
    expect(l.state.claims[c].verifications.map((v) => v.valid)).toEqual([false, true])
    expect(l.post('st-01', { type: 'revert', target: `act:${l.last().seq}`, body: { reason: 'Wrong receipt' } })).toEqual(OK)
    expect(l.state.claims[c].status).toBe('open')
  })
})

describe('project: which cleared findings reopen a sign-off (review should-fix 7)', () => {
  const setup = () => {
    const l = log()
    const f = model.findings.find((x) => {
      const c = model.claims[x.claims[0]]
      return l.state.findings[x.id].visible && c?.kind === 'line' && c.area === 'business' && !l.state.claims[c.id].preparedBy.includes('st-03')
    })!
    expect(l.post('st-02', signoff('area:business', 'reviewer'))).toEqual(OK)
    return { l, f, c: f.claims[0] }
  }

  it('a preparer verify that clears a finding reopens the reviewer sign-off', () => {
    const { l, f, c } = setup()
    expect(l.post('st-01', verify(c, effective(l.state, c), 'preparer', 'agreed_to_source_document', { findings: [f.id] }))).toEqual(OK)
    expect(l.state.findings[f.id].status).toBe('resolved')
    expect(l.state.signoffs[0].valid).toBe(false)
    expect(l.state.signoffs[0].changed).toContain(c)
  })

  it('a partner verify that clears a finding does not', () => {
    const { l, f, c } = setup()
    expect(l.post('st-03', verify(c, effective(l.state, c), 'partner', 'agreed_to_source_document', { findings: [f.id] }))).toEqual(OK)
    expect(l.state.findings[f.id].status).toBe('resolved')
    expect(l.state.signoffs[0].valid).toBe(true)
  })
})

describe('project: inbox times are on the season clock', () => {
  it('note, reply, assignment and reopened items carry season_at, not the wall clock', () => {
    const l = log()
    expect(l.post('st-03', { type: 'clock', target: 'season', body: { to: '2026-09-01' } })).toEqual(OK)
    expect(l.post('st-02', signoff('area:business', 'reviewer'))).toEqual(OK)
    expect(l.post('st-01', { type: 'note', target: 'SchC.1', body: { kind: 'question_staff', to: 'st-02', text: 'Which 1099-K is the right one?' } })).toEqual(OK)
    const q = l.last().seq
    expect(l.post('st-02', { type: 'reply', target: `act:${q}`, body: { text: 'The corrected one, D16' } })).toEqual(OK)
    expect(l.post('st-02', { type: 'assign', target: 'area:business', body: { assignee: 'st-01' } })).toEqual(OK)
    expect(l.post('st-01', adjust('SchC.1', 151300))).toEqual(OK)
    const inbox = [...project(model, l.acts, who('st-01')).inbox, ...project(model, l.acts, who('st-02')).inbox].filter((i) => i.kind !== 'deadline')
    expect(inbox.map((i) => i.kind).sort()).toEqual(['assign', 'question', 'reopened', 'reply'])
    for (const i of inbox) {
      expect(i.at).toBe(l.acts.find((a) => a.seq === i.seq)!.season_at)
      expect(i.at).not.toBe(WALL)
    }
  })
})
