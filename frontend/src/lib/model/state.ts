// State = project(model, acts, viewer). Everything every screen shows is read from here.
// Pure data (JSON-safe), recomputed on every new act; identical in browser and server.
import type { Act } from './acts'
import type { Val } from './claims'
import type { AreaKey } from './ids'

export type Role = 'preparer' | 'reviewer' | 'partner' | 'firm_administrator' | 'quality_reviewer' | 'client'

export interface Viewer {
  id: string // st-01..st-06 | cu-01 | cu-02
  name: string
  role: Role
  kind: 'staff' | 'client'
  clearance: boolean // sensitive-data clearance (clients: own data only, still masked in the portal)
  active_from: string
  credential?: string | null
}

/** One pill per claim; the first matching rule wins (open > adjusted > verified > accepted > read_ok > unreviewed). */
export type ClaimStatus = 'open' | 'adjusted' | 'verified' | 'accepted' | 'read_ok' | 'unreviewed'

export type Flag =
  | 'needs_partner'   // carries a live adjust over 1,000 not covered by a valid partner sign-off
  | 'reopened'        // a sign-off covering it is no longer valid
  | 'stale'           // an input (transitively) was adjusted; this engine value does not include it
  | 'blocks_filing'   // counts against a filing gate
  | 'not_yet_in_file' // knownAt is after the season clock
  | 'frozen'          // its jurisdiction is filed and accepted

/** Support letters (firm verification types): D source doc, R recalculated, C client, P prior year, T third party. */
export type SupportLetter = 'D' | 'R' | 'C' | 'P' | 'T'
export interface Support {
  letter: SupportLetter
  how: 'filled' | 'outlined' | 'ringed' // filled = a person verified; outlined = a check earned it; ringed = bulk-accepted
  by?: string // actor for filled/ringed
}

export interface ClaimState {
  id: string
  status: ClaimStatus
  original: Val // packet value
  effective: Val // after live adjusts
  adjust?: AdjustView // the live adjust, if any
  support: Support[]
  openFindings: string[] // visible, unresolved finding ids attached here
  resolvedFindings: string[]
  openNotes: number[] // seqs of open notes targeting it
  disposition?: { seq: number; actor: string; disposition: string; ref?: string; reason: string }
  decision?: { seq: number; actor: string; kind: string; choice: string; authority: string }
  verifications: { seq: number; actor: string; method: string; level: string; valid: boolean }[]
  flags: Flag[]
  /** max |stake| over open findings (fed, ca), for money-first sorting. */
  stake: { fed: number; ca: number }
  preparedBy: string[] // actors who changed or prepared it (incl. packet timeline actors)
  hash: string // content hash used by sign-off fingerprints
  /** Lines only: open claims anywhere in the inputs tree below. */
  openBelow: number
}

export interface FindingState {
  id: string
  status: 'open' | 'resolved'
  visible: boolean // knownSince <= clock
  resolvedBy?: { seq: number; actor: string; how: string }
}

export interface NoteView {
  seq: number
  actor: string
  target: string
  kind: 'memo' | 'question_client' | 'question_staff' | 'review_note'
  to?: string
  text: string
  blocking: boolean
  due?: string
  recorded_at: string
  season_at: string
  replies: { seq: number; actor: string; text: string; attachments: { name: string; mime: string; size: number }[]; recorded_at: string }[]
  resolved?: { seq: number; actor: string; resolution: string; text: string }
  open: boolean
}

export interface AdjustView {
  seq: number
  actor: string
  target: string
  field: 'value' | 'basis' | 'label'
  from: Val
  to: Val
  reason: string
  evidence: string[]
  effect: { fed: number; ca: number; basis: 'rate' | 'direct' | 'what_if' | 'none' }
  needs_partner: boolean
  partner_covered: boolean
  amendment: number
  batch_id: string | null
  recorded_at: string
  reverted: boolean
}

export interface SignoffView {
  seq: number
  actor: string
  target: string // area:<key> | return
  level: 'preparer' | 'reviewer' | 'partner' | 'quality'
  valid: boolean
  changed: string[] // claim ids whose hash changed since signing
  recorded_at: string
  scope_size: number
}

export interface Reason {
  text: string
  ref?: string // where to go to fix it
}
export interface StepView {
  n: number // 1..12
  label: string
  ok: boolean
  reasons: Reason[]
}
export interface GateView {
  ok: boolean
  reasons: Reason[]
}

export interface AreaView {
  key: AreaKey
  label: string
  claims: number
  open: number
  findingsOpen: number
  signoffs: Partial<Record<'preparer' | 'reviewer' | 'partner', SignoffView>>
  assignee: string
  hours: number
  budget: number | null
  /** Definition of done for the area, each item a derived predicate. */
  done: { label: string; ok: boolean; ref?: string }[]
}

export interface TotalsSide {
  v3: Record<string, number> // the engine summary for v3
  delta: number // Σ live effects (tax or balance)
  balance_estimate: number // v3 balance_due + delta
}
export interface Totals {
  federal: TotalsSide
  california: TotalsSide
  /** Linear estimates that cross an engine threshold (SALT cap, CTC phase-out, AMT): the engine must recompute. */
  warnings: string[]
}

export interface ApprovalView {
  request_seq: number
  requested_by: string
  amounts_hash: string
  current: boolean // amounts unchanged since the request
  approvals: { signer: string; seq: number; valid: boolean }[]
  complete: boolean // both spouses approved and still valid
}

export interface FilingView {
  seq: number
  kind: 'submit' | 'extension'
  jurisdictions: ('federal' | 'california')[]
  actor: string
  recorded_at: string
  results: { seq: number; jurisdiction: 'federal' | 'california'; status: 'accepted' | 'rejected' | 'held'; errors: { code: string; message: string }[] }[]
}

export interface InboxItem {
  kind: 'note' | 'reply' | 'assign' | 'reopened' | 'deadline' | 'question'
  text: string
  ref: string
  seq?: number
  at: string
}

export type Stage = 'preparation' | 'review' | 'partner' | 'approval' | 'filed' | 'amending'

export interface State {
  engagement: string
  head: number // last act seq seen
  clock: string // season clock (ISO)
  nextEvent?: { at: string; ref: string; label: string }
  viewer: Viewer
  stage: Stage
  claims: Record<string, ClaimState>
  findings: Record<string, FindingState>
  notes: NoteView[]
  adjusts: AdjustView[] // live and reverted, newest last
  signoffs: SignoffView[]
  steps: StepView[] // the 12 firm required steps
  gates: { request_approval: GateView; submit: GateView }
  approval?: ApprovalView
  filings: FilingView[]
  frozen: { federal: boolean; california: boolean }
  amendment: number
  areas: AreaView[]
  assignments: Record<AreaKey, string>
  totals: Totals
  viewLog: Act[] // view_sensitive acts (granted and denied)
  inbox: InboxItem[]
  acts: Act[]
  actsByRef: Record<string, number[]> // ref → act seqs citing it
  amountsHash: string
  identityHash: string
}

export type AuthResult = { ok: true } | { ok: false; reason: string }
