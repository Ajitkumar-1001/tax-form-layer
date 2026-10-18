// The only thing ever written: an act. Append-only; undo is a `revert` act.
// Clients send ActInput; the server validates it here, authorizes it, computes `derived`, and stores Act.
import { z } from 'zod'
import { AREAS } from './ids'

const Ref = z.string().min(1).max(200)
const Refs = z.array(Ref).max(200)
const Val = z.union([z.number(), z.string().max(2000), z.boolean(), z.null()])
const Text = (min = 1) => z.string().trim().min(min).max(4000)

export const VERIFICATION_METHODS = [
  'agreed_to_source_document',
  'recalculated',
  'confirmed_with_client',
  'agreed_to_prior_year',
  'agreed_to_third_party_record',
] as const
export const VerifyMethod = z.enum([...VERIFICATION_METHODS, 'accepted_check_tied'])
export const Level = z.enum(['preparer', 'reviewer', 'partner', 'quality'])
export const AdjustFieldZ = z.enum(['value', 'basis', 'label'])
export const Disposition = z.enum([
  'landed', 'informational', 'duplicate_of', 'superseded_by', 'applied_to', 'contradicted_by',
  'requested', 'not_relevant', 'carried_forward', 'client_notified', 'accepted_as_is',
])
export const DecideKind = z.enum(['judgment', 'election', 'due_diligence', 'penalty', 'swing_explained', 'sourcing_method', 'completeness', 'notice_response'])

/** Paid-preparer due diligence (Form 8867), for the credits this return claims: CTC/ODC and AOTC. */
export const DUE_DILIGENCE_QUESTIONS: { key: string; part: string; text: string }[] = [
  { key: 'info_basis', part: 'All credits', text: 'Return completed from information for 2025 provided by the taxpayer or reasonably obtained or known by you?' },
  { key: 'computations', part: 'All credits', text: 'Credit worksheets (or your own equivalent computations) completed and kept?' },
  { key: 'knowledge', part: 'All credits', text: 'Knowledge requirement met: interviewed the taxpayer, asked adequate questions, documented the answers when asked?' },
  { key: 'inconsistencies', part: 'All credits', text: 'Information that looked incorrect, incomplete or inconsistent was followed up and the inquiries documented?' },
  { key: 'retention', part: 'All credits', text: 'Record retention met: this checklist and the records relied on are kept for 3 years?' },
  { key: 'substantiation_asked', part: 'All credits', text: 'Asked whether the taxpayer can provide documents that substantiate eligibility?' },
  { key: 'prior_disallowance', part: 'All credits', text: 'Asked whether any of these credits was disallowed or reduced in a prior year?' },
  { key: 'ctc_dependent_ssn', part: 'CTC / ODC', text: 'Each qualifying person is the taxpayer\'s dependent and a US citizen, national or resident, with an SSN that matches the card (CTC)?' },
  { key: 'ctc_age_relationship', part: 'CTC / ODC', text: 'Age at 12/31 and relationship verified from documents, not only the organizer?' },
  { key: 'ctc_residency', part: 'CTC / ODC', text: 'Explained that the child must have lived with the taxpayer more than half the year (unless an exception applies)?' },
  { key: 'ctc_divorced', part: 'CTC / ODC', text: 'Explained the rules for a child of divorced or separated parents?' },
  { key: 'aotc_substantiation', part: 'AOTC', text: 'Form 1098-T and receipts for qualified expenses obtained, and enrollment status (box 8) supports the claim?' },
]
export const NoteKind = z.enum(['memo', 'question_client', 'question_staff', 'review_note'])
export const Jur = z.enum(['federal', 'california'])

const Attachment = z.object({
  name: z.string().max(200),
  mime: z.string().max(100),
  size: z.number().int().max(2_000_000),
  data_base64: z.string().max(2_800_000),
})

/** finding ids the act addresses (clears them in the projection). */
const Addresses = { findings: z.array(z.string().max(200)).max(50).optional() }

