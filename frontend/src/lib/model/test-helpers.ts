// Shared by the projection, authorization and derivation tests (not a test file itself). Runs the real packet
// through an in-memory act log that mimics POST /api/acts. Checks change concurrently, so tests look findings
// up dynamically instead of relying on a specific one.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type Act, ActInputZ, type AgencyResultBody, refsOf } from './acts'
import { authorize } from './authorize'
import { buildModel } from './build'
import { deriveFor } from './derive'
import type { Packet } from './packet-types'
import { project } from './project'
import type { AuthResult, State, Viewer } from './state'
import { identities } from './viewer'

export const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
export const model = buildModel(packet)
const people = identities(packet)
export const who = (id: string): Viewer => people.find((v) => v.id === id)!

/** Wall-clock time the fake server stamps on every act; deliberately unlike the season clock. */
export const WALL = '2026-10-14T12:00:00.000Z'
export const OK = { ok: true }

export interface TestLog {
  acts: Act[]
  readonly state: State
  post(actor: string, raw: unknown, opts?: { force?: boolean; batch?: string }): AuthResult
  agency(fileSeq: number, jurisdiction: AgencyResultBody['jurisdiction'], status: AgencyResultBody['status']): void
  last(): Act
}

/** Zod → authorize (unless forced) → deriveFor → assign seq → re-project, like the server's POST. */
export function log(): TestLog {
  const acts: Act[] = []
  let state: State = project(model, acts, who('st-01'))
  const push = (actor: string, type: Act['type'], target: string, body: Record<string, unknown>, derived: Record<string, unknown>, refs: string[], batch: string | null) => {
    const seq = acts.length + 1
    acts.push({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: WALL, season_at: state.clock, actor,
      actor_role: actor === 'system' ? 'system' : who(actor).role, type, target, refs, body, derived, batch_id: batch, hash: '', prev_hash: '',
    })
    state = project(model, acts, who('st-01'))
  }
  return {
    acts,
    get state() {
      return state
    },
    post(actor, raw, opts = {}) {
      const input = ActInputZ.parse(raw)
      const auth = opts.force ? ({ ok: true } as const) : authorize(model, state, input, who(actor))
      if (auth.ok) push(actor, input.type, input.target, input.body, deriveFor(model, state, input), refsOf(input), opts.batch ?? null)
      return auth
    },
    agency(fileSeq, jurisdiction, status) {
      const body: AgencyResultBody = { jurisdiction, status, errors: [], rule: 'test' }
      push('system', 'agency_result', `act:${fileSeq}`, { ...body }, {}, [`act:${fileSeq}`], null)
    },
    last: () => acts[acts.length - 1],
  }
}

export const adjust = (target: string, to: number | string, extra: Record<string, unknown> = {}) => ({
  type: 'adjust', target, body: { field: 'value', to, reason: 'Corrected to the source document', evidence: [], ...extra },
})
export const verify = (target: string, seen: unknown, level = 'preparer', method = 'agreed_to_source_document', extra: Record<string, unknown> = {}) => ({
  type: 'verify', target, body: { method, level, seen_value: seen, evidence: [], ...extra },
})
export const signoff = (target: string, level: string) => ({ type: 'signoff', target, body: { level } })
export const decide = (target: string, kind: string, extra: Record<string, unknown> = {}) => ({
  type: 'decide', target, body: { kind, question: 'What does the file support?', choice: 'Yes', authority: 'IRC 6001; firm standard 4.2', evidence: [], ...extra },
})
export const resolveFinding = (id: string, authority?: string) => ({
  type: 'resolve', target: id, body: { resolution: 'addressed', text: 'Worked in test', ...(authority !== undefined && { authority }) },
})
export const effective = (s: State, id: string) => s.claims[id].effective
export const openFindingIds = (s: State) => Object.values(s.findings).filter((f) => f.visible && f.status === 'open').map((f) => f.id)
