// Queue grouping, sorting, filters, Next and bulk inputs over the real packet (buildModel + project).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Act, ActInputZ } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import { plainMasked } from '@/lib/model/mask-token'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import {
  type Filters, type GroupKey, type Queue, acceptInputs, acceptLevel, buildQueue, chunk, collapseToRoots, disposeInputs,
  groupOf, lastUndoTarget, nextAction, openFindings, parseFilters,
} from '@/components/queue/queue-model'
import { actsOf, readPacket } from '../records/fixture'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const who = (id: string) => identities(packet).find((v) => v.id === id)!
const ALL: Filters = { area: null, mine: false, q: '' }
const fresh = (viewer = 'st-01', acts: Act[] = []) => project(model, acts, who(viewer))
const rowsOf = (q: Queue, g: GroupKey) => q.groups.find((x) => x.key === g)!.rows
const groupHolding = (q: Queue, findingId: string) =>
  q.groups.filter((g) => g.key !== 'new' && g.rows.some((r) => r.findings.includes(findingId))).map((g) => g.key)

let seq = 0
const act = (actor: string, type: Act['type'], target: string, body: Record<string, unknown>, extra: Partial<Act> = {}): Act => {
  seq++
  return {
    seq, id: `t-${seq}`, engagement: 'test', recorded_at: '2026-06-23T07:00:00Z', season_at: '2026-06-23T06:05:00Z', actor,
    actor_role: who(actor)?.role ?? 'system', type, target, refs: [target], body, derived: {}, batch_id: null, hash: '', prev_hash: '', ...extra,
  }
}

describe('groups', () => {
  const q = buildQueue(model, fresh(), 0, ALL)

  it('puts the RSU zero-basis lot in Contradicted, near the top by money', () => {
    const rows = rowsOf(q, 'contradicted')
    const i = rows.findIndex((r) => r.findings.includes('chk:CHK-06:F8949.B.N1'))
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThanOrEqual(4)
    expect(rows[i].claim).toBe('F8949.B.N1')
    // Every finding on the lot shares one row; the money one is on top.
    expect(rows[i].findings[0]).toBe('chk:CHK-06:F8949.B.N1')
    if (model.findingsById['chk:CHK-02:ev-0498']) expect(rows[i].findings).toContain('chk:CHK-02:ev-0498')
  })

  it('sorts rows by max(|fed|, |ca|), then severity, with a stable tiebreak', () => {
    const rows = rowsOf(q, 'contradicted')
    const money = rows.map((r) => Math.max(r.stake.fed, r.stake.ca))
    expect(money).toEqual([...money].sort((a, b) => b - a))
    const n1 = rows.findIndex((r) => r.claim === 'F8949.B.N1')
    const n3 = rows.findIndex((r) => r.claim === 'F8949.B.N3')
    expect(n1).toBeLessThan(n3) // equal stakes: ordered by key
    expect(buildQueue(model, fresh(), 0, ALL)).toEqual(q)
  })

  it('classifies CA wages, Theo SSN and the 1099-K double count as Contradicted', () => {
    for (const id of ['chk:CHK-44:SchCA540NR.1.E', 'chk:CHK-08:household:theo#ssn', 'chk:CHK-07:SchC.1']) {
      expect(groupHolding(q, id)).toEqual(['contradicted'])
    }
  })

  it('routes what-ifs, diagnostics, prior-preparer items and outside filings to Decisions due', () => {
    const decisionKinds = ['whatif', 'diag', 'prior_item']
    const due = openFindings(model, fresh()).filter((f) => f.check === 'CHK-50' || decisionKinds.includes(model.claims[f.claims[0]]?.kind))
    expect(due.some((f) => model.claims[f.claims[0]].kind === 'whatif')).toBe(true)
    for (const f of due) if (f.family !== 'process_control') expect(groupHolding(q, f.id), f.id).toEqual(['decisions'])
  })

  it('puts high process findings and red steps in Blocks filing, lower process findings in Decisions', () => {
    const process = openFindings(model, fresh()).filter((f) => f.family === 'process_control')
    expect(process.some((f) => f.severity === 'high')).toBe(true)
    for (const f of process) expect(groupHolding(q, f.id), f.id).toEqual([f.severity === 'high' ? 'blocks' : 'decisions'])
    const steps = rowsOf(q, 'blocks').filter((r) => r.kind === 'step')
    expect(steps.length).toBe(fresh().steps.filter((s) => !s.ok).length)
  })

  it('shows each open visible finding in exactly one primary group unless collapsed into a root', () => {
    const state = fresh()
    const open = openFindings(model, state)
    const { hidden } = collapseToRoots(model, open)
    for (const f of open) {
      const groups = groupHolding(q, f.id)
      expect(groups.length, f.id).toBe(hidden.has(f.id) ? 0 : 1)
      if (!hidden.has(f.id)) expect(groups[0]).toBe(groupOf(model, f))
    }
    const hiddenOnes = model.findings.filter((f) => !state.findings[f.id].visible).map((f) => f.id)
    for (const id of hiddenOnes) expect(groupHolding(q, id)).toEqual([])
  })

  it('collapses a finding whose inputs tree holds a same-family finding; leaves stay', () => {
    const open = openFindings(model, fresh())
    const { hidden } = collapseToRoots(model, open)
    for (const id of hidden) {
      const f = model.findingsById[id]
      expect(model.claims[f.claims[0]].inputs.length, id).toBeGreaterThan(0)
      expect(['process_control', 'coverage_completeness'], id).not.toContain(f.family)
    }
    expect(hidden.has('chk:CHK-06:F8949.B.N1')).toBe(false)
    expect(rowsOf(q, 'swings').length).toBeLessThanOrEqual(19)
  })

  it('sorts red steps numerically, 2 before 10 (review must-fix 3)', () => {
    const steps = rowsOf(q, 'blocks').filter((r) => r.kind === 'step').map((r) => Number(r.ref.slice('step:'.length)))
    expect(steps.some((n) => n >= 10) && steps.some((n) => n >= 2 && n <= 9)).toBe(true)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
  })

  it('collapses one row per area of read-ok claims into Tied by checks', () => {
    const inv = q.tied.find((t) => t.area === 'investments_and_digital_assets')!
    const state = fresh()
    expect(inv.claims.length).toBeGreaterThan(0)
    for (const id of inv.claims) expect(state.claims[id].status).toBe('read_ok')
  })
})

