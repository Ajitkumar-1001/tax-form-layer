// Test fixture: the real packet, its model and an empty-log projection (built once per test file).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { buildModel, type Model } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import type { State } from '@/lib/model/state'
import { identities, viewerOf } from '@/lib/model/viewer'

export const readPacket = (): Packet => JSON.parse(readFileSync(path.join(process.cwd(), 'data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet

export function loadFixture(): { packet: Packet; model: Model; state: State } {
  const packet = readPacket()
  const model = buildModel(packet)
  const state = project(model, [], viewerOf(packet, 'st-01'))
  return { packet, model, state }
}

/** A stored log for [actor, input] steps, derived like the server does (authorize is not run). */
export function actsOf(model: Model, steps: [string, ActInput][]): Act[] {
  const people = identities(model.packet)
  const acts: Act[] = []
  for (const [actor, input] of steps) {
    const seq = acts.length + 1
    const state = project(model, acts, viewerOf(model.packet, actor))
    acts.push({
      seq, id: `t-${seq}`, engagement: 'main', recorded_at: '2026-10-14T12:00:00Z', season_at: state.clock, actor, actor_role: people.find((v) => v.id === actor)?.role ?? 'system',
      type: input.type, target: input.target, refs: refsOf(input), body: input.body as Record<string, unknown>,
      derived: deriveFor(model, state, input), batch_id: null, hash: `h${seq}`, prev_hash: '',
    })
  }
  return acts
}
