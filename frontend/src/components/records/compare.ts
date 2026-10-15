// Compare (spec §3.5): claim-level diff between two states of the return, attributed to an engine version or a person.
import type { Act } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { Val } from '@/lib/model/claims'
import type { Finding } from '@/lib/model/checks/types'
import { refKind, SEASON_START } from '@/lib/model/ids'
import { project } from '@/lib/model/project'
import type { State } from '@/lib/model/state'

/** Sides: v1 | v2 | v3 | 2024 | now (v3 with live adjusts) | whatif:<id>. */
export function sideOptions(model: Model): { value: string; label: string }[] {
  return [
    { value: '2024', label: '2024 return' },
    ...model.packet.return_versions.map((v) => ({ value: v.version, label: `${v.version} (${v.computed_at.slice(0, 10)})` })),
    { value: 'now', label: 'now (v3 + our adjustments)' },
    ...model.packet.what_if.alternatives.map((a) => ({ value: `whatif:${a.id}`, label: `what-if: ${a.id.replaceAll('_', ' ')}` })),
  ]
}

const whatIf = (model: Model, side: string) => (side.startsWith('whatif:') ? model.packet.what_if.alternatives.find((a) => a.id === side.slice(7)) : undefined)

/** Line values on a side, or null for an unknown side. */
export function sideValues(model: Model, state: State, side: string): Record<string, Val> | null {
  if (side === '2024') return { ...model.packet.prior_years.return_2024.lines }
  if (side === 'now') return Object.fromEntries(model.claimList.filter((c) => c.kind === 'line').map((c) => [c.id, state.claims[c.id]?.effective ?? c.value ?? null]))
  const v = model.linesByVersion[side]
  if (v) return Object.fromEntries(Object.values(v).map((l) => [l.key, l.value]))
  const alt = whatIf(model, side)
  if (!alt) return null
  const base = model.linesByVersion[alt.base_version] ?? {}
  return { ...Object.fromEntries(Object.values(base).map((l) => [l.key, l.value])), ...Object.fromEntries(alt.changed_lines.map((c) => [c.key, c.new])) }
}

export interface Attribution {
  text: string
  ref?: string
  /** Free text from an act (e.g. an adjust's reason): rendered outside the link, through MaskedText. */
  detail?: string
}

export interface DiffRow {
  key: string
  /** Set when /r/<key> resolves; a form-level 2024 key such as F8938 has no trace. */
  ref?: string
  label: string
  a: Val
  b: Val
  delta: number | null
  by: Attribution[]
}

/** Ordinal of a side on the timeline (2024 → v1 → v2 → v3 → what-if/now). */
function ordinal(model: Model, side: string): number {
  if (side === '2024') return 0
  const i = model.packet.return_versions.findIndex((v) => v.version === side)
  return i >= 0 ? i + 1 : model.packet.return_versions.length + 1
}

export function attribution(model: Model, state: State, a: string, b: string, key: string, nameOf: (id: string) => string): Attribution[] {
  const [lo, hi] = [ordinal(model, a), ordinal(model, b)].sort((x, y) => x - y)
  const out: Attribution[] = []
  if (lo === 0) out.push({ text: '2024 return (prior year)' })
  model.packet.return_versions.forEach((v, i) => {
    if (i + 1 > lo && i + 1 <= hi && i > 0 && v.changes_from_previous.some((c) => c.key === key)) out.push({ text: `engine ${v.version} (system)`, ref: v.version })
  })
  for (const side of [a, b]) {
    const alt = whatIf(model, side)
    if (alt?.changed_lines.some((c) => c.key === key)) out.push({ text: `what-if ${alt.id} (engine alternative)`, ref: side })
  }
  if (a === 'now' || b === 'now') {
    const adj = state.claims[key]?.adjust
    if (adj && !adj.reverted) out.push({ text: `adjust #${adj.seq} by ${nameOf(adj.actor)}`, ref: `act:${adj.seq}`, detail: adj.reason })
  }
  return out
}