export const ActInputZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('verify'), target: Ref, body: z.object({ method: VerifyMethod, level: Level, seen_value: Val, evidence: Refs, ...Addresses }) }),
  z.object({
    type: z.literal('adjust'),
    target: Ref, // a line key (or a household fact ref for field 'value')
    body: z.object({
      field: AdjustFieldZ,
      to: Val,
      reason: Text(10),
      evidence: Refs,
      what_if: z.string().max(100).optional(), // cite a packet what_if: exact engine effect replaces the rate
      ...Addresses,
    }),
  }),
  z.object({
    type: z.literal('decide'),
    target: Ref,
    body: z.object({
      kind: DecideKind,
      question: Text(),
      choice: Text(),
      alternatives: z.array(z.string().max(500)).max(10).default([]),
      authority: Text(3),
      evidence: Refs,
      what_if: z.string().max(100).optional(),
      checklist: z.record(z.string(), z.enum(['yes', 'no', 'n/a'])).optional(),
      ...Addresses,
    }),
  }),
  z.object({ type: z.literal('dispose'), target: Ref, body: z.object({ disposition: Disposition, ref: Ref.optional(), reason: Text(3), authority: z.string().max(500).optional(), ...Addresses }) }),
  z.object({
    type: z.literal('note'),
    target: Ref,
    body: z.object({ kind: NoteKind, to: z.string().max(20).optional(), text: Text(), blocking: z.boolean().default(false), due: z.string().max(30).optional() }),
  }),
  z.object({ type: z.literal('reply'), target: Ref /* act:<seq> of a note */, body: z.object({ text: Text(), attachments: z.array(Attachment).max(3).default([]) }) }),
  z.object({
    type: z.literal('resolve'),
    target: Ref, // act:<seq> of a note, or a finding id chk:...
    body: z.object({ resolution: z.enum(['addressed', 'cleared', 'withdrawn', 'not_applicable']), text: Text(3), authority: z.string().max(500).optional() }),
  }),
  z.object({
    type: z.literal('attach'),
    target: Ref,
    body: z.object({ label: Text(), text: z.string().max(20000).optional(), file: Attachment.optional(), filed_against: Refs }),
  }),
  z.object({ type: z.literal('signoff'), target: z.union([z.literal('return'), z.string().regex(/^area:/)]), body: z.object({ level: Level }) }),
  z.object({ type: z.literal('request_approval'), target: z.literal('return'), body: z.object({}).default({}) }),
  z.object({ type: z.literal('client_approve'), target: Ref /* act:<seq> of the request */, body: z.object({ pin: z.string().regex(/^\d{5}$/) }) }),
  z.object({ type: z.literal('file'), target: z.literal('return'), body: z.object({ kind: z.enum(['submit', 'extension']), jurisdictions: z.array(Jur).min(1) }) }),
  z.object({ type: z.literal('amend_open'), target: z.literal('return'), body: z.object({ reason: Text(10) }) }),
  z.object({ type: z.literal('revert'), target: Ref /* act:<seq> | batch:<id> */, body: z.object({ reason: Text(3) }) }),
  z.object({ type: z.literal('assign'), target: z.string().regex(/^area:/), body: z.object({ assignee: z.string().max(20) }) }),
  z.object({ type: z.literal('time'), target: z.string().regex(/^area:/), body: z.object({ hours: z.number().positive().max(24), note: z.string().max(500).optional() }) }),
  z.object({ type: z.literal('clock'), target: z.literal('season'), body: z.object({ to: z.string().max(30), event: z.string().max(100).optional() }) }),
])
export type ActInput = z.infer<typeof ActInputZ>
export type ActType = ActInput['type'] | 'view_sensitive' | 'agency_result'

/** POST /api/acts body. A batch is all-or-nothing and shares one batch id (revertable as a unit). */
export const PostActsZ = z.object({
  engagement: z.string().max(80),
  acts: z.array(ActInputZ).min(1).max(300),
  /** Highest seq the client had seen; a value-changing act on the same target after it returns 409. */
  base_seq: z.number().int().nonnegative(),
})
export type PostActs = z.infer<typeof PostActsZ>

// ── Stored shape ────────────────────────────────────────────────────────────────────────

export interface AdjustDerived {
  from: number | string | boolean | null
  effect: { fed: number; ca: number; basis: 'rate' | 'direct' | 'what_if' | 'none'; category: string; caCategory?: string }
  needs_partner: boolean
  amendment: number // 0 = original return; n after the nth amend_open
}
export interface SignoffDerived {
  fingerprint: string
  claim_hashes: Record<string, string>
  scope: string[] // claim ids covered
  covered_adjusts: number[] // live adjust seqs in scope at signing
}
export interface ApprovalDerived {
  amounts_hash: string
  identity_hash: string
  summary: { federal_balance: number; california_balance: number }
}
export interface FileDerived {
  amounts_hash: string
  identity_hash: string
  head_seq: number
}
export interface ViewSensitiveBody {
  eq: string
  kind: string
  context: string // the ref the viewer was looking at
  denied: boolean
  reason?: string
}
export interface AgencyResultBody {
  jurisdiction: 'federal' | 'california'
  status: 'accepted' | 'rejected' | 'held'
  errors: { code: string; message: string }[]
  rule: string // the disclosed simulation rule that produced it
}

export interface Act {
  seq: number
  id: string
  engagement: string
  recorded_at: string // wall clock
  season_at: string // season clock when written
  actor: string // st-01..st-06 | cu-01 | cu-02 | system
  actor_role: string // resolved on the server from firm.staff / client_users
  type: ActType
  target: string
  refs: string[]
  body: Record<string, unknown>
  derived: Record<string, unknown>
  batch_id: string | null
  hash: string
  prev_hash: string
}

/** Every ref an act cites (target, evidence, filed_against, disposition ref, findings) — indexed for lookups. */
export function refsOf(a: ActInput): string[] {
  const b = a.body as Record<string, unknown>
  const list = [a.target]
  for (const k of ['evidence', 'filed_against', 'findings'] as const) {
    const v = b[k]
    if (Array.isArray(v)) list.push(...(v as string[]))
  }
  if (typeof b.ref === 'string') list.push(b.ref)
  if (typeof b.what_if === 'string') list.push(`whatif:${b.what_if}`)
  return [...new Set(list)]
}

export const AREA_TARGETS = AREAS.map((a) => `area:${a}`)
