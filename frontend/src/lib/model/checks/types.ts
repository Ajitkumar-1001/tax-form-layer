// Engine-free checks. A check reads the packet (masked: sensitive values are equality tokens) and the
// derived claims, never trusts return_versions values except to COMPARE them with an independently
// derived number, and returns findings attached to claims. Checks never mention canonical error ids.
import type { AdjustField } from '../effects'
import type { Claim, Val } from '../claims'
import type { ExtractedValue, Packet, PacketDocument, ReturnLine } from '../packet-types'

export type CheckFamily =
  | 'printed_vs_extracted'
  | 'sum_vs_detail'
  | 'cross_document'
  | 'duplicate_or_superseded'
  | 'agency_tieout'
  | 'client_answer_vs_document'
  | 'prior_year_swing'
  | 'carryover_tieout'
  | 'line_recompute'
  | 'state_sourcing'
  | 'coverage_completeness'
  | 'process_control'

export type Severity = 'info' | 'warning' | 'high'
export type Signal = 'computed' | 'heuristic' | 'prompt'

/** The act a person would most likely record to clear this finding. The UI pre-fills a form from it. */
export interface SuggestedFix {
  act: 'adjust' | 'dispose' | 'decide' | 'note' | 'verify'
  target: string
  field?: AdjustField
  to?: Val
  disposition?: string
  /** The other item a dispose points at (duplicate_of D09, contradicted_by ev-1055, superseded_by D31). */
  ref?: string
  label: string // button text, e.g. "Set basis to D11 adjusted basis 19,100"
}

export interface Finding {
  /** Deterministic: `chk:<CHK-id>:<subject>` so acts can cite and resolve it across reloads. */
  id: string
  check: string // 'CHK-01'
  family: CheckFamily
  title: string // one plain sentence: what is wrong
  why: string // why it matters / what the check compared
  severity: Severity
  signal: Signal
  /** Claim ids (must exist in model.claims) this finding attaches to. First one is the primary. */
  claims: string[]
  /** Refs to show side by side as evidence (ev-, D##, doc:D23#page3, agency:/..., qa-, py:/...). */
  evidence: string[]
  expected?: Val
  actual?: Val
  /** Money at stake if the expected value is right, from tax_effect_rates (or what_if). */
  stake?: { fed: number; ca: number }
  /** Latest knownAt among its evidence: hidden while the season clock is earlier. */
  knownSince: string
  fix?: SuggestedFix
}

export interface CheckContext {
  packet: Packet
  claims: Record<string, Claim>
  /** v3 lines by key. */
  lines: Record<string, ReturnLine>
  /** Lines by key for each version: { v1, v2, v3 }. */
  linesByVersion: Record<string, Record<string, ReturnLine>>
  ev: Record<string, ExtractedValue>
  evByDoc: Record<string, ExtractedValue[]>
  docs: Record<string, PacketDocument>
  /** ref → v3 line keys whose sources include it. */
  citedBy: Record<string, string[]>
  /** doc id → v3 line keys that cite the doc or any of its extracted values. */
  landedIn: Record<string, string[]>
  knownAt(ref: string): string
}

export interface Check {
  id: string // 'CHK-01'
  name: string
  family: CheckFamily
  run(ctx: CheckContext): Finding[]
}

/** Helper: the latest knownAt of a set of refs. */
export function latestKnown(ctx: CheckContext, refs: string[]): string {
  return refs.map((r) => ctx.knownAt(r)).reduce((a, b) => (a > b ? a : b), '2026-01-12T17:06:00Z')
}
