// Pure helpers of the Filing page (spec 3, §3 to §6 and §8.2): refs in words, in-page links, who owns a step, the status
// line, the extension's amounts and keys, the simulation rule's wording, act reasons and the sign-off view. No React
// here, so vitest runs it in node against buildModel(maskedPacket) + project(...). It lives apart from filing-logic.ts,
// which the client portal bundles through client-copy.tsx, because the status line needs the queue and Overview models.
import { canOpen } from '@/components/acts/draft'
import { formatMoney, refHref, refLabel } from '@/components/atoms/format'
import { nextOf } from '@/components/overview/overview-model'
import { areaOfRef, latestSignoffs, myAreas, nextAction } from '@/components/queue/queue-model'
import { resolveRef } from '@/components/trace/resolve'
import { targetText } from '@/components/workspace/log'
import type { OpenActRequest } from '@/components/workspace/types'
import type { ActInput } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import type { Model } from '@/lib/model/build'
import { AREAS, AREA_LABEL, type AreaKey } from '@/lib/model/ids'
import type { Money as PacketMoney } from '@/lib/model/packet-types'
import type { AuthResult, NoteView, Role, State, StepView, Viewer } from '@/lib/model/state'
import { identities } from '@/lib/model/viewer'
import { type CellState, MATRIX_LEVELS, type MatrixLevel, partnerDesk, signoffMatrix, signTargets } from './filing-logic'

export type Jur = 'federal' | 'california'
/** Jurisdictions in words (§3.2). */
export const JUR: Record<Jur, string> = { federal: 'federal', california: 'California' }
/** Both jurisdictions, federal first: the order every list of them on the page uses. */
export const JURS: readonly Jur[] = ['federal', 'california']
/** The first letter in upper case: cap(JUR.federal) is "Federal". */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The spec's name(id) (§3.1): the staff or client name, falling back to the id. */
export function nameOf(model: Model, id: string): string {
  return identities(model.packet).find((v) => v.id === id)?.name ?? id
}

/**
 * A ref in words (§4.5), first match: refLabel (a claim label, finding title, extracted value or document page); a staff
 * or client name; targetText(ref) when it differs from ref and is not empty (an area, "the return", "change N"); the
 * title of a packet location (resolveRef kind 'data'); else the ref itself. Long labels are clamped by CSS, never cut here.
 */
export function labelOf(model: Model, ref: string): string {
  const label = refLabel(model, ref)
  if (label !== undefined) return label
  const person = identities(model.packet).find((v) => v.id === ref)
  if (person) return person.name
  const target = targetText(ref)
  if (target !== ref && target !== '') return target
  const resolved = resolveRef(model, ref)
  return resolved.kind === 'data' ? resolved.title : ref
}

/** The three model phrases that carry codes (§4.5), keyed by the model's exact `what`; the model text is unchanged. */
export const PLAIN_WHAT: Readonly<Record<string, string>> = {
  'Identity not verified D or T (or decided with authority)': 'Identity not verified to a document or a third-party record, or decided with authority',
  "Due diligence not documented (F8867 'Not completed')": 'Due diligence not documented: Form 8867 says not completed',
  'Identity (step 2) not green': 'Step 2 (identity) not done',
}
export function plainWhat(what: string): string {
  return Object.hasOwn(PLAIN_WHAT, what) ? PLAIN_WHAT[what] : what
}

/** Where an item behind a step is fixed (§4.5): steps, areas, the return and clients on this page; anything else on its
 * trace page. */
export function itemHref(step: number | null, ref: string): string {
  const n = /^step:(\d+)$/.exec(ref)
  if (n) return `#step-${n[1]}`
  if (ref.startsWith('area:')) return `#signoff-${ref.slice(5)}`
  if (ref === 'return') return step === 12 ? '#approval' : '#signoff-return'
  if (/^cu-\d+$/.test(ref)) return '#approval'
  return refHref(ref)
}

const DESK_WHAT = 'Over 1,000 without a valid partner sign-off'

