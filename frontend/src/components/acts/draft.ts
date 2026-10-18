// Pure half of the act forms: request → editable draft → ActInput candidate → field errors.
// No React here, so it runs under the node-only vitest config.
import { z } from 'zod'
import {
  type ActInput, type AdjustDerived, AdjustFieldZ, DecideKind, Disposition, Jur, Level, NoteKind, VerifyMethod,
} from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { Val } from '@/lib/model/claims'
import type { Finding } from '@/lib/model/checks/types'
import { deriveFor } from '@/lib/model/derive'
import { effectSpec } from '@/lib/model/effects'
import { AREAS, refKind } from '@/lib/model/ids'
import { displayMasked, parseToken } from '@/lib/model/mask-token'
import type { AuthResult, Role, State } from '@/lib/model/state'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'

export type MethodT = z.infer<typeof VerifyMethod>
export type LevelT = z.infer<typeof Level>
export type AdjustFieldT = z.infer<typeof AdjustFieldZ>
export type DecideKindT = z.infer<typeof DecideKind>
export type DispositionT = z.infer<typeof Disposition>
export type NoteKindT = z.infer<typeof NoteKind>
export type JurT = z.infer<typeof Jur>
// Inline enums in ActInputZ, mirrored here (the tests assert they still parse through ActInputZ).
const ResolutionZ = z.enum(['addressed', 'cleared', 'withdrawn', 'not_applicable'])
const ChecklistZ = z.record(z.string(), z.enum(['yes', 'no', 'n/a']))
export type ResolutionT = z.infer<typeof ResolutionZ>
export type Answer = 'yes' | 'no' | 'n/a'
export interface FileT {
  name: string
  mime: string
  size: number
  data_base64: string
}

/** Everything any act form edits. Only the fields of the open form's type are used. */
export interface Draft {
  method: MethodT | null // verify: null until the person says how they checked it
  level: LevelT
  seen: Val // verify's seen_value, captured when the form opens
  field: AdjustFieldT
  to: string // adjust: new value as typed
  reason: string
  evidence: string // refs separated by commas or whitespace
  what_if: string // '' = none
  decideKind: DecideKindT
  question: string
  choice: string
  alternatives: string // one per line
  authority: string
  checklist: Record<string, Answer>
  disposition: DispositionT
  ref: string
  noteKind: NoteKindT
  text: string
  addressee: string
  blocking: boolean
  due: string
  resolution: ResolutionT
  label: string
  file: FileT | null
  filedAgainst: string
  assignee: string
  hours: string
  timeNote: string
  pin: string
  fileKind: 'submit' | 'extension'
  jurisdictions: JurT[]
  clockTo: string
  event: string
}

// ── Vocabulary ──────────────────────────────────────────────────────────────────────────

export const METHOD_INFO: Record<MethodT, { letter: string; label: string; def: string }> = {
  agreed_to_source_document: { letter: 'D', label: 'Agreed to source document', def: 'Traced to the printed document (W-2, 1099, statement, closing disclosure).' },
  recalculated: { letter: 'R', label: 'Recalculated', def: 'Independently recomputed from its inputs and got the same amount.' },
  confirmed_with_client: { letter: 'C', label: 'Confirmed with client', def: 'The client confirmed it directly; the answer is on file.' },
  agreed_to_prior_year: { letter: 'P', label: 'Agreed to prior year', def: 'Agreed to the 2024 return, carryover schedule or prior-preparer workpaper.' },
  agreed_to_third_party_record: { letter: 'T', label: 'Agreed to third-party record', def: 'Agreed to an IRS or FTB account transcript or another record the client did not produce.' },
  accepted_check_tied: { letter: 'A', label: 'Accepted: check tied', def: 'An automated check tied it to evidence; accepted without re-performing.' },
}

export const DECIDE_KIND_LABEL: Record<DecideKindT, string> = {
  judgment: 'Judgment call',
  election: 'Election',
  due_diligence: 'Due diligence (Form 8867)',
  penalty: 'Penalty',
  swing_explained: 'Prior-year swing explained',
  sourcing_method: 'State sourcing method',
  completeness: 'Completeness',
  notice_response: 'Notice response',
}

