import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Act, ActInputZ, type ActType, refsOf } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'
import { actorName, describeActs, mergeActs, offerUndo, readSeen, targetText, undoTargets, writeSeen } from '@/components/workspace/log'

const act = (seq: number, type: ActType = 'verify', over: Partial<Act> = {}): Act => ({
  seq, id: `id-${seq}`, engagement: 'main', recorded_at: '2026-10-14T00:00:00Z', season_at: '2026-06-23T06:05:00Z',
  actor: 'st-01', actor_role: 'preparer', type, target: 'F1040.1a', refs: [], body: {}, derived: {}, batch_id: null,
  hash: 'h', prev_hash: 'p', ...over,
})

describe('mergeActs', () => {
  it('returns the same array when nothing is new (no re-projection on idle polls)', () => {
    const prev = [act(1), act(2)]
    expect(mergeActs(prev, [])).toBe(prev)
    expect(mergeActs(prev, [act(2)])).toBe(prev)
  })
  it('dedupes by seq and keeps seq order when a POST response arrives before the poll that fills the gap', () => {
    const afterPost = mergeActs([act(10)], [act(12)])
    const afterPoll = mergeActs(afterPost, [act(11), act(12)])
    expect(afterPoll.map((a) => a.seq)).toEqual([10, 11, 12])
  })
})

describe('undoTargets', () => {
  it('reverts a server batch as one unit', () => {
    expect(undoTargets([act(5, 'adjust', { batch_id: 'b1' }), act(6, 'adjust', { batch_id: 'b1' })])).toEqual(['batch:b1'])
  })
  it('reverts single acts by seq', () => {
    expect(undoTargets([act(7)])).toEqual(['act:7'])
  })
  it('offers no undo for clock moves, filings, reverts and records', () => {
    expect(undoTargets([act(8, 'clock')])).toEqual([])
    expect(undoTargets([act(9, 'file', { batch_id: 'b2' }), act(10, 'agency_result', { actor: 'system', batch_id: 'b2' })])).toEqual([])
    expect(undoTargets([act(11, 'revert')])).toEqual([])
  })
})

describe('describeActs', () => {
  it('names a single act and counts batches, ignoring system acts', () => {
    expect(describeActs([act(1, 'adjust')])).toBe('Adjusted · F1040.1a')
    expect(describeActs([act(1), act(2)])).toBe('2 acts recorded')
    expect(describeActs([act(1, 'file'), act(2, 'agency_result', { actor: 'system' })])).toBe('Filed · F1040.1a')
  })
})

// Spec §6: the dashboard says "change N", never "act:N", and names areas by their labels.
describe('targetText', () => {
  it('puts the codes the dashboard would print in plain words', () => {
    expect(targetText('area:intake_and_engagement')).toBe('Intake & identity')
    expect(targetText('area:rentals_and_sale')).toBe('Rentals & sale')
    expect(targetText('act:1612')).toBe('change 1612')
    expect(targetText('batch:3f2a9c1e-0b4d-4e5f-8a6b-7c8d9e0f1a2b')).toBe('a group of changes')
    expect(targetText('return')).toBe('the return')
    expect(targetText('season')).toBe('')
  })
  it('keeps claim, document and finding ids as they are (the words used everywhere; they may hold mask tokens)', () => {
    for (const ref of ['F1040.1a', 'D73', 'household:theo#ssn', 'chk:CHK-36:F1040.11', 'qa-45']) expect(targetText(ref)).toBe(ref)
  })
  it('falls back to the key in words for an area it does not know', () => {
    expect(targetText('area:some_new_area')).toBe('some new area')
  })
})

describe('actorName', () => {
  const people = identities(JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet)
  it('names staff and clients, says System for simulated agency results, and keeps an unknown id', () => {
    expect(actorName(people, 'st-01')).toBe('Priya Raman')
    expect(actorName(people, 'system')).toBe('System')
    expect(actorName(people, 'st-99')).toBe('st-99')
  })
})