/**
 * The step's "Fix this" target (§4.5). Steps 1 to 9: the first item of the first reason; 10: the sign-offs; 11: the partner
 * desk when an adjustment over 1,000 lacks a partner sign-off, else the whole-return sign-off; 12: approval. A step with
 * no reason (green, so never rendered) points at its own row. Reads `text` when `what` is absent.
 */
export function stepFix(step: StepView): { href: string } {
  const first = step.reasons[0]
  if (!first) return { href: `#step-${step.n}` }
  if (step.n === 10) return { href: '#matrix' }
  if (step.n === 11) return { href: step.reasons.some((r) => (r.what ?? r.text).startsWith(DESK_WHAT)) ? '#desk' : '#signoff-return' }
  if (step.n === 12) return { href: '#approval' }
  const ref = first.refs?.[0] ?? first.ref
  return { href: ref ? itemHref(step.n, ref) : `#step-${step.n}` }
}

/** Who acts on a step 1 to 9 (§3.1), a staff id: blockersOf's rule, the assignee of the area of the step's first ref, else
 * the starting preparer. */
export function stepOwner(model: Model, state: State, step: StepView): string {
  const area = areaOfRef(model, step.reasons[0]?.ref ?? `step:${step.n}`)
  return (area ? state.assignments[area] : undefined) ?? model.packet.firm.assignment_at_start.preparer
}

/** The open blocking review notes, in state.notes order: the gate's own filter (project.ts). */
export function blockingNotes(state: State): NoteView[] {
  return state.notes.filter((n) => n.open && n.blocking && n.kind === 'review_note')
}

/** An extension figure (§8.2): the packet's maps hold numbers or text. */
export function amount(v: PacketMoney | string | undefined): string {
  return v == null ? '—' : typeof v === 'number' ? formatMoney(v) : String(v)
}

/** The extension estimate's keys in words (§8.2); any other key shows with spaces and a capital first letter. */
export const EXT_KEYS: Readonly<Record<string, string>> = {
  estimated_total_tax: 'Estimated total tax',
  payments: 'Payments',
  estimated_balance: 'Estimated balance',
  rule: 'How the payment was sized',
}
export function plainKey(key: string): string {
  return Object.hasOwn(EXT_KEYS, key) ? EXT_KEYS[key] : cap(key.replaceAll('_', ' '))
}

/** The packet path the disclosed e-file rule quotes (server/agency.ts EFILE_RULE), and its words. */
const RULE_PATH = 'py:/return_2024/dependents'
const RULE_PATH_WORDS = "the 2024 return's dependents"

/**
 * The disclosed simulation rule as displayed (§8.1, criterion 4): the rule text the agency act stored, with its packet path
 * in words. Display only: EFILE_RULE is server-owned and already stored in acts, so it is not edited; any other text is
 * returned unchanged.
 */
export function plainRule(rule: string): string {
  return rule.replaceAll(RULE_PATH, RULE_PATH_WORDS)
}

// ── The status line (§3) ─────────────────────────────────────────────────────────────────────

const stepAt = (state: State, n: number): StepView | undefined => state.steps.find((s) => s.n === n)
/** The first red step among 1 to 9 (the preparers' work). */
const firstOpenWork = (state: State): StepView | undefined => state.steps.find((s) => s.n <= 9 && !s.ok)
const lastSubmit = (state: State) => state.filings.filter((f) => f.kind === 'submit').at(-1)
const moreAreas = (k: number) => (k > 1 ? ` and ${k - 1} more ${k - 1 === 1 ? 'area' : 'areas'}` : '')
/** P18: a jurisdiction is filed and accepted and a required step is red. authorize's frozenFor then refuses every sign-off
 * and Request approval, so only the partner's amendment moves filing on. */
const amendFirst = (state: State): boolean => JURS.some((j) => state.frozen[j]) && state.steps.some((s) => !s.ok)