describe('filters', () => {
  it('area keeps only that area, including tied rows', () => {
    const q = buildQueue(model, fresh(), 0, { ...ALL, area: 'business' })
    for (const g of q.groups) for (const r of g.rows) expect(r.area).toBe('business')
    expect(q.tied.map((t) => t.area)).toEqual(['business'])
  })

  it('mine keeps the viewer\'s assigned areas; preparers default to it', () => {
    expect(parseFilters(new URLSearchParams(''), who('st-01')).mine).toBe(true)
    expect(parseFilters(new URLSearchParams(''), who('st-02')).mine).toBe(false)
    expect(parseFilters(new URLSearchParams('mine=0&area=nope&q=rsu'), who('st-01'))).toEqual({ area: null, mine: false, q: 'rsu' })
    // st-04 is assigned nothing: only return-level rows (no area) survive.
    const q = buildQueue(model, fresh('st-04'), 0, { ...ALL, mine: true })
    for (const g of q.groups) for (const r of g.rows) expect(r.area).toBeUndefined()
    expect(q.tied).toEqual([])
  })

  it('mine keeps every area for reviewer and partner, who review the whole return (review must-fix 1)', () => {
    for (const id of ['st-02', 'st-03']) {
      const state = fresh(id)
      expect(buildQueue(model, state, 0, { ...ALL, mine: true }), id).toEqual(buildQueue(model, state, 0, ALL))
      expect(buildQueue(model, state, 0, { ...ALL, mine: true }).tied.length, id).toBeGreaterThan(0)
    }
  })

  it('q matches every term against ref, label and title', () => {
    const q = buildQueue(model, fresh(), 0, { ...ALL, q: 'f8949.b.n1 basis' })
    const rows = q.groups.flatMap((g) => g.rows)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.claim).toBe('F8949.B.N1')
  })
})

