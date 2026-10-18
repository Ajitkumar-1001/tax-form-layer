// Pure half of the filing desk (spec §3.6): sign-off matrix, partner desk, approval status, filings,
// season record and extension facts. No React, so vitest runs it in node.
import { actorName, VERB } from '@/components/workspace/log'
import type { Act, ActType } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import { needsPartner } from '@/lib/model/effects'
import { AREA_LABEL, type AreaKey, SEASON_START } from '@/lib/model/ids'
import type { Packet } from '@/lib/model/packet-types'
import { claimsOfRef, indexActs } from '@/lib/model/project'
import type { FilingView, SignoffView, State } from '@/lib/model/state'
import { identities } from '@/lib/model/viewer'

// ── Sign-off matrix ─────────────────────────────────────────────────────────────────────

export type MatrixLevel = 'preparer' | 'reviewer' | 'partner'
export const MATRIX_LEVELS: MatrixLevel[] = ['preparer', 'reviewer', 'partner']
export type CellState = 'valid' | 'reopened' | 'empty'

export interface MatrixCell {
  target: string
  level: MatrixLevel
  state: CellState
  signoff?: SignoffView
}
export interface MatrixRow {
  target: string // area:<key> | return
  label: string
  cells: MatrixCell[]
}

/** The latest sign-off per target and level (later ones replace earlier ones). */
export function latestSignoffs(signoffs: SignoffView[]): Map<string, SignoffView> {
  const out = new Map<string, SignoffView>()
  for (const s of signoffs) out.set(`${s.target}|${s.level}`, s)
  return out
}

const cell = (latest: Map<string, SignoffView>, target: string, level: MatrixLevel): MatrixCell => {
  const s = latest.get(`${target}|${level}`)
  return { target, level, state: !s ? 'empty' : s.valid ? 'valid' : 'reopened', ...(s && { signoff: s }) }
}

export function signoffMatrix(state: State): MatrixRow[] {
  const latest = latestSignoffs(state.signoffs)
  const row = (target: string, label: string): MatrixRow => ({ target, label, cells: MATRIX_LEVELS.map((l) => cell(latest, target, l)) })
  return [...state.areas.map((a) => row(`area:${a.key}`, a.label)), row('return', 'Whole return')]
}

// The acts that can move a claim's hash (project.ts): values and decisions, evidence (attachments, replies, applied comms),
// findings and open notes. An act reaches the claims its refs name and every claim of a finding it cleared, which can sit
// in another area. Silent: a reopen by the season clock, a batch revert, and a revert of a clearing act on the claims only
// its findings named (a reverted act is no longer live, so nothing records which findings it had cleared).
const SINCE = new Set<ActType>(['verify', 'adjust', 'decide', 'dispose', 'note', 'reply', 'resolve', 'attach', 'revert'])

/** A reopened sign-off's "since then": each live act after it that touches a changed claim, as "<verb> by <name>", once
 * each, oldest first. [] while the sign-off is valid. */
export function sinceSigned(model: Model, state: State, s: SignoffView): string[] {
  if (s.valid) return []
  const ix = indexActs(state.acts)
  const changed = new Set(s.changed)
  const people = identities(model.packet)
  // seq → the claims of the findings that act cleared, as the projection records them (resolvedBy: the first live act).
  const cleared = new Map<number, string[]>()
  for (const f of Object.values(state.findings)) {
    if (f.resolvedBy) cleared.set(f.resolvedBy.seq, [...(cleared.get(f.resolvedBy.seq) ?? []), ...(model.findingsById[f.id]?.claims ?? [])])
  }
  const reached = (a: Act) => [...a.refs.flatMap((r) => claimsOfRef(model, ix.bySeq, r)), ...(cleared.get(a.seq) ?? [])]
  return [...new Set(ix.live
    .filter((a) => a.seq > s.seq && SINCE.has(a.type) && reached(a).some((c) => changed.has(c)))
    .map((a) => `${VERB[a.type]} by ${actorName(people, a.actor)}`))]
}