/** §3.1's shared ending, for a staff viewer with nothing to do and no role-specific reason. First match wins; no full stop. */
export function ending(model: Model, state: State): string {
  if (amendFirst(state)) return 'the partner opens an amendment first'
  if (!stepAt(state, 10)?.ok) return 'the reviewer signs every area first (step 10)'
  if (!stepAt(state, 11)?.ok) return 'the partner signs next'
  const open = firstOpenWork(state)
  if (open) return `${nameOf(model, stepOwner(model, state, open))} clears step ${open.n} first`
  const m = blockingNotes(state).length
  if (m > 0) return `${m} blocking review ${m === 1 ? 'note' : 'notes'} must be resolved first`
  if (!state.approval?.current) return 'the reviewer or partner requests client approval next'
  if (state.gates.submit.ok) return 'the partner submits next'
  return 'waiting for the clients to approve'
}

export interface FilingStatus {
  /** The state sentence(s): "Filing is blocked: 0 of 12 required steps done." */
  headline: string
  /** The viewer's next step for filing, with where it is done; null when they have none. */
  next: { text: string; href: string } | null
  /** Why the viewer has no next step: one sentence ending with a full stop. `link`, when set, names a phrase that occurs
   * once in `text` and renders as a link. Null when `next` is set. */
  none: { text: string; link: { text: string; href: string } | null } | null
}

/** §3.2 prefixes, in order: an open amendment, then the latest submit's rejections or holds while it is not all frozen. */
function prefixes(state: State): string[] {
  const out: string[] = []
  if (!JURS.some((j) => state.frozen[j]) && state.amendment > 0) out.push(`Amendment ${state.amendment} is open.`)
  const last = lastSubmit(state)
  if (!last || last.jurisdictions.every((j) => state.frozen[j])) return out
  const rejected = last.results.filter((r) => r.status === 'rejected')
  const held = last.results.filter((r) => r.status === 'held').map((r) => JUR[r.jurisdiction]).join(' and ')
  if (rejected.length) {
    const codes = rejected.map((r) => `${JUR[r.jurisdiction]} ${r.errors[0]?.code ?? 'no code'}`).join(', ')
    out.push(`E-file rejected: ${codes}${held ? `; ${held} held` : ''}.`)
  } else if (held) out.push(`E-file held: ${held}.`)
  return out
}

/** §3.2 state sentence, first match wins. Request approval passes only with steps 1 to 11 done and no blocking note open. */
function stateSentence(model: Model, state: State): string {
  const N = state.steps.length
  const done = state.steps.filter((s) => s.ok).length
  const frozen = JURS.filter((j) => state.frozen[j])
  if (frozen.length) {
    const open = JURS.find((j) => !state.frozen[j])
    const tail = open ? ` ${cap(JUR[open])} is not filed and accepted yet.` : ' The return is frozen; any change needs an amendment.'
    return `Filed and accepted: ${frozen.map((j) => JUR[j]).join(' and ')}.${tail}`
  }
  if (state.gates.submit.ok) return `Ready to submit: all ${N} required steps are done.`
  if (!state.gates.request_approval.ok) {
    const m = blockingNotes(state).length
    return `Filing is blocked: ${done} of ${N} required steps done${m ? `; ${m} blocking review ${m === 1 ? 'note is' : 'notes are'} open` : ''}.`
  }
  if (!state.approval) return `Ready to request client approval: ${done} of ${N} required steps done.`
  if (!state.approval.current) return 'Client approval must be requested again: an amount changed after the request.'
  const { approvals } = state.approval
  const left = model.packet.firm.client_users.filter((u) => !approvals.some((a) => a.signer === u.id && a.valid))
  return `Waiting for client approval: ${left.map((u) => u.name).join(' and ')} ${left.length === 1 ? 'has' : 'have'} not approved yet.`
}

type Outcome = Pick<FilingStatus, 'next' | 'none'>
const go = (text: string, href: string): Outcome => ({ next: { text, href }, none: null })
const rest = (text: string, link: { text: string; href: string } | null = null): Outcome => ({ next: null, none: { text, link } })
const yet = (model: Model, state: State): Outcome => rest(`Nothing for filing needs you yet: ${ending(model, state)}.`)