describe('new since I last looked', () => {
  it('shows acts by others after lastSeenSeq, one row per batch, and not my own', () => {
    const acts = [
      act('st-02', 'note', 'F1040.1a', { kind: 'memo', text: 'looked at wages', blocking: false }),
      act('st-02', 'time', 'area:business', { hours: 1 }, { batch_id: 'b1' }),
      act('st-02', 'time', 'area:california', { hours: 1 }, { batch_id: 'b1' }),
      act('st-01', 'time', 'area:business', { hours: 1 }),
    ]
    const state = fresh('st-01', acts)
    const rows = rowsOf(buildQueue(model, state, 0, ALL), 'new').filter((r) => r.kind === 'act')
    expect(rows.map((r) => r.title)).toEqual(['Daniel Ortiz: Note added · F1040.1a', 'Daniel Ortiz: 2 acts recorded'])
    expect(rowsOf(buildQueue(model, state, acts[2].seq, ALL), 'new').filter((r) => r.kind === 'act')).toEqual([])
  })

  it('opens a reopened area sign-off on its area, and a return sign-off on its act', () => {
    const acts = [act('st-02', 'signoff', 'area:business', { level: 'reviewer' }), act('st-03', 'signoff', 'return', { level: 'partner' })]
    const rows = rowsOf(buildQueue(model, fresh('st-01', acts), 0, ALL), 'new').filter((r) => r.kind === 'signoff')
    expect(rows.map((r) => r.ref).sort()).toEqual(['area:business', `act:${acts[1].seq}`].sort())
  })

  it('surfaces evidence that arrived after v3 once the clock passes it', () => {
    const state = fresh('st-01', [act('st-03', 'clock', 'season', { to: '2026-07-02T00:00:00Z' })])
    const refs = rowsOf(buildQueue(model, state, 99, ALL), 'new').map((r) => r.claim)
    expect(refs).toContain('msg-07')
    expect(refs).not.toContain('msg-10') // 07-13: still after the clock
  })
})

describe('blocks filing from acts', () => {
  it('lists open blocking review notes and uncovered needs-partner adjusts', () => {
    const acts = [
      act('st-02', 'note', 'F8949.B.N1', { kind: 'review_note', text: 'Basis must come from D11', blocking: true }),
      act('st-01', 'adjust', 'F8949.B.N1', { field: 'basis', to: 19100, reason: 'D11 supplement', evidence: ['D11'] }, {
        derived: { from: 0, effect: { fed: -6647, ca: -1222, basis: 'rate', category: 'stcg' }, needs_partner: true, amendment: 0 },
      }),
    ]
    const state = fresh('st-01', acts)
    const rows = rowsOf(buildQueue(model, state, 0, ALL), 'blocks')
    expect(rows.find((r) => r.kind === 'note')?.claim).toBe('F8949.B.N1')
    expect(rows.find((r) => r.kind === 'adjust')?.stake).toEqual({ fed: 6647, ca: 1222 })
  })
})

describe('next action', () => {
  it('sends st-01 at an empty log to the largest-money finding in her areas: the RSU basis', () => {
    const n = nextAction(model, fresh(), who('st-01'))!
    expect(n.kind).toBe('finding')
    expect(n.finding).toBe('chk:CHK-06:F8949.B.N1')
    expect(n.request).toMatchObject({ type: 'adjust', target: 'F8949.B.N1', findings: ['chk:CHK-06:F8949.B.N1'] })
    expect(n.doneWhen).toMatch(/adjustment is recorded/)
  })

  it('puts a blocking review note on my work and a question to me first', () => {
    const acts = [
      act('st-02', 'note', 'F1040.1a', { kind: 'question_staff', to: 'st-01', text: 'Which W-2 is final?', blocking: false }),
      act('st-02', 'note', 'F8949.B.N1', { kind: 'review_note', text: 'Basis must come from D11', blocking: true }),
    ]
    const n = nextAction(model, fresh('st-01', acts), who('st-01'))!
    expect(n.kind).toBe('note')
    expect(n.request).toEqual({ type: 'reply', target: `act:${acts[1].seq}` })
    expect(nextAction(model, fresh('st-01', acts.slice(0, 1)), who('st-01'))!.kind).toBe('question')
  })

  it('falls back to the first red step for someone with no areas', () => {
    const n = nextAction(model, fresh('st-05'), who('st-05'))!
    expect(n.kind).toBe('step')
    expect(n.what).toMatch(/^Step 1/)
  })
})