export const DISPOSITION_LABEL: Record<DispositionT, string> = {
  landed: 'Landed on the return',
  informational: 'Informational only',
  duplicate_of: 'Duplicate of…',
  superseded_by: 'Superseded by…',
  applied_to: 'Applied to…',
  contradicted_by: 'Contradicted by…',
  requested: 'Requested from client',
  not_relevant: 'Not relevant',
  carried_forward: 'Carried forward',
  client_notified: 'Client notified',
  accepted_as_is: 'Accepted as is',
}
/** Dispositions that point at another ref. */
export const DISPOSITION_NEEDS_REF = new Set<DispositionT>(['duplicate_of', 'superseded_by', 'applied_to', 'contradicted_by'])

export const NOTE_KIND_LABEL: Record<NoteKindT, string> = {
  memo: 'Memo',
  question_client: 'Question to client',
  question_staff: 'Question to staff',
  review_note: 'Review note',
}

export const RESOLUTION_LABEL: Record<ResolutionT, string> = {
  addressed: 'Addressed',
  cleared: 'Cleared',
  withdrawn: 'Withdrawn',
  not_applicable: 'Not applicable',
}

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

/** Levels a role may act at, default first. Empty: the role has no review level (authorize says why). */
export function levelsFor(role: Role): LevelT[] {
  switch (role) {
    case 'preparer':
      return ['preparer']
    case 'reviewer':
      return ['reviewer', 'preparer']
    case 'partner':
      return ['partner', 'reviewer', 'preparer'] // a partner may take a reviewer-level review over (E49)
    case 'quality_reviewer':
      return ['quality']
    default:
      return []
  }
}

/** The firm verification type a ref most naturally supports (spec 3.2). */
export function suggestMethod(refs: string[]): MethodT {
  for (const r of refs) {
    const k = refKind(r)
    if (k === 'ev' || k === 'doc' || k === 'page') return 'agreed_to_source_document'
    if (k === 'agency') return 'agreed_to_third_party_record'
    if (k === 'qa' || k === 'msg' || k === 'call') return 'confirmed_with_client'
    if (k === 'py') return 'agreed_to_prior_year'
    if (k === 'chk') return 'recalculated'
  }
  return 'agreed_to_source_document'
}

// ── Parsing ─────────────────────────────────────────────────────────────────────────────

export const parseRefs = (s: string): string[] => [...new Set(s.split(/[\s,]+/).filter(Boolean))]
const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean)