const same = (x: Val | undefined, y: Val | undefined) => (x ?? null) === (y ?? null)

export function diffSides(model: Model, state: State, a: string, b: string, nameOf: (id: string) => string): DiffRow[] | null {
  const va = sideValues(model, state, a)
  const vb = sideValues(model, state, b)
  if (!va || !vb) return null
  const keys = [...new Set([...Object.keys(va), ...Object.keys(vb)])]
  const labels = model.packet.prior_years.return_2024.line_labels
  return keys
    .filter((k) => !same(va[k], vb[k]))
    .map((key): DiffRow => {
      const x = va[key] ?? null
      const y = vb[key] ?? null
      const delta = typeof x === 'number' && typeof y === 'number' ? Math.round((y - x) * 100) / 100 : typeof y === 'number' && x === null ? y : typeof x === 'number' && y === null ? -x : null
      const ref = model.claims[key] || refKind(key) !== 'unknown' ? key : undefined
      return { key, ref, label: model.claims[key]?.label ?? labels[key] ?? key, a: x, b: y, delta, by: attribution(model, state, a, b, key, nameOf) }
    })
    .sort((p, q) => Math.abs(q.delta ?? 0) - Math.abs(p.delta ?? 0) || p.key.localeCompare(q.key))
}

// ── Since I last looked ────────────────────────────────────────────────────────────────────

export interface SinceMe {
  since: number
  acts: Act[] // by others, after lastSeenSeq
  adjusts: number
  net: { fed: number; ca: number }
  findings: Finding[] // newly visible since the clock moved past their evidence
  reopened: number
  summary: string
}

/** The season clock as it stood at `seq` (the last clock act at or before it). */
export function clockAt(acts: Act[], seq: number): string {
  const last = acts.filter((a) => a.type === 'clock' && a.seq <= seq).at(-1)
  const to = last && (last.body as { to?: unknown }).to
  return typeof to === 'string' ? to : SEASON_START
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`

export function sinceMe(model: Model, state: State, viewerId: string, lastSeenSeq: number): SinceMe {
  const acts = state.acts.filter((a) => a.seq > lastSeenSeq && a.actor !== viewerId)
  const adjusts = state.adjusts.filter((v) => v.seq > lastSeenSeq && v.actor !== viewerId && !v.reverted)
  const net = { fed: adjusts.reduce((s, v) => s + v.effect.fed, 0), ca: adjusts.reduce((s, v) => s + v.effect.ca, 0) }
  const then = clockAt(state.acts, lastSeenSeq)
  const findings = model.findings.filter((f) => state.findings[f.id]?.visible && f.knownSince > then)
  // Reopened since then: invalid now, and not already invalid as the log stood at lastSeenSeq.
  const before = project(model, state.acts.filter((a) => a.seq <= lastSeenSeq), state.viewer, state.engagement)
  const wasOpen = new Set(before.signoffs.filter((s) => !s.valid).map((s) => s.seq))
  const reopened = state.signoffs.filter((s) => !s.valid && s.changed.length > 0 && !wasOpen.has(s.seq)).length
  const parts = [
    `${acts.length} act${acts.length === 1 ? '' : 's'} by others`,
    ...(adjusts.length ? [`${adjusts.length} number${adjusts.length === 1 ? '' : 's'} changed (net fed ${signed(net.fed)}, CA ${signed(net.ca)})`] : []),
    `${findings.length} finding${findings.length === 1 ? '' : 's'} newly visible`,
    ...(reopened ? [`${reopened} sign-off${reopened === 1 ? '' : 's'} reopened`] : []),
  ]
  return { since: lastSeenSeq, acts, adjusts: adjusts.length, net, findings, reopened, summary: `Since you last looked (act #${lastSeenSeq}): ${parts.join(', ')}.` }
}