describe('bulk and undo', () => {
  it('builds valid accept inputs only for reviewer and partner', () => {
    const state = fresh('st-02')
    expect(acceptLevel(who('st-01'))).toBeNull()
    expect(acceptLevel(who('st-02'))).toBe('reviewer')
    expect(acceptLevel(who('st-03'))).toBe('partner')
    const claims = buildQueue(model, state, 0, ALL).tied.find((t) => t.area === 'business')!.claims
    const inputs = acceptInputs(model, state, claims, 'reviewer')
    expect(inputs).toHaveLength(claims.length)
    for (const i of inputs) expect(ActInputZ.safeParse(i).success).toBe(true)
    expect(chunk(Array.from({ length: 301 }, (_, i) => i)).map((c) => c.length)).toEqual([300, 1])
  })

  it('disposes the top finding of each finding row and skips rows that cannot be disposed', () => {
    const q = buildQueue(model, fresh(), 0, ALL)
    const n1 = rowsOf(q, 'contradicted').find((r) => r.claim === 'F8949.B.N1')!
    const step = rowsOf(q, 'blocks').find((r) => r.kind === 'step')!
    const { inputs, skipped } = disposeInputs(model, [n1, step], 'accepted_as_is', 'Reviewed with the partner')
    expect(inputs).toEqual([{ type: 'dispose', target: n1.findings[0], body: { disposition: 'accepted_as_is', reason: 'Reviewed with the partner', findings: n1.findings } }])
    expect(skipped).toEqual([step])
    for (const i of inputs) expect(ActInputZ.safeParse(i).success).toBe(true)
  })

  it('undoes my last live batch, skipping reverts and other people', () => {
    const a1 = act('st-01', 'time', 'area:business', { hours: 1 }, { batch_id: 'b9' })
    const a2 = act('st-02', 'time', 'area:business', { hours: 1 })
    expect(lastUndoTarget([a1, a2], 'st-01')).toBe('batch:b9')
    const r = act('st-01', 'revert', 'batch:b9', { reason: 'oops' })
    expect(lastUndoTarget([a1, a2, r], 'st-01')).toBeNull()
    expect(lastUndoTarget([a1, a2, r], 'st-02')).toBe(`act:${a2.seq}`)
  })
})