/** §3.3 partner rows. The reviewer and partner rules are nextOf's, so the return's sign-off waits for step 10 as on the Overview. */
function partnerNext(model: Model, state: State, viewer: Viewer): Outcome {
  const can = (input: ActInput) => authorize(model, state, input, viewer)
  // Holds alone do not count: a held filing is submitted again as it is.
  if (lastSubmit(state)?.results.some((r) => r.status === 'rejected') && state.gates.submit.ok) {
    return go('fix what the rejection names, then submit again', '#filings')
  }
  const open = JURS.filter((j) => !state.frozen[j])
  if (state.gates.submit.ok && can({ type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: open } }).ok) {
    return go('submit the return', '#approval')
  }
  const { items } = nextOf(model, state, viewer)
  if (items.some((i) => i.kind === 'request_approval')) return go('request client approval', '#approval')
  // Uncovered adjustments only, as step 11 and the Overview count them; the CHK-56 findings on the desk are never named here.
  const adj = partnerDesk(model, state).filter((i) => !i.covered && i.kind === 'adjust')
  if (adj.length && signTargets(adj).some((target) => can({ type: 'signoff', target, body: { level: 'partner' } }).ok)) {
    return go(`sign off ${adj.length} ${adj.length === 1 ? 'adjustment' : 'adjustments'} on the partner desk`, '#desk')
  }
  if (items.some((i) => i.kind === 'return_signoff')) return go('partner sign-off on the whole return', '#signoff-return')
  return yet(model, state)
}

/** §3.3 reviewer rows. */
function reviewerNext(model: Model, state: State, viewer: Viewer): Outcome {
  const { items, total } = nextOf(model, state, viewer)
  if (items.some((i) => i.kind === 'request_approval')) {
    // P18: nextOf offers it when only step 12 is red, but authorize refuses it under any freeze.
    if (amendFirst(state)) return yet(model, state)
    return go('request client approval', '#approval')
  }
  const owed = items.find((i) => i.kind === 'signoff_owed')
  if (owed) {
    // nextOf caps items at five but counts every owed area in total, which holds no request_approval at this point.
    const key = owed.context.slice(5) as AreaKey
    return go(`review sign-off on ${AREA_LABEL[key]}${moreAreas(total)}`, `#signoff-${key}`)
  }
  // True even while reviewer Sign buttons exist: nextOf owes a review only after the preparer signs.
  const waiting = items.find((i) => i.kind === 'waiting')
  if (waiting) return rest(`No review sign-off is owed yet: ${waiting.text.charAt(0).toLowerCase()}${waiting.text.slice(1)}.`)
  return yet(model, state)
}

/** §3.3 preparer rows: nextAction's step fallback limited to the steps the viewer owns, then their own area sign-offs. */
function preparerNext(model: Model, state: State, viewer: Viewer): Outcome {
  const own = state.steps.find((s) => s.n <= 9 && !s.ok && stepOwner(model, state, s) === viewer.id)
  if (own) return go(`step ${own.n}, ${own.label}`, `#step-${own.n}`)
  const latest = latestSignoffs(state.signoffs)
  const mine = myAreas(state, viewer)
  const unsigned = AREAS.filter((key) =>
    mine.has(key)
    && !latest.some((s) => s.target === `area:${key}` && s.level === 'preparer' && s.valid)
    && authorize(model, state, { type: 'signoff', target: `area:${key}`, body: { level: 'preparer' } }, viewer).ok)
  if (unsigned.length) return go(`preparer sign-off on ${AREA_LABEL[unsigned[0]]}${moreAreas(unsigned.length)}`, `#signoff-${unsigned[0]}`)
  const other = firstOpenWork(state)
  if (other) return rest(`Nothing for filing is assigned to you: ${nameOf(model, stepOwner(model, state, other))} clears step ${other.n} first.`)
  return yet(model, state)
}

