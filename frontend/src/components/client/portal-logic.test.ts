import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import type { State } from '@/lib/model/state'
import { identities } from '@/lib/model/viewer'
import { clientQuestions, portalClient, signState, stillNeeded } from './portal-logic'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const people = identities(packet)
const who = (id: string) => people.find((v) => v.id === id)!

function play(steps: [string, ActInput][]): State {
  const acts: Act[] = []
  let state = project(model, acts, who('cu-01'))
  for (const [actor, input] of steps) {
    const seq = acts.length + 1
    acts.push({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: state.clock, season_at: state.clock, actor, actor_role: who(actor).role,
      type: input.type, target: input.target, refs: refsOf(input), body: input.body as Record<string, unknown>,
      derived: deriveFor(model, state, input), batch_id: null, hash: '', prev_hash: '',
    })
    state = project(model, acts, who('cu-01'))
  }
  return state
}

const note = (kind: 'memo' | 'question_client' | 'question_staff' | 'review_note', text: string, to?: string): ActInput =>
  ({ type: 'note', target: 'D73', body: { kind, text, blocking: false, ...(to && { to }) } })

describe('portalClient', () => {
  it('is the viewer when a client, else the first client for a staff preview', () => {
    expect(portalClient(who('cu-02'), people)?.id).toBe('cu-02')
    expect(portalClient(who('st-01'), people)?.id).toBe('cu-01')
  })
})

describe('clientQuestions', () => {
  const state = play([
    ['st-01', note('question_client', 'Please send the Halvorsen paystub', 'cu-01')],
    ['st-01', note('question_client', 'Which of you drove the Subaru?', 'client')],
    ['st-01', note('question_client', 'Erik: your HSA statement', 'cu-02')],
    ['st-01', note('memo', 'Internal: wage split looks off')],
    ['st-02', note('review_note', 'Fix the CA wages')],
  ])

  it('shows only client questions addressed to this client or to both', () => {
    expect(clientQuestions(state, 'cu-01').open.map((n) => n.text)).toEqual(['Please send the Halvorsen paystub', 'Which of you drove the Subaru?'])
    expect(clientQuestions(state, 'cu-02').open.map((n) => n.text)).toEqual(['Which of you drove the Subaru?', 'Erik: your HSA statement'])
  })

  it('never lists memos or review notes in what we still need', () => {
    const texts = stillNeeded(model, state, 'cu-01').map((i) => i.text)
    expect(texts).not.toContain('Internal: wage split looks off')
    expect(texts).not.toContain('Fix the CA wages')
  })

  it('moves a resolved question to answered', () => {
    const answered = play([
      ['st-01', note('question_client', 'Please send the Halvorsen paystub', 'cu-01')],
      ['cu-01', { type: 'reply', target: 'act:1', body: { text: 'Attached', attachments: [] } }],
      ['st-01', { type: 'resolve', target: 'act:1', body: { resolution: 'addressed', text: 'Received' } }],
    ])
    const q = clientQuestions(answered, 'cu-01')
    expect(q.open).toEqual([])
    expect(q.answered[0].replies[0].text).toBe('Attached')
  })
})

describe('stillNeeded', () => {
  it('includes items the firm marked as requested from the client', () => {
    const state = play([['st-01', { type: 'dispose', target: 'D73', body: { disposition: 'requested', reason: 'Need the full paystub' } }]])
    expect(stillNeeded(model, state, 'cu-01').map((i) => i.key)).toContain('D73')
  })
})

describe('signState', () => {
  it('none → ready → signed (waiting for the spouse) → changed after an amount moves', () => {
    expect(signState(model, project(model, [], who('cu-01')), 'cu-01')).toEqual({ kind: 'none' })
    const request: [string, ActInput] = ['st-03', { type: 'request_approval', target: 'return', body: {} }]
    expect(signState(model, play([request]), 'cu-01')).toEqual({ kind: 'ready', requestSeq: 1 })
    const signed = play([request, ['cu-01', { type: 'client_approve', target: 'act:1', body: { pin: '12345' } }]])
    expect(signState(model, signed, 'cu-01')).toEqual({ kind: 'signed', requestSeq: 1, waitingFor: ['Erik Lindqvist'] })
    const changed = play([
      request,
      ['st-01', { type: 'adjust', target: 'SchC.1', body: { field: 'value', to: 151300, reason: 'Paywell 1099-K double counted', evidence: [] } }],
    ])
    expect(signState(model, changed, 'cu-01')).toEqual({ kind: 'changed', requestSeq: 1 })
  })
})