describe('Row.reason: the full text behind a row, never sliced (spec 4.3)', () => {
  const { masked } = maskPacket(readPacket())
  const mmodel = buildModel(masked)
  const st01 = identities(masked).find((v) => v.id === 'st-01')!
  // The eq tag depends on MASK_SECRET, so the token is read from the masked packet and only its last4 is pinned.
  const theo = masked.household.people.find((p) => p.id === 'theo')!.ssn
  const queueFor = (acts: Act[]) => buildQueue(mmodel, project(mmodel, acts, st01), 0, ALL)

  it('a blocking review note keeps its whole text, token and all, on its block row and its new-act row', () => {
    const text = `Check Theo ${theo} before filing`
    const q = queueFor(actsOf(mmodel, [['st-02', { type: 'note', target: 'F1040.26', body: { kind: 'review_note', to: 'st-01', text, blocking: true } }]]))
    const row = rowsOf(q, 'blocks').find((r) => r.kind === 'note')!
    expect(row).toMatchObject({ key: 'blocks:note:1', ref: 'F1040.26', claim: 'F1040.26', reason: text })
    expect(row.title).toBe(`Blocking review note by Daniel Ortiz: ${text}`)
    expect(row.reason).toMatch(/«ssn·3309·eq:/)
    expect(plainMasked(row.reason!)).toBe('Check Theo •••-••-3309 before filing')
    expect(rowsOf(q, 'new').find((r) => r.kind === 'act')).toMatchObject({ key: 'new:act:1', title: 'Daniel Ortiz: Note added · F1040.26', reason: text })
  })

  it('an agency rejection keeps the agency message', () => {
    const message = `Dependent SSN ${theo} was already claimed`
    const filed = actsOf(mmodel, [['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal'] } }]])
    const result = act('system', 'agency_result', 'act:1', { jurisdiction: 'federal', status: 'rejected', errors: [{ code: 'IND-180', message }], rule: 'test' }, { seq: 2 })
    const q = queueFor([...filed, result])
    const row = rowsOf(q, 'blocks').find((r) => r.kind === 'agency')!
    expect(row).toMatchObject({ key: 'blocks:agency:2', ref: 'act:2', title: `IRS rejected the filing: IND-180 ${message}`, reason: message })
    expect(row.claim).toBeUndefined()
    expect(plainMasked(row.reason!)).toBe('Dependent SSN •••-••-3309 was already claimed')
  })

  it('an adjustment needing a partner keeps its reason; a reopened sign-off says how many claims changed', () => {
    const reason = 'Gross receipts count the 1099-K twice'
    const q = queueFor(actsOf(mmodel, [
      ['st-02', { type: 'signoff', target: 'area:business', body: { level: 'reviewer' } }],
      ['st-01', { type: 'adjust', target: 'SchC.1', body: { field: 'value', to: 1, reason, evidence: [] } }],
    ]))
    expect(rowsOf(q, 'blocks').find((r) => r.kind === 'adjust')).toMatchObject({
      key: 'blocks:adjust:2', ref: 'SchC.1', title: 'Priya Raman adjusted SchC.1 (Fed −58,113, CA −5,075): over 1,000 needs a partner sign-off', reason,
    })
    expect(rowsOf(q, 'new').find((r) => r.kind === 'signoff')).toMatchObject({
      key: 'new:signoff:1', ref: 'area:business', title: "Daniel Ortiz's reviewer sign-off on Business (Sch C) reopened: 1 changed",
      reason: 'Changed after sign-off: 1 claim',
    })
  })

  it('an act row carries words only for a single act that has them', () => {
    const signedOff = queueFor(actsOf(mmodel, [['st-02', { type: 'signoff', target: 'area:business', body: { level: 'reviewer' } }]]))
    expect(rowsOf(signedOff, 'new').find((r) => r.kind === 'act')!.reason).toBeUndefined()
    const batch = [
      act('st-02', 'note', 'return', { kind: 'memo', text: 'First memo of the batch', blocking: false }, { batch_id: 'b-reason' }),
      act('st-02', 'note', 'return', { kind: 'memo', text: 'Second memo of the batch', blocking: false }, { batch_id: 'b-reason' }),
    ]
    const row = rowsOf(queueFor(batch), 'new').find((r) => r.kind === 'act')!
    expect(row.title).toBe('Daniel Ortiz: 2 acts recorded')
    expect(row.reason).toBeUndefined()
    const memo = queueFor(actsOf(mmodel, [['st-02', { type: 'note', target: 'return', body: { kind: 'memo', text: 'Return-level memo text', blocking: false } }]]))
    expect(rowsOf(memo, 'new').find((r) => r.kind === 'act')).toMatchObject({ ref: 'act:1', title: 'Daniel Ortiz: Note added · return', reason: 'Return-level memo text' })
  })

  it('a red required step keeps its first reason, the text after the label in its title', () => {
    const row = rowsOf(queueFor([]), 'blocks').find((r) => r.kind === 'step')!
    expect(row.key).toBe('blocks:step:1')
    expect(row.reason).toBe('Not verified to the signed document: D01, D02')
    expect(row.title).toBe(`Step 1 · Engagement letter and consents signed: ${row.reason}`)
  })
})