/** §3.3: the viewer's next step for filing, first match wins. It reuses nextAction, nextOf and authorize; where it repeats
 * one of their expressions (rule 2's reopened sign-off below, blockersOf's owner rule in stepOwner), the comment says so. */
function nextFor(model: Model, state: State, viewer: Viewer): Outcome {
  if (viewer.kind === 'client') return rest('Clients use the client portal.')
  // The Overview's words; authorize refuses every act before this date.
  if (state.clock.slice(0, 10) < viewer.active_from) return rest(`You are not active until ${viewer.active_from}; your actions are refused until then.`)
  if (state.frozen.federal && state.frozen.california) {
    return viewer.role === 'partner'
      ? rest('Nothing for filing needs you: open an amendment only if a value must change.', { text: 'open an amendment', href: '#filings' })
      : rest('Nothing for filing needs you: the return is filed.')
  }
  if (viewer.role === 'firm_administrator') return rest('Nothing for filing is yours: the firm administrator is read-only on the return.')
  if (viewer.role === 'quality_reviewer') {
    const accepted = state.filings.some((f) => f.kind === 'submit' && f.results.some((r) => r.status === 'accepted'))
    return rest(accepted ? 'Quality sign-off is not on this page.' : 'Quality review opens after an accepted filing.')
  }
  // Preparer, reviewer and partner: nextAction's rule 1 (a blocking review note on the viewer's work), then rule 2's expression.
  const action = nextAction(model, state, viewer)
  const note = action?.kind === 'note' ? state.notes.find((n) => `act:${n.seq}` === action.request?.target) : undefined
  if (note) return go(`answer ${nameOf(model, note.actor)}'s blocking review note on ${labelOf(model, note.target)}`, refHref(`act:${note.seq}`))
  // P18: no sign-off, re-sign or request moves filing on until the partner opens an amendment. Only the rows that would
  // send a viewer to re-sign or request approval read the ending; the other sign-off rows already filter on authorize.
  if (amendFirst(state) && viewer.role === 'partner') return go('open an amendment', '#filings')
  const reopened = latestSignoffs(state.signoffs).find((s) => s.actor === viewer.id && !s.valid)
  if (reopened) {
    if (amendFirst(state)) return yet(model, state)
    if (reopened.target === 'return') return go(`re-sign your reopened ${reopened.level} sign-off on the whole return`, '#signoff-return')
    const key = reopened.target.slice(5) as AreaKey
    return go(`re-sign your reopened ${reopened.level} sign-off on ${AREA_LABEL[key]}`, `#signoff-${key}`)
  }
  if (viewer.role === 'partner') return partnerNext(model, state, viewer)
  if (viewer.role === 'reviewer') return reviewerNext(model, state, viewer)
  return preparerNext(model, state, viewer)
}

/** The Filing page's status line (§3): the state sentence(s), then the viewer's next step for filing or why there is none. */
export function filingStatus(model: Model, state: State, viewer: Viewer): FilingStatus {
  return { headline: [...prefixes(state), stateSentence(model, state)].join(' '), ...nextFor(model, state, viewer) }
}

// ── Act reasons (§5) ────────────────────────────────────────────────────────────────────

export type FilingGate = keyof State['gates'] // 'request_approval' | 'submit'

/** §5: null when state.gates[gate].ok; else red steps among 1..11 (request_approval) or 1..12 (submit), and blockingNotes(state).length. */
export function gateBlock(state: State, gate: FilingGate): { steps: number; notes: number } | null {
  if (state.gates[gate].ok) return null
  const last = gate === 'request_approval' ? 11 : 12
  return { steps: state.steps.filter((s) => s.n <= last && !s.ok).length, notes: blockingNotes(state).length }
}

/** §5: canOpen(request, { model, state: s2, can: (i) => authorize(model, s2, i, viewer) }).auth with s2's gate forced to
 * { ok: true, reasons: [] }; gate === null judges the live state. Words the reason only; never decides enabling. */