// ── Partner desk ────────────────────────────────────────────────────────────────────────

export interface DeskItem {
  key: string // act:<seq> for an adjust, the finding id for a finding
  kind: 'adjust' | 'finding'
  target: string // the claim it changes or attaches to
  area: AreaKey | null
  reason: string
  effect: { fed: number; ca: number }
  preparedBy: string[]
  evidence: string[]
  covered: boolean
}

const PARTNER_STEP = 'step:11'

/** Is there a valid partner sign-off over the claim's area (or the return) by someone who did not prepare it? */
function partnerCovers(model: Model, state: State, claim: string): boolean {
  const area = model.claims[claim]?.area
  const preparers = state.claims[claim]?.preparedBy ?? []
  return state.signoffs.some(
    (s) => s.valid && s.level === 'partner' && (s.target === 'return' || s.target === `area:${area}`) && !preparers.includes(s.actor),
  )
}

/** Every live adjust over 1,000, and every open process finding over 1,000 or routed to the partner step (CHK-56). */
export function partnerDesk(model: Model, state: State): DeskItem[] {
  const adjusts: DeskItem[] = state.adjusts
    .filter((v) => !v.reverted && v.needs_partner)
    .map((v) => ({
      key: `act:${v.seq}`, kind: 'adjust', target: v.target, area: model.claims[v.target]?.area ?? null,
      reason: `${v.field === 'value' ? '' : `${v.field}: `}${show(v.from)} → ${show(v.to)}. ${v.reason}`,
      effect: { fed: v.effect.fed, ca: v.effect.ca }, preparedBy: [v.actor], evidence: v.evidence, covered: v.partner_covered,
    }))
  const findings: DeskItem[] = model.findings
    .filter((f) => f.family === 'process_control' && state.findings[f.id]?.visible && state.findings[f.id]?.status === 'open')
    .filter((f) => (f.stake && needsPartner(f.stake)) || f.claims.includes(PARTNER_STEP))
    .map((f) => {
      const target = f.claims[0] ?? PARTNER_STEP
      return {
        key: f.id, kind: 'finding', target, area: model.claims[target]?.area ?? null, reason: f.title,
        effect: { fed: f.stake?.fed ?? 0, ca: f.stake?.ca ?? 0 }, preparedBy: state.claims[target]?.preparedBy ?? [],
        evidence: f.evidence, covered: partnerCovers(model, state, target),
      }
    })
  return [...adjusts, ...findings]
}

/** Partner sign-off targets that cover the selected items: one per area, the whole return when an item has none. */
export function signTargets(items: DeskItem[]): string[] {
  return [...new Set(items.map((i) => (i.area ? `area:${i.area}` : 'return')))]
}

const show = (v: unknown): string => (typeof v === 'number' ? v.toLocaleString('en-US') : v === null || v === undefined ? '—' : String(v))

// ── Approval ────────────────────────────────────────────────────────────────────────────

export type SpouseStatus = 'not_requested' | 'pending' | 'approved' | 'reopened'

export function spouseStatus(state: State, signer: string): SpouseStatus {
  const ap = state.approval
  if (!ap) return 'not_requested'
  const mine = ap.approvals.filter((x) => x.signer === signer)
  if (mine.some((x) => x.valid)) return 'approved'
  return mine.length || !ap.current ? 'reopened' : 'pending'
}

// ── Filings ─────────────────────────────────────────────────────────────────────────────

export interface FilingResultRow {
  seq: number
  jurisdiction: 'federal' | 'california'
  status: 'accepted' | 'rejected' | 'held'
  errors: { code: string; message: string }[]
  season_at: string
  retainUntil?: string
  rule?: string
}