/** "19,100", "$19,100.50", "(860)", "−860" → number; anything else → null. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, '').replace('−', '-')
  const neg = /^\(.+\)$/.test(s)
  const n = Number(neg ? s.slice(1, -1) : s)
  if (s === '' || !Number.isFinite(n)) return null
  return neg ? -n : n
}

/** New adjust value, typed like the value it replaces. */
export function parseTo(raw: string, field: AdjustFieldT, current: Val): Val {
  if (field === 'label') return raw
  if (field === 'basis' || typeof current === 'number') return parseAmount(raw)
  if (typeof current === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : null
  return raw.trim()
}

export function formatVal(v: Val | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  const t = parseToken(v)
  return t ? displayMasked(t) : v
}

export const formatSigned = (n: number): string =>
  n === 0 ? '0' : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')}`

// ── Request → draft ─────────────────────────────────────────────────────────────────────

const AREA_TARGETED = new Set<string>(['signoff', 'assign', 'time'])

/** Screens may pass a bare area key; the schema wants `area:<key>`. */
export function normalizeRequest(req: OpenActRequest): OpenActRequest {
  if (AREA_TARGETED.has(req.type) && (AREAS as readonly string[]).includes(req.target)) return { ...req, target: `area:${req.target}` }
  return req
}

/** A required entry (CHK-49) is answered by a decide on its key, e.g. F1040.digital_assets; it is not a claim. */
const REQUIRED_ENTRY = /^[A-Za-z0-9-]+\.[\w.]+$/
const isRequiredEntry = (model: Model, t: string): boolean => !model.claims[t] && REQUIRED_ENTRY.test(t)

export function fixToRequest(f: Finding): OpenActRequest {
  if (!f.fix) return { type: 'resolve', target: f.id }
  const { act, target, field, to, disposition, ref } = f.fix
  const prefill: Record<string, unknown> = { evidence: f.evidence }
  if (field !== undefined) prefill.field = field
  if (to !== undefined) prefill[act === 'decide' ? 'choice' : 'to'] = to // a decide fix's value is the suggested answer
  if (act === 'decide' && f.check === 'CHK-49') prefill.kind = 'completeness' // answering a required entry
  if (disposition !== undefined) prefill.disposition = disposition
  const disp = Disposition.safeParse(disposition)
  const other = ref ?? (disp.success && DISPOSITION_NEEDS_REF.has(disp.data)
    ? (f.claims.find((c) => c !== target) ?? f.evidence.find((e) => e !== target))
    : undefined)
  if (act === 'dispose' && other) prefill.ref = other // body.ref exists only on a dispose
  return { type: act, target, prefill, findings: [f.id] }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const strs = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined
function pick<T>(schema: z.ZodType<T>, v: unknown, fallback: T): T {
  const r = schema.safeParse(v)
  return r.success ? r.data : fallback
}

export function initialDraft(req: OpenActRequest, model: Model, state: State): Draft {
  const p = req.prefill ?? {}
  const t = req.target
  const claim = model.claims[t]
  const findings = (req.findings ?? []).map((id) => model.findingsById[id]).filter(Boolean)
  const findingEvidence = [...new Set(findings.flatMap((f) => f.evidence))]
  const evidence = strs(p.evidence) ?? (findingEvidence.length ? findingEvidence : (claim?.sources ?? []))
  const whatIfId = str(p.what_if) || (t.startsWith('whatif:') ? t.slice('whatif:'.length) : '')
  const alt = model.packet.what_if.alternatives.find((a) => a.id === whatIfId)
  const role = state.viewer.role
  const reviewing = role === 'reviewer' || role === 'partner' || role === 'quality_reviewer'
  const areaKey = t.startsWith('area:') ? (t.slice(5) as keyof State['assignments']) : undefined
  const kind = p.kind
  const requiredEntry = isRequiredEntry(model, t)

  return {
    method: VerifyMethod.safeParse(p.method).data ?? null, // an attesting field starts unanswered; an opener's method still wins
    level: pick(Level, p.level, levelsFor(role)[0] ?? 'preparer'),
    seen: state.claims[t]?.effective ?? null,
    field: pick(AdjustFieldZ, p.field, 'value'),
    to: req.type === 'adjust' && p.to !== undefined && p.to !== null ? String(p.to) : '',
    reason: str(p.reason),
    evidence: evidence.join(', '),
    what_if: whatIfId,
    decideKind: pick(DecideKind, kind, t === 'F8867.status' ? 'due_diligence' : alt ? 'election' : requiredEntry ? 'completeness' : 'judgment'),
    question: str(p.question) || alt?.description || findings[0]?.title || claim?.label || '',
    choice: str(p.choice) || (requiredEntry ? str(findings[0]?.expected) : ''),
    alternatives: (strs(p.alternatives) ?? (alt ? ['Keep the v3 treatment', alt.description] : [])).join('\n'),
    authority: str(p.authority),
    checklist: pick(ChecklistZ, p.checklist, {}),
    disposition: pick(Disposition, p.disposition, claim?.kind === 'doc' ? 'landed' : 'informational'),
    ref: str(p.ref),
    noteKind: pick(NoteKind, kind, reviewing ? 'review_note' : 'memo'),
    text: str(p.text) || (req.type === 'note' ? (findings[0]?.title ?? '') : ''),
    addressee: req.type === 'note' ? str(p.to) : '',
    blocking: p.blocking === true,
    due: str(p.due),
    resolution: pick(ResolutionZ, p.resolution, 'addressed'),
    label: str(p.label),
    file: null,
    filedAgainst: (strs(p.filed_against) ?? [t]).join(', '),
    assignee: str(p.assignee) || (areaKey ? (state.assignments[areaKey] ?? '') : ''),
    hours: str(p.hours),
    timeNote: str(p.note),
    pin: '',
    fileKind: kind === 'extension' ? 'extension' : 'submit',
    jurisdictions: pick(Jur.array().min(1), p.jurisdictions, ['federal', 'california']),
    clockTo: (req.type === 'clock' ? str(p.to) : '') || (state.nextEvent?.at ?? ''),
    event: str(p.event) || (state.nextEvent?.ref ?? ''),
  }
}

// ── Draft → candidate ActInput ──────────────────────────────────────────────────────────

/** The act the form would post. Typed like ActInput but not yet validated: run ActInputZ.safeParse on it. */
export function buildInput(req: OpenActRequest, d: Draft, state: State): ActInput {
  const t = req.target
  const findings = req.findings?.length ? req.findings : undefined
  const evidence = parseRefs(d.evidence)
  const current = state.claims[t]?.effective ?? null
  const optional = (s: string) => (s.trim() ? s.trim() : undefined)

  switch (req.type) {
    case 'verify':
      // The suggestion only stands in to keep the candidate typed (and can() judging it): formErrors blocks it while the method is null.
      return { type: 'verify', target: t, body: { method: d.method ?? suggestMethod(evidence), level: d.level, seen_value: d.seen, evidence, findings } }
    case 'adjust':
      return {
        type: 'adjust', target: t,
        body: { field: d.field, to: parseTo(d.to, d.field, current), reason: d.reason, evidence, what_if: optional(d.what_if), findings },
      }
    case 'decide':
      return {
        type: 'decide', target: t,
        body: {
          kind: d.decideKind, question: d.question, choice: d.choice, alternatives: lines(d.alternatives), authority: d.authority,
          evidence, what_if: optional(d.what_if), checklist: d.decideKind === 'due_diligence' ? d.checklist : undefined, findings,
        },
      }
    case 'dispose':
      return { type: 'dispose', target: t, body: { disposition: d.disposition, ref: optional(d.ref), reason: d.reason, findings } }
    case 'note':
      return {
        type: 'note', target: t,
        body: { kind: d.noteKind, to: optional(d.addressee), text: d.text, blocking: d.noteKind === 'review_note' && d.blocking, due: optional(d.due) },
      }
    case 'reply':
      return { type: 'reply', target: t, body: { text: d.text, attachments: d.file ? [d.file] : [] } }
    case 'resolve':
      return { type: 'resolve', target: t, body: { resolution: d.resolution, text: d.text, authority: optional(d.authority) } }
    case 'attach':
      return {
        type: 'attach', target: t,
        body: { label: d.label, text: optional(d.text), file: d.file ?? undefined, filed_against: parseRefs(d.filedAgainst) },
      }
    case 'signoff':
      return { type: 'signoff', target: t, body: { level: d.level } }
    case 'request_approval':
      return { type: 'request_approval', target: 'return', body: {} }
    case 'client_approve':
      return { type: 'client_approve', target: t, body: { pin: d.pin } }
    case 'file':
      return { type: 'file', target: 'return', body: { kind: d.fileKind, jurisdictions: d.jurisdictions } }
    case 'amend_open':
      return { type: 'amend_open', target: 'return', body: { reason: d.reason } }
    case 'revert':
      return { type: 'revert', target: t, body: { reason: d.reason } }
    case 'assign':
      return { type: 'assign', target: t, body: { assignee: d.assignee, due: optional(d.due) } }
    case 'time':
      return { type: 'time', target: t, body: { hours: parseAmount(d.hours) ?? Number.NaN, note: optional(d.timeNote) } }
    case 'clock':
      return { type: 'clock', target: 'season', body: { to: d.clockTo, event: optional(d.event) } }
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────────────────

type Issue = { path: PropertyKey[]; message: string; code?: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint }

/**
 * A field error in formErrors' plain words. The schema is shared with the server, so Zod's text is translated here: text and
 * list bounds by issue code, the PIN and the hours by field; an issue this mapping does not cover keeps Zod's text.
 */
function plainIssue(i: Issue, key: string): string {
  if (i.code === 'too_small' && i.origin === 'string') return Number(i.minimum) > 1 ? `Write at least ${i.minimum} characters` : 'Required'
  if (i.code === 'too_small' && i.origin === 'array') return 'Choose at least one'
  if (i.code === 'too_big' && i.origin === 'string') return `Write at most ${i.maximum} characters`
  if (i.code === 'too_big' && i.origin === 'array') return `Use at most ${i.maximum} items`
  if (key === 'pin') return 'Enter 5 digits'
  if (key === 'hours') return 'Enter hours above 0, up to 24'
  return i.message
}

/** First issue per field, in plain words. Body fields are keyed by name ('reason'), others by their top key ('target'). */
export function issuesByField(issues: readonly Issue[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of issues) {
    const key = String(i.path[0] === 'body' ? (i.path[1] ?? 'body') : (i.path[0] ?? 'form'))
    out[key] ??= plainIssue(i, key)
  }
  return out
}

/** Rules the schema cannot express because they depend on what the form is editing. */
export function formErrors(req: OpenActRequest, d: Draft, state: State): Record<string, string> {
  const e: Record<string, string> = {}
  if (req.type === 'verify' && !d.method) e.method = 'Choose how you checked it'
  if (req.type === 'adjust') {
    const current = state.claims[req.target]?.effective ?? null
    const to = parseTo(d.to, d.field, current)
    if (!d.to.trim()) e.to = 'Enter the new value'
    else if (to === null) e.to = d.field === 'value' && typeof current === 'boolean' ? 'Choose yes or no' : 'Enter an amount'
    else if (d.field === 'value' && to === current) e.to = 'That is the current value'
  }
  if (req.type === 'decide' && d.decideKind === 'due_diligence') {
    const missing = DUE_DILIGENCE_QUESTIONS.filter((q) => !d.checklist[q.key]).length
    if (missing) e.checklist = `Answer every question (${missing} left)`
  }
  if (req.type === 'dispose' && DISPOSITION_NEEDS_REF.has(d.disposition) && !d.ref.trim()) e.ref = 'Which item does it point to?'
  if (req.type === 'note' && (d.noteKind === 'question_client' || d.noteKind === 'question_staff') && !d.addressee) e.to = 'Choose who should answer'
  if (req.type === 'attach' && !d.text.trim() && !d.file) e.text = 'Paste text or choose a file'
  if (req.type === 'time' && parseAmount(d.hours) === null) e.hours = 'Enter hours, e.g. 1.5'
  if (req.type === 'resolve' && req.target.startsWith('chk:') && !d.authority.trim()) e.authority = 'Cite the authority or firm policy relied on'
  if (req.type === 'clock' && Number.isNaN(Date.parse(d.clockTo))) e.to = 'Enter a date and time, e.g. 2027-01-04T09:00:00Z'
  return e
}

// ── Authorization probe ─────────────────────────────────────────────────────────────────

const PROBE = 'probe'

/** A typed-valid stand-in for an adjust's new value: the right type, and different from the current value. */
function standInTo(field: AdjustFieldT, current: Val): string {
  if (field === 'label') return PROBE
  if (field === 'basis' || typeof current === 'number') return String((typeof current === 'number' ? current : 0) + 1)
  if (typeof current === 'boolean') return String(!current)
  return current === PROBE ? `${PROBE}2` : PROBE
}

/**
 * The draft with stand-ins for the fields the form still has to collect, so can() reports only refusals
 * typing cannot fix (frozen, no clearance, not yet in file, self-review). Only fields with a field error are
 * replaced, and those already block submit; a valid draft comes back unchanged, so what posts is what was judged.
 * Pass the model so an adjust citing a what-if stands in the what-if's value (canOpen does); screens should call canOpen.
 */
export function probeDraft(req: OpenActRequest, d: Draft, state: State, model?: Model): Draft {
  const e = formErrors(req, d, state)
  const patch: Partial<Draft> = {}
  if (req.type === 'adjust' && e.to) {
    // A cited what-if prices only the value it moves this line to, so that value is the one stand-in it accepts.
    const line = model?.packet.what_if.alternatives.find((a) => a.id === d.what_if)?.changed_lines.find((c) => c.key === req.target)
    patch.to = line && d.field === 'value' ? String(line.new) : standInTo(d.field, state.claims[req.target]?.effective ?? null)
  }
  if (req.type === 'dispose' && e.ref) patch.ref = PROBE
  if (e.authority) patch.authority = PROBE // resolving a finding: authorize() refuses a blank authority
  if (req.type === 'clock' && e.to) patch.clockTo = new Date(Date.parse(state.clock) + 86_400_000).toISOString()
  return { ...d, ...patch }
}

/**
 * What an act button shows: the request it opens and whether the viewer may record it, judged on the probed
 * draft. A verify or sign-off without a level tries every level the role has (a reviewer who prepared the
 * claim may still verify it as preparer), and opens at the first one allowed.
 */
export function canOpen(request: OpenActRequest, ws: Pick<Workspace, 'model' | 'state' | 'can'>): { req: OpenActRequest; auth: AuthResult } {
  const base = normalizeRequest(request)
  const levels = (base.type === 'verify' || base.type === 'signoff') && base.prefill?.level === undefined ? levelsFor(ws.state.viewer.role) : []
  const tries = (levels.length ? levels.map((level) => ({ ...base, prefill: { ...base.prefill, level } })) : [base])
    .map((req) => ({ req, auth: ws.can(buildInput(req, probeDraft(req, initialDraft(req, ws.model, ws.state), ws.state, ws.model), ws.state)) }))
  return tries.find((t) => t.auth.ok) ?? tries[0]
}

// ── Previews ────────────────────────────────────────────────────────────────────────────

export interface AdjustPreview {
  from: Val
  effect: AdjustDerived['effect'] | null
  /** The server's needs_partner, judged on the move from the packet value (lead decision), not on this step alone. */
  partner: boolean
  hint?: string
}

/** What an adjust would replace and its tax effect, from the server's own deriveFor() so the two cannot disagree. */
export function previewAdjust(model: Model, state: State, target: string, field: AdjustFieldT, to: Val, whatIf: string): AdjustPreview {
  const input: ActInput = { type: 'adjust', target, body: { field, to, reason: '', evidence: [], what_if: whatIf || undefined } }
  const d = deriveFor(model, state, input) as unknown as AdjustDerived // its adjust branch returns { ...AdjustDerived }
  const { from, effect } = d
  if (effect.basis === 'what_if') return { from, effect, partner: d.needs_partner, hint: 'Exact engine result from the cited what-if' }
  const line = model.lines[target]
  if (!line) return { from, effect: null, partner: d.needs_partner, hint: 'Not a return line: no direct tax effect' }
  if (field === 'label') return { from, effect, partner: d.needs_partner, hint: 'Wording only: no tax effect' }
  const unread = field === 'basis' && from === null ? 'No basis was read for this row, so the change is measured from 0.' : undefined
  const hint = [effectSpec(line, field).hint, unread].filter(Boolean).join(' ') || undefined
  const typed = typeof to === 'number'
  return { from, effect: typed ? effect : null, partner: typed && d.needs_partner, hint }
}

/** Review-note text proposing an adjust. A sensitive value is left out: free text is stored unmasked. An amount reads as the line shows it. */
export function proposalText(model: Model, target: string, field: AdjustFieldT, from: Val, to: string, reason: string): string {
  const v = parseTo(to, field, from)
  const change = model.claims[target]?.sensitive
    ? 'new value withheld (sensitive)'
    : `${formatVal(from)} → ${typeof v === 'number' || typeof v === 'boolean' ? formatVal(v) : to.trim() || '?'}`
  return `Proposed ${field}: ${change}. ${reason}`.trim()
}