export function apartFromGate(model: Model, state: State, viewer: Viewer, request: OpenActRequest, gate: FilingGate | null): AuthResult {
  const s2: State = gate === null ? state : { ...state, gates: { ...state.gates, [gate]: { ok: true, reasons: [] } } }
  return canOpen(request, { model, state: s2, can: (i) => authorize(model, s2, i, viewer) }).auth
}

// ── Sign-offs (§6) ──────────────────────────────────────────────────────────────────────

/** A role's own sign-off level (§14 ruling 6). The administrator, the quality reviewer and clients have none. */
export const OWN_LEVEL: Partial<Record<Role, MatrixLevel>> = { preparer: 'preparer', reviewer: 'reviewer', partner: 'partner' }

export interface SignoffCellView {
  target: string; level: MatrixLevel; state: CellState
  by: string | null           // the signer's name, when signed (valid or reopened)
  changed: string[]           // reopened: the changed claims; [] otherwise
  action: 'Sign' | 'Re-sign' | null
  refusal: string | null      // the viewer's own level only, verbatim; null on a valid cell and whenever `note` is set
  whoSigns: string | null     // empty cells the viewer cannot sign, other levels: "Helen Strand signs"
}
export interface SignoffRowView { target: string; label: string; href: string | null; anchor: string; cells: SignoffCellView[] }

/** §6 "who signs": the staff whose own level is the cell's, in identities() order, that authorize() lets sign it; while
 * nobody passes, the next level up (the body keeps the cell's level). "A or B signs"; null when nobody passes. */
function whoSigns(model: Model, state: State, target: string, level: MatrixLevel): string | null {
  const staff = identities(model.packet).filter((p) => p.kind === 'staff')
  for (const rank of MATRIX_LEVELS.slice(MATRIX_LEVELS.indexOf(level))) {
    const names = staff
      .filter((p) => OWN_LEVEL[p.role] === rank && authorize(model, state, { type: 'signoff', target, body: { level } }, p).ok)
      .map((p) => p.name)
    if (names.length) return `${names.join(' or ')} signs`
  }
  return null
}

/** §6. Rows from signoffMatrix(state) (filing-logic, unchanged), in its order: 9 areas then 'return' ("Whole return").
 * href: `/queue?area=<key>&mine=0` for an area, null for the return; anchor: `signoff-<key>` | `signoff-return`. */
export function signoffView(model: Model, state: State, viewer: Viewer, can: (i: ActInput) => AuthResult): { rows: SignoffRowView[]; note: string | null } {
  const own = OWN_LEVEL[viewer.role]
  const judged = signoffMatrix(state).map((row) => ({
    row,
    auths: row.cells.map((c) => canOpen({ type: 'signoff', target: c.target, prefill: { level: c.level } }, { model, state, can }).auth),
  }))
  // Nothing signable anywhere: one note (the first cell's reason) instead of a refusal per cell.
  const first = judged[0].auths[0]
  const note = judged.some((j) => j.auths.some((a) => a.ok)) || first.ok ? null : first.reason
  const rows = judged.map(({ row, auths }): SignoffRowView => {
    const key = row.target === 'return' ? 'return' : row.target.slice('area:'.length)
    return {
      target: row.target,
      label: row.label,
      href: row.target === 'return' ? null : `/queue?area=${key}&mine=0`,
      anchor: `signoff-${key}`,
      cells: row.cells.map((c, i): SignoffCellView => {
        const auth = auths[i]
        return {
          target: c.target,
          level: c.level,
          state: c.state,
          by: c.signoff ? nameOf(model, c.signoff.actor) : null,
          changed: c.state === 'reopened' ? (c.signoff?.changed ?? []) : [],
          action: !auth.ok || c.state === 'valid' ? null : c.state === 'empty' ? 'Sign' : 'Re-sign',
          refusal: !auth.ok && note === null && c.level === own && c.state !== 'valid' ? auth.reason : null,
          whoSigns: !auth.ok && c.state === 'empty' && c.level !== own ? whoSigns(model, state, c.target, c.level) : null,
        }
      }),
    }
  })
  return { rows, note }
}