describe('seen marker', () => {
  it('falls back to 0 without storage (server, private mode)', () => {
    expect(readSeen('main', 'st-01')).toBe(0)
    expect(() => writeSeen('main', 'st-01', 5)).not.toThrow()
  })
})

describe('offerUndo (regression: Undo offered on acts the server always refuses to revert)', () => {
  const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
  const model = buildModel(packet)
  const who = (id: string) => identities(packet).find((v) => v.id === id)!
  const line = model.claimList.find((c) => c.kind === 'line' && typeof c.value === 'number')!
  const ENG = 'test'

  /** Appends an act the way POST /api/acts writes it, minus authorize (some of these setups skip the gates). */
  function append(acts: Act[], actor: string, raw: unknown): Act {
    const input = ActInputZ.parse(raw)
    const state = project(model, acts, who(actor), ENG)
    const seq = acts.length + 1
    const a: Act = {
      seq, id: `t-${seq}`, engagement: ENG, recorded_at: state.clock, season_at: state.clock, actor, actor_role: who(actor).role,
      type: input.type, target: input.target, refs: refsOf(input), body: input.body, derived: deriveFor(model, state, input),
      batch_id: null, hash: '', prev_hash: '',
    }
    acts.push(a)
    return a
  }
  const note = (kind: string, to?: string) => ({ type: 'note', target: line.id, body: { kind, to, text: 'Please confirm this amount' } })

  it('offers Undo on a preparer adjust', () => {
    const acts: Act[] = []
    const posted = append(acts, 'st-01', { type: 'adjust', target: line.id, body: { field: 'value', to: (line.value as number) + 1, reason: 'Corrected to the source document', evidence: [] } })
    expect(offerUndo(model, [], [posted], who('st-01'), ENG)).toEqual([`act:${posted.seq}`])
  })

  it('offers none to a client (clients cannot revert), though the act alone looks undoable', () => {
    const acts: Act[] = []
    append(acts, 'st-01', note('question_client', 'cu-01'))
    const held = [...acts]
    const reply = append(acts, 'cu-01', { type: 'reply', target: 'act:1', body: { text: 'Yes, that is right' } })
    expect(undoTargets([reply])).toEqual([`act:${reply.seq}`])
    expect(offerUndo(model, held, [reply], who('cu-01'), ENG)).toEqual([])
  })

  it('offers none on a client approval', () => {
    const acts: Act[] = []
    append(acts, 'st-03', { type: 'request_approval', target: 'return', body: {} })
    const held = [...acts]
    const approve = append(acts, 'cu-01', { type: 'client_approve', target: 'act:1', body: { pin: '12345' } })
    expect(offerUndo(model, held, [approve], who('cu-01'), ENG)).toEqual([])
  })

  it('offers none on an amendment opening (not revertable)', () => {
    const acts: Act[] = []
    const amend = append(acts, 'st-03', { type: 'amend_open', target: 'return', body: { reason: 'Corrected 1099-B received after filing' } })
    expect(undoTargets([amend])).toEqual([`act:${amend.seq}`])
    expect(offerUndo(model, [], [amend], who('st-03'), ENG)).toEqual([])
  })

  it('offers none to the quality reviewer (no revert), while the reviewer gets one for the same note', () => {
    const acts: Act[] = []
    append(acts, 'st-03', { type: 'clock', target: 'season', body: { to: '2027-01-05T09:00:00Z' } })
    expect(project(model, acts, who('st-06'), ENG).clock >= '2027-01-04').toBe(true) // st-06 is active: the refusal is the role's
    const held = [...acts]
    const byQuality = append([...held], 'st-06', note('review_note'))
    expect(offerUndo(model, held, [byQuality], who('st-06'), ENG)).toEqual([])
    const byReviewer = append([...held], 'st-02', note('review_note'))
    expect(offerUndo(model, held, [byReviewer], who('st-02'), ENG)).toEqual([`act:${byReviewer.seq}`])
  })
})
