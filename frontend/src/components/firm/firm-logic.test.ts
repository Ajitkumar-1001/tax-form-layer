import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Act } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'
import { budgetOnly, timeByPerson, viewLogRows } from './firm-logic'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const admin = identities(packet).find((v) => v.id === 'st-05')!

const act = (seq: number, actor: string, type: Act['type'], target: string, body: Record<string, unknown>): Act => ({
  seq, id: `t-${seq}`, engagement: 'test', recorded_at: `2026-10-14T10:0${seq}:00Z`, season_at: '2026-06-23T06:05:00Z', actor,
  actor_role: 'preparer', type, target, refs: [target], body, derived: {}, batch_id: null, hash: '', prev_hash: '',
})

describe('viewLogRows', () => {
  it('lists granted and denied reveals, newest first, with the field context', () => {
    const state = project(model, [
      act(1, 'st-01', 'view_sensitive', 'household:theo#ssn', { eq: 'x', kind: 'ssn', context: 'household:theo#ssn', denied: false }),
      act(2, 'st-04', 'view_sensitive', 'household:theo#ssn', { eq: 'x', kind: 'ssn', context: 'F1040.dependents', denied: true, reason: 'no clearance' }),
    ], admin)
    expect(viewLogRows(state)).toMatchObject([
      { seq: 2, actor: 'st-04', granted: false, reason: 'no clearance', context: 'F1040.dependents' },
      { seq: 1, actor: 'st-01', granted: true, kind: 'ssn' },
    ])
  })
})

describe('timeByPerson', () => {
  it('sums live time acts per person and area, ignoring reverted ones', () => {
    const state = project(model, [
      act(1, 'st-01', 'time', 'area:business', { hours: 1.5 }),
      act(2, 'st-01', 'time', 'area:business', { hours: 2 }),
      act(3, 'st-02', 'time', 'area:california', { hours: 0.5 }),
      act(4, 'st-01', 'revert', 'act:2', { reason: 'logged twice' }),
    ], admin)
    expect(timeByPerson(state)).toEqual([
      { actor: 'st-01', hours: { business: 1.5 }, total: 1.5 },
      { actor: 'st-02', hours: { california: 0.5 }, total: 0.5 },
    ])
  })
})

describe('budgetOnly', () => {
  it('keeps the budget lines that are not review areas', () => {
    expect(budgetOnly(packet.firm.budget_hours)).toEqual([{ key: 'partner_review', label: 'partner review', hours: 1 }])
  })
})
