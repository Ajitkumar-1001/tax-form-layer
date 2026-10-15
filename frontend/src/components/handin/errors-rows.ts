// Pure join behind /errors: each canonical error, the catalog checks that catch it, and the live
// status of their findings in the current projection. No React, so vitest runs it in node.
import { type CanonError, CHECK_NAMES, type ErrorCategory } from '@/lib/errors-map'
import type { Model } from '@/lib/model/build'
import type { Severity, Signal } from '@/lib/model/checks/types'
import type { State } from '@/lib/model/state'

export type ErrorStatus = 'open' | 'resolved' | 'not_yet' | 'not_raised' | 'prompt'

export const STATUS_LABEL: Record<ErrorStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  not_yet: 'Not yet in file',
  not_raised: 'Check runs, nothing raised',
  prompt: 'Prompt / reviewer judgment',
}

export const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  agency_mismatch: 'Agency mismatch',
  client_data_mistake: 'Client data mistake',
  confident_pipeline_mistake: 'Confident pipeline mistake',
  document_issue: 'Document issue',
  engine_mistake: 'Engine mistake',
  judgment_call: 'Judgment call',
  missing_return_item: 'Missing return item',
  outside_filing: 'Outside filing',
  process_control: 'Process control',
}

export interface CheckRef {
  id: string
  name: string
  implemented: boolean
}

export interface LiveFinding {
  id: string
  check: string
  title: string
  signal: Signal
  severity: Severity
  visible: boolean
  status: 'open' | 'resolved'
  knownSince: string
  resolvedBy?: { seq: number; actor: string; how: string }
  primary?: string
}

export interface ErrorRow {
  error: CanonError
  checks: CheckRef[]
  findings: LiveFinding[]
  status: ErrorStatus
  /** Claim to open (see primaryOf). */
  primary?: string
}

/** Check ids that exist in code (the registry the model ran). */
export function implementedChecks(model: Model, registry: { id: string }[]): Set<string> {
  return new Set([...registry.map((c) => c.id), ...model.findings.map((f) => f.check)])
}

/** A finding speaks to an error when its check catches the error and it touches one of the error's refs or lines. */
function matches(model: Model, error: CanonError, findingId: string): boolean {
  const f = model.findingsById[findingId]
  if (!f || !error.checks.includes(f.check)) return false
  const scope = new Set([...error.refs, ...error.lines])
  return [...f.claims, ...f.evidence].some((r) => scope.has(r))
}

function statusOf(implemented: boolean, findings: LiveFinding[]): ErrorStatus {
  if (!findings.length) return implemented ? 'not_raised' : 'prompt'
  const visible = findings.filter((f) => f.visible)
  if (!visible.length) return 'not_yet'
  return visible.some((f) => f.status === 'open') ? 'open' : 'resolved'
}

/** Prefer a finding's primary claim that is one of the error's affected lines, then any affected line, then any finding's. */
function primaryOf(model: Model, error: CanonError, findings: LiveFinding[]): string | undefined {
  const onLine = findings.find((f) => f.primary && error.lines.includes(f.primary))?.primary
  return onLine ?? error.lines.find((r) => model.claims[r]) ?? findings.find((f) => f.primary)?.primary ?? error.refs.find((r) => model.claims[r])
}

export function errorRows(model: Model, state: State, errors: CanonError[], implemented: Set<string>): ErrorRow[] {
  return errors.map((error) => {
    const checks = error.checks.map((id) => ({ id, name: CHECK_NAMES[id] ?? id, implemented: implemented.has(id) }))
    const findings: LiveFinding[] = model.findings
      .filter((f) => matches(model, error, f.id))
      .map((f) => {
        const live = state.findings[f.id]
        return {
          id: f.id, check: f.check, title: f.title, signal: f.signal, severity: f.severity,
          visible: live?.visible ?? false, status: live?.status ?? 'open', knownSince: f.knownSince,
          ...(live?.resolvedBy && { resolvedBy: live.resolvedBy }), ...(f.claims[0] && { primary: f.claims[0] }),
        }
      })
    const primary = primaryOf(model, error, findings)
    return { error, checks, findings, status: statusOf(checks.some((c) => c.implemented), findings), ...(primary && { primary }) }
  })
}

export interface CheckSummary {
  check: string
  signal: Signal
  open: string[] // visible, open finding ids
  resolved: { id: string; seq: number; actor: string; how: string }[]
  hidden: string[] // not yet in file (knownSince after the clock)
}

/** A row's findings grouped by the check that raised them. */
export function byCheck(findings: LiveFinding[]): CheckSummary[] {
  const out = new Map<string, CheckSummary>()
  for (const f of findings) {
    const s = out.get(f.check) ?? { check: f.check, signal: f.signal, open: [], resolved: [], hidden: [] }
    if (!f.visible) s.hidden.push(f.id)
    else if (f.status === 'resolved' && f.resolvedBy) s.resolved.push({ id: f.id, ...f.resolvedBy })
    else s.open.push(f.id)
    out.set(f.check, s)
  }
  return [...out.values()]
}

export interface ErrorFilter {
  category: ErrorCategory | 'all'
  status: ErrorStatus | 'all'
}

export function filterRows(rows: ErrorRow[], filter: ErrorFilter): ErrorRow[] {
  return rows.filter((r) => (filter.category === 'all' || r.error.category === filter.category) && (filter.status === 'all' || r.status === filter.status))
}

export function countBy<K extends string>(rows: ErrorRow[], key: (r: ErrorRow) => K): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {}
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1
  return out
}