/** Agency results of a filing with their season time, retention date and the disclosed simulation rule. */
export function filingResults(state: State, f: FilingView): FilingResultRow[] {
  const bySeq = new Map<number, Act>(state.acts.map((a) => [a.seq, a]))
  return f.results.map((r) => {
    const a = bySeq.get(r.seq)
    const retain = (a?.derived as { retain_until?: unknown } | undefined)?.retain_until
    const rule = (a?.body as { rule?: unknown } | undefined)?.rule
    return {
      ...r, season_at: a?.season_at ?? '',
      ...(typeof retain === 'string' && { retainUntil: retain }), ...(typeof rule === 'string' && { rule }),
    }
  })
}

// ── Season record and extension (packet facts, never our acts) ─────────────────────────

export interface SeasonEvent {
  id: string
  at: string
  event: string
  actor: string | null
  detail: string | null
  refs: string[]
  efile: { jurisdiction: string; status: string; submission_id: string; errors: { code: string; message: string }[] }[]
}

/** Signature PINs printed in packet text (tl-20) are not shown on screen. */
export const redactPins = (text: string): string => text.replace(/\bPIN (\d{4,6})\b/g, 'PIN •••••')

/** Packet timeline events after v3 was computed: passed (at or before the clock) and upcoming. */
export function seasonRecord(p: Packet, clock: string): { passed: SeasonEvent[]; upcoming: SeasonEvent[] } {
  const all = p.timeline
    .filter((t) => t.at > SEASON_START)
    .map((t) => ({
      id: t.id, at: t.at, event: t.event.replaceAll('_', ' '), actor: t.actor, detail: t.detail && redactPins(t.detail), refs: t.refs,
      efile: /^efile_/.test(t.event)
        ? p.tax_agency_records.efile.filter((e) => e.date === t.at).map((e) => ({
            jurisdiction: e.jurisdiction, status: e.status, submission_id: e.submission_id, errors: e.errors ?? [],
          }))
        : [],
    }))
  return { passed: all.filter((e) => e.at <= clock), upcoming: all.filter((e) => e.at > clock) }
}

export interface TranscriptRow {
  date: string
  code: string
  description: string
  amount: number | string
}

/** IRS transcript rows for codes 460 (extension) and 670 (payments) from the latest transcript in file at the clock. */
export function extensionTranscript(p: Packet, clock: string): { asOf: string | null; rows: TranscriptRow[]; later: string | null } {
  const ts = p.tax_agency_records.irs_account_transcript_2025
  const today = clock.slice(0, 10)
  const known = ts.filter((t) => t.as_of <= today).sort((a, b) => a.as_of.localeCompare(b.as_of)).at(-1)
  const later = ts.filter((t) => t.as_of > today).map((t) => t.as_of).sort()[0] ?? null
  const rows = (known?.transactions ?? []).filter((x) => x.code === '460' || x.code === '670') as TranscriptRow[]
  return { asOf: known?.as_of ?? null, rows, later }
}

// ── Client copy ─────────────────────────────────────────────────────────────────────────

// The engine's balance lines (F1040.37, F540NR.97) are left out: the summary states the balance with every change.
export const KEY_LINES: { federal: string[]; california: string[] } = {
  federal: ['F1040.1z', 'F1040.9', 'F1040.11', 'F1040.15', 'F1040.24', 'F1040.33'],
  california: ['F540NR.17', 'F540NR.32', 'F540NR.35', 'F540NR.64', 'F540NR.78'],
}

export interface CopyLine {
  key: string
  label: string
  value: number | string | boolean | null
  /** An input was adjusted and this engine value does not include it. A line whose VALUE was adjusted itself holds the person's value. */
  notRecomputed: boolean
}

export function keyLines(model: Model, state: State, keys: string[]): CopyLine[] {
  return keys
    .filter((k) => model.claims[k])
    .map((k) => {
      const c = state.claims[k]
      return {
        key: k, label: model.claims[k].label, value: c?.effective ?? null,
        notRecomputed: !!c && c.flags.includes('stale') && !state.adjusts.some((v) => !v.reverted && v.target === k && v.field === 'value'),
      }
    })
}

export const areaLabel = (a: AreaKey | null): string => (a ? AREA_LABEL[a] : 'Whole return')
