// Contract between the workspace provider (owner W) and every screen / act form.
import type { Act, ActInput } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { AuthResult, State, Viewer } from '@/lib/model/state'

export type PostResult = { ok: true; acts: Act[] } | { ok: false; status: number; reason: string }

export interface Workspace {
  model: Model
  state: State
  viewer: Viewer
  identities: Viewer[]
  engagement: string
  packetSha: string
  /** Append acts (one batch, all-or-nothing). Shows a toast with Undo on success, the server's reason on refusal. */
  post(acts: ActInput[], opts?: { quiet?: boolean; undoLabel?: string }): Promise<PostResult>
  /** Same rules the server enforces, for disabling buttons and explaining why. */
  can(input: ActInput): AuthResult
  /** Ask the server for a masked value. The server logs the view (or the refusal) before answering. */
  reveal(token: string, context: string): Promise<{ ok: true; value: string } | { ok: false; reason: string }>
  switchIdentity(id: string): Promise<void>
  /** "Since I last looked": highest act seq this viewer had seen when they last marked the log seen. */
  lastSeenSeq: number
  markSeen(): void
}

export interface OpenActRequest {
  type: ActInput['type']
  target: string
  /** Partial body to pre-fill the form (e.g. from a finding's suggested fix). */
  prefill?: Record<string, unknown>
  /** Finding ids this act addresses (sent as body.findings so the projection clears them). */
  findings?: string[]
}
