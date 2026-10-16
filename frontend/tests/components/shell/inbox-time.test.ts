// The inbox reads every item's age against the season clock. This pins the projection side of that contract.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { relativeTime } from '@/components/atoms/format'
import type { Act } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const who = (id: string) => identities(packet).find((v) => v.id === id)!

describe('inbox times (regression: act-based items read "in 4 months")', () => {
  it('carries season-calendar times, so measuring from state.clock reads "just now", not the wall-clock gap', () => {
    const clock = project(model, [], who('st-03')).clock
    const wall = '2026-10-14T09:00:00Z' // recorded_at: months after the season clock
    const note: Act = {
      seq: 1, id: 't-1', engagement: 'test', recorded_at: wall, season_at: clock, actor: 'st-01', actor_role: 'preparer',
      type: 'note', target: 'D28', refs: ['D28'], body: { kind: 'question_staff', to: 'st-03', text: 'Can you confirm the RSU basis?', blocking: false },
      derived: {}, batch_id: null, hash: '', prev_hash: '',
    }
    const state = project(model, [note], who('st-03'))
    const item = state.inbox.find((i) => i.seq === 1)
    expect(item?.at).toBe(clock)
    expect(relativeTime(item!.at, Date.parse(state.clock))).toBe('just now')
    expect(relativeTime(wall, Date.parse(state.clock))).toBe('in 4 months') // the bug: wall time against the season clock
  })

  it('does the same for replies and assignments', () => {
    const clock = project(model, [], who('st-01')).clock
    const act = (seq: number, actor: string, type: Act['type'], target: string, body: Record<string, unknown>): Act => ({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: '2026-10-14T09:00:00Z', season_at: clock, actor, actor_role: who(actor).role,
      type, target, refs: [target], body, derived: {}, batch_id: null, hash: '', prev_hash: '',
    })
    const acts = [
      act(1, 'st-01', 'note', 'D28', { kind: 'question_staff', to: 'st-03', text: 'Can you confirm the RSU basis?', blocking: false }),
      act(2, 'st-03', 'reply', 'act:1', { text: 'Confirmed against the supplemental.', attachments: [] }),
      act(3, 'st-03', 'assign', 'area:investments', { assignee: 'st-01' }),
    ]
    const inbox = project(model, acts, who('st-01')).inbox
    for (const kind of ['reply', 'assign'] as const) {
      const item = inbox.find((i) => i.kind === kind)
      expect(item?.at, kind).toBe(clock)
    }
  })
})
