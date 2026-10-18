// Contract between the workspace provider (owner W) and every screen / act form.
import type { Act, ActInput } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { AuthResult, State, Viewer } from '@/lib/model/state'

export type PostResult = { ok: true; acts: Act[] } | { ok: false; status: number; reason: string }

/**
 * How a post reports. `quiet` drops both toasts; `quietRefusal` drops only the refusal one, for a form that prints the
 * reason itself. A function is asked WHEN the refusal arrives, not when the post is sent: the act form answers true only
 * while it is still open, so a refusal that lands after its dialog was closed is toasted. `undoLabel` replaces the
 * success toast text.
 */
export interface PostOptions {
  quiet?: boolean
  quietRefusal?: boolean | (() => boolean)
  undoLabel?: string
}

/** Whether a refusal is shown without a toast. Called when the refusal arrives, so a `quietRefusal` function answers then. */
export function refusalQuiet(opts: PostOptions): boolean {
  return !!opts.quiet || (typeof opts.quietRefusal === 'function' ? opts.quietRefusal() : !!opts.quietRefusal)
}

export interface Workspace {
  model: Model
  state: State
  viewer: Viewer
  identities: Viewer[]
  engagement: string
  packetSha: string
  /**
   * Append acts (one batch, all-or-nothing). Shows a toast with Undo on success, the server's reason on refusal.
   * `quiet` drops both toasts; `quietRefusal` drops only the refusal one, for a form that prints the reason itself (a
   * function is asked when the refusal arrives: PostOptions).
   */
  post(acts: ActInput[], opts?: PostOptions): Promise<PostResult>
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
