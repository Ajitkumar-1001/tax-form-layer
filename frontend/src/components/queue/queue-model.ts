// Pure half of the queue (spec §3.1): groups, rows, filters, the Next card and bulk act inputs.
// No React here, so vitest runs it in node against buildModel(packet) + project(...).
import { type DispositionT, type LevelT, buildInput, fixToRequest, initialDraft, levelsFor, normalizeRequest, probeDraft } from '@/components/acts/draft'
import { describeActs, undoTargets } from '@/components/workspace/log'
import type { OpenActRequest } from '@/components/workspace/types'
import type { Act, ActInput } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { CheckFamily, Finding, Severity } from '@/lib/model/checks/types'
import type { ClaimKind } from '@/lib/model/claims'
import { AREAS, AREA_LABEL, type AreaKey, parsePageRef } from '@/lib/model/ids'
import { indexActs } from '@/lib/model/project'
import type { SignoffView, State, Viewer } from '@/lib/model/state'
import { identities } from '@/lib/model/viewer'

export type GroupKey = 'blocks' | 'contradicted' | 'new' | 'weak' | 'swings' | 'decisions' | 'tied'

export interface GroupInfo {
  key: GroupKey
  n: number
  label: string
  /** One sentence for learn mode. */
  learn: string
}

export const GROUPS: GroupInfo[] = [
  { key: 'blocks', n: 1, label: 'Blocks filing', learn: 'The server refuses approval and filing while these are open: blocking review notes, adjustments over 1,000 without a partner sign-off, process failures and red required steps.' },
  { key: 'contradicted', n: 2, label: 'Contradicted', learn: 'The evidence disagrees with the number: the printed page, another document or an IRS / FTB record says something else.' },
  { key: 'new', n: 3, label: 'New since I last looked', learn: 'Acts by other people since you last pressed Mark seen, evidence that arrived after v3, and sign-offs that reopened.' },
  { key: 'weak', n: 4, label: 'Weakly supported or unaccounted', learn: 'The number rests on a client answer alone, a carryover that does not tie, or a document that landed nowhere.' },
  { key: 'swings', n: 5, label: 'Swings', learn: 'Lines that moved more than 10% and 1,000 from 2024 while none of their inputs did: explain the root once and the totals above it follow.' },
  { key: 'decisions', n: 6, label: 'Decisions due', learn: 'Engine alternatives, diagnostics, prior-preparer items, outside filings and process questions that need a recorded decision with its authority.' },
  { key: 'tied', n: 7, label: 'Tied by checks', learn: 'Every source read matches its printed page and no check found anything. A reviewer may accept them in bulk; their letters stay outlined, never filled.' },
]

export const SUPPORT_LEGEND = 'D source document · R recalculated · C client · P prior year · T third party. Filled: a person verified it. Outlined: a check earned it. Ringed: bulk-accepted.'

export type RowKind = 'finding' | 'note' | 'adjust' | 'step' | 'agency' | 'act' | 'claim' | 'signoff'

export interface Money2 {
  fed: number
  ca: number
}

export interface Row {
  /** Unique across the whole queue (a claim may appear in two groups). */
  key: string
  group: GroupKey
  kind: RowKind
  /** What the claim pane opens (?c=). */
  ref: string
  /** Claim whose state (status, value, support, flags) the row shows, when the ref is one. */
  claim?: string
  title: string
  /** Finding ids on this row, top one first. */
  findings: string[]
  severity: Severity | null
  stake: Money2
  area?: AreaKey
  at?: string
  /** Findings above this root (same family) that were collapsed into it. */
  downstream: number
}

export interface Group extends GroupInfo {
  rows: Row[]
}

export interface TiedRow {
  area: AreaKey
  label: string
  claims: string[]
}

export interface Queue {
  groups: Group[] // 1-6
  tied: TiedRow[] // 7, one per area
}

export interface Filters {
  area: AreaKey | null
  mine: boolean
  q: string
}

const ZERO: Money2 = { fed: 0, ca: 0 }
const SEV: Record<Severity, number> = { info: 1, warning: 2, high: 3 }
const sevRank = (s: Severity | null) => (s ? SEV[s] : 0)
const big = (m: Money2) => Math.max(Math.abs(m.fed), Math.abs(m.ca))
const absStake = (f: Finding): Money2 => ({ fed: Math.abs(f.stake?.fed ?? 0), ca: Math.abs(f.stake?.ca ?? 0) })

/** Money first, then severity, then a stable id so ties (B.N1 / B.N3) never wobble; numeric, so step:2 sorts before step:10. */
const byMoney = <T>(m: (x: T) => Money2, s: (x: T) => Severity | null, id: (x: T) => string) => (a: T, b: T) =>
  big(m(b)) - big(m(a)) || sevRank(s(b)) - sevRank(s(a)) || id(a).localeCompare(id(b), undefined, { numeric: true })
export const findingOrder = byMoney<Finding>(absStake, (f) => f.severity, (f) => f.id)
const rowOrder = byMoney<Row>((r) => r.stake, (r) => r.severity, (r) => r.key)

const CONTRADICTED = new Set<CheckFamily>([
  'printed_vs_extracted', 'sum_vs_detail', 'cross_document', 'duplicate_or_superseded', 'agency_tieout', 'state_sourcing', 'line_recompute',
])
const DECISION_KINDS = new Set<ClaimKind>(['whatif', 'diag', 'prior_item', 'step'])
const OUTSIDE_FILINGS = 'CHK-50'

/** First match wins: Blocks → Decisions → Contradicted → Swings → Weakly. "New since" is an overlay. */
export function groupOf(model: Model, f: Finding): Exclude<GroupKey, 'new' | 'tied'> {
  if (f.family === 'process_control') return f.severity === 'high' ? 'blocks' : 'decisions'
  const kind = model.claims[f.claims[0]]?.kind
  if ((kind && DECISION_KINDS.has(kind)) || f.check === OUTSIDE_FILINGS) return 'decisions'
  if (CONTRADICTED.has(f.family)) return 'contradicted'
  if (f.family === 'prior_year_swing') return 'swings'
  return 'weak'
}

export function openFindings(model: Model, state: State): Finding[] {
  return model.findings.filter((f) => state.findings[f.id]?.visible && state.findings[f.id].status === 'open')
}

/** Process and completeness findings are about the line itself (a missing entry, who did what), not a value
 * that flows up from its inputs, so they never collapse. */
const NEVER_COLLAPSE = new Set<CheckFamily>(['process_control', 'coverage_completeness'])

/**
 * Root causes only: a finding is collapsed when a claim anywhere in its claim's inputs tree carries an open
 * finding of the same family (a total is wrong because a lot is). Leaves never collapse. Cross-family
 * findings stay separate so an independent problem is never hidden under an unrelated one.
 */
export function collapseToRoots(model: Model, open: Finding[]): { hidden: Set<string>; downstream: Record<string, number> } {
  const memo = new Map<string, Set<string>>()
  const below = (id: string): Set<string> => {
    const hit = memo.get(id)
    if (hit) return hit
    const out = new Set<string>()
    memo.set(id, out) // set before recursing: a cycle sees a partial set instead of looping
    for (const i of model.claims[id]?.inputs ?? []) {
      out.add(i)
      for (const x of below(i)) out.add(x)
    }
    return out
  }
  const primaries = new Map<string, Set<string>>() // family → claims with an open finding of it
  for (const f of open) if (f.claims[0]) (primaries.get(f.family) ?? primaries.set(f.family, new Set()).get(f.family)!).add(f.claims[0])

  const hidden = new Set<string>()
  const rootsOf = new Map<string, string[]>()
  for (const f of open) {
    const c = f.claims[0]
    if (!c || NEVER_COLLAPSE.has(f.family)) continue
    const roots = [...below(c)].filter((d) => d !== c && primaries.get(f.family)!.has(d))
    if (roots.length) {
      hidden.add(f.id)
      rootsOf.set(f.id, roots)
    }
  }
  const visibleRoot = new Set(open.filter((f) => !hidden.has(f.id) && f.claims[0]).map((f) => `${f.family}|${f.claims[0]}`))
  const downstream: Record<string, number> = {}
  for (const [id, roots] of rootsOf) {
    const fam = open.find((f) => f.id === id)!.family
    for (const d of roots) if (visibleRoot.has(`${fam}|${d}`)) downstream[d] = (downstream[d] ?? 0) + 1
  }
  return { hidden, downstream }
}

/** The claim a ref stands for: the claim itself, a finding's primary claim, or a page's document. */
export function claimOf(model: Model, ref: string): string | undefined {
  if (model.claims[ref]) return ref
  if (ref.startsWith('chk:')) return model.findingsById[ref]?.claims[0]
  const pg = parsePageRef(ref)
  return pg && model.claims[pg.doc] ? pg.doc : undefined
}

/** The area a ref belongs to: `area:<key>` itself, or the area of the claim it stands for. */
export function areaOfRef(model: Model, ref: string): AreaKey | undefined {
  if (ref.startsWith('area:')) return (AREAS as readonly string[]).includes(ref.slice(5)) ? (ref.slice(5) as AreaKey) : undefined
  const c = claimOf(model, ref)
  return c ? model.claims[c].area : undefined
}

function findingRows(model: Model, list: Finding[], group: GroupKey, downstream: Record<string, number>): Row[] {
  const byClaim = new Map<string, Finding[]>()
  for (const f of list) {
    const k = f.claims[0] ?? f.id
    byClaim.set(k, [...(byClaim.get(k) ?? []), f])
  }
  return [...byClaim].map(([k, fs]): Row => {
    fs.sort(findingOrder)
    const claim = model.claims[k] ? k : undefined
    return {
      key: `${group}:${k}`, group, kind: 'finding', ref: k, claim, title: fs[0].title, findings: fs.map((f) => f.id),
      severity: fs.reduce<Severity>((s, f) => (SEV[f.severity] > SEV[s] ? f.severity : s), 'info'),
      stake: { fed: Math.max(...fs.map((f) => absStake(f).fed)), ca: Math.max(...fs.map((f) => absStake(f).ca)) },
      area: claim ? model.claims[claim].area : undefined, at: fs[0].knownSince, downstream: downstream[k] ?? 0,
    }
  })
}

const namesOf = (model: Model): Record<string, string> =>
  Object.fromEntries([...identities(model.packet).map((v) => [v.id, v.name]), ['system', 'System'], ['client', 'Client']])

/** The latest sign-off per target and level (older ones are superseded). */
export function latestSignoffs(signoffs: SignoffView[]): SignoffView[] {
  const m = new Map<string, SignoffView>()
  for (const s of signoffs) m.set(`${s.target}|${s.level}`, s)
  return [...m.values()]
}

const targetLabel = (t: string) => (t === 'return' ? 'the return' : (AREA_LABEL[t.slice(5) as AreaKey] ?? t))
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`

function blockRows(model: Model, state: State, findings: Finding[], downstream: Record<string, number>, name: (id: string) => string): Row[] {
  const rows = findingRows(model, findings, 'blocks', downstream)
  for (const n of state.notes) {
    if (!n.open || !n.blocking || n.kind !== 'review_note') continue
    const claim = claimOf(model, n.target)
    rows.push({
      key: `blocks:note:${n.seq}`, group: 'blocks', kind: 'note', ref: claim ?? `act:${n.seq}`, claim,
      title: `Blocking review note by ${name(n.actor)}: ${n.text}`, findings: [], severity: 'high',
      stake: claim ? state.claims[claim].stake : ZERO, area: areaOfRef(model, n.target), at: n.season_at, downstream: 0,
    })
  }
  for (const v of state.adjusts) {
    if (v.reverted || !v.needs_partner || v.partner_covered) continue
    const claim = claimOf(model, v.target)
    rows.push({
      key: `blocks:adjust:${v.seq}`, group: 'blocks', kind: 'adjust', ref: v.target, claim,
      title: `${name(v.actor)} adjusted ${v.target} (Fed ${signed(v.effect.fed)}, CA ${signed(v.effect.ca)}): over 1,000 needs a partner sign-off`,
      findings: [], severity: 'high', stake: { fed: Math.abs(v.effect.fed), ca: Math.abs(v.effect.ca) },
      area: areaOfRef(model, v.target), at: v.recorded_at, downstream: 0,
    })
  }
  for (const f of state.filings) {
    for (const r of f.results) {
      const later = state.filings.some((g) => g.seq > f.seq && g.results.some((x) => x.jurisdiction === r.jurisdiction && x.status === 'accepted'))
      if (r.status !== 'rejected' || later) continue
      rows.push({
        key: `blocks:agency:${r.seq}`, group: 'blocks', kind: 'agency', ref: `act:${r.seq}`,
        title: `${r.jurisdiction === 'federal' ? 'IRS' : 'FTB'} rejected the filing: ${r.errors.map((e) => `${e.code} ${e.message}`).join('; ') || 'no reason given'}`,
        findings: [], severity: 'high', stake: ZERO, area: 'payments_and_filing', downstream: 0,
      })
    }
  }
  for (const s of state.steps) {
    if (s.ok) continue
    const ref = `step:${s.n}`
    rows.push({
      key: `blocks:${ref}`, group: 'blocks', kind: 'step', ref, claim: model.claims[ref] ? ref : undefined,
      title: `Step ${s.n} · ${s.label}: ${s.reasons[0]?.text ?? 'not met'}`, findings: [], severity: 'warning', stake: ZERO,
      area: model.claims[ref]?.area, downstream: 0,
    })
  }
  return rows
}

function newRows(model: Model, state: State, open: Finding[], downstream: Record<string, number>, lastSeenSeq: number, name: (id: string) => string): Row[] {
  const v3At = model.packet.return_versions[model.packet.return_versions.length - 1].computed_at
  const rows: Row[] = []

  // Other people's acts since I last looked, one row per batch.
  const batches = new Map<string, Act[]>()
  for (const a of state.acts) {
    if (a.seq <= lastSeenSeq || a.actor === state.viewer.id || a.type === 'view_sensitive') continue
    const k = a.batch_id ?? `act:${a.seq}`
    batches.set(k, [...(batches.get(k) ?? []), a])
  }
  for (const acts of batches.values()) {
    const a = acts[0]
    const claim = claimOf(model, a.target)
    const effect = a.type === 'adjust' ? (a.derived as { effect?: Money2 }).effect : undefined
    const what = a.actor === 'system' ? `${a.type.replaceAll('_', ' ')} ${a.target}` : describeActs(acts)
    rows.push({
      key: `new:act:${a.seq}`, group: 'new', kind: 'act', ref: acts.length === 1 && claim ? claim : `act:${a.seq}`,
      claim: acts.length === 1 ? claim : undefined, title: `${name(a.actor)}: ${what}`, findings: [], severity: null,
      stake: effect ? { fed: Math.abs(effect.fed), ca: Math.abs(effect.ca) } : ZERO, area: areaOfRef(model, a.target), at: a.season_at, downstream: 0,
    })
  }

  // Findings and evidence that entered the file after v3 (and before the season clock).
  const arrived = open.filter((f) => f.knownSince > v3At && f.knownSince <= state.clock)
  const fresh = findingRows(model, arrived, 'new', downstream)
  rows.push(...fresh)
  const has = new Set(fresh.map((r) => r.claim))
  for (const c of model.claimList) {
    if ((c.kind !== 'doc' && c.kind !== 'comm') || c.knownAt <= v3At || c.knownAt > state.clock || has.has(c.id)) continue
    if (state.claims[c.id]?.status !== 'open') continue
    rows.push({
      key: `new:${c.id}`, group: 'new', kind: 'claim', ref: c.id, claim: c.id, title: `Arrived ${c.knownAt.slice(0, 10)}, after v3: no return version reflects it`,
      findings: [], severity: 'warning', stake: ZERO, area: c.area, at: c.knownAt, downstream: 0,
    })
  }

  for (const s of latestSignoffs(state.signoffs)) {
    if (s.valid) continue
    rows.push({
      key: `new:signoff:${s.seq}`, group: 'new', kind: 'signoff', ref: s.target.startsWith('area:') ? s.target : `act:${s.seq}`,
      title: `${name(s.actor)}'s ${s.level} sign-off on ${targetLabel(s.target)} reopened: ${s.changed.length} changed`,
      findings: [], severity: 'warning', stake: ZERO, area: areaOfRef(model, s.target), at: s.recorded_at, downstream: 0,
    })
  }
  return rows
}

/** Decision claims (what-ifs, diagnostics, prior-preparer items) still open with no finding row of their own. */
function decisionClaimRows(model: Model, state: State, taken: Set<string | undefined>): Row[] {
  return model.claimList
    .filter((c) => (c.kind === 'whatif' || c.kind === 'diag' || c.kind === 'prior_item') && !taken.has(c.id))
    .filter((c) => c.knownAt <= state.clock && state.claims[c.id]?.status === 'open')
    .map((c): Row => ({
      key: `decisions:${c.id}`, group: 'decisions', kind: 'claim', ref: c.id, claim: c.id, title: `Needs a recorded decision: ${c.label}`,
      findings: [], severity: 'warning', stake: ZERO, area: c.area, downstream: 0,
    }))
}

/** Areas a viewer works: the preparer's assigned areas; reviewer and partner review every area of the engagement. */
export function myAreas(state: State, viewer: Viewer): Set<AreaKey> {
  if (viewer.role === 'reviewer' || viewer.role === 'partner') return new Set(AREAS)
  return new Set(AREAS.filter((k) => state.assignments[k] === viewer.id))
}

export function matchesFilters(model: Model, state: State, row: Pick<Row, 'area' | 'claim' | 'ref' | 'title'>, f: Filters): boolean {
  if (f.area && row.area !== f.area) return false
  if (f.mine && row.area && !myAreas(state, state.viewer).has(row.area)) return false
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const hay = `${row.ref} ${row.claim ?? ''} ${row.claim ? model.claims[row.claim]?.label : ''} ${row.title}`.toLowerCase()
  return terms.every((t) => hay.includes(t))
}

/** URL params → filters. `mine` defaults on for preparers (spec: "Assigned to me" is their default). */
export function parseFilters(params: { get(k: string): string | null }, viewer: Viewer): Filters {
  const area = params.get('area')
  const mine = params.get('mine')
  return {
    area: area && (AREAS as readonly string[]).includes(area) ? (area as AreaKey) : null,
    mine: mine === null ? viewer.role === 'preparer' : mine === '1',
    q: params.get('q') ?? '',
  }
}

export function buildQueue(model: Model, state: State, lastSeenSeq: number, filters: Filters): Queue {
  const names = namesOf(model)
  const name = (id: string) => names[id] ?? id
  const open = openFindings(model, state)
  const { hidden, downstream } = collapseToRoots(model, open)
  const roots = open.filter((f) => !hidden.has(f.id))
  const by = (g: GroupKey) => roots.filter((f) => groupOf(model, f) === g)

  const decisions = findingRows(model, by('decisions'), 'decisions', downstream)
  const raw: Record<Exclude<GroupKey, 'tied'>, Row[]> = {
    blocks: blockRows(model, state, by('blocks'), downstream, name),
    contradicted: findingRows(model, by('contradicted'), 'contradicted', downstream),
    new: newRows(model, state, roots, downstream, lastSeenSeq, name),
    weak: findingRows(model, by('weak'), 'weak', downstream),
    swings: findingRows(model, by('swings'), 'swings', downstream),
    decisions: [...decisions, ...decisionClaimRows(model, state, new Set(decisions.map((r) => r.claim)))],
  }
  const groups = GROUPS.filter((g) => g.key !== 'tied').map((g): Group => ({
    ...g,
    rows: raw[g.key as Exclude<GroupKey, 'tied'>].filter((r) => matchesFilters(model, state, r, filters)).sort(rowOrder),
  }))

  const tied = AREAS.map((area): TiedRow => ({
    area, label: AREA_LABEL[area],
    claims: model.claimList
      .filter((c) => c.area === area && state.claims[c.id]?.status === 'read_ok' && !state.claims[c.id].flags.includes('not_yet_in_file'))
      .map((c) => c.id),
  })).filter((t) => t.claims.length && matchesFilters(model, state, { area: t.area, ref: '', title: '' }, { ...filters, q: '' }))

  return { groups, tied }
}

// ── Next card ─────────────────────────────────────────────────────────────────────────────

export interface NextAction {
  kind: 'note' | 'question' | 'signoff' | 'finding' | 'evidence' | 'swing' | 'step'
  what: string
  why: string
  doneWhen: string
  /** Opened in the claim pane by Go. */
  ref: string
  /** The act form Go opens (pre-filled), if any. */
  request?: OpenActRequest
  finding?: string
}

function doneWhen(f: Finding): string {
  const t = f.fix?.target ?? f.claims[0] ?? f.id
  switch (f.fix?.act) {
    case 'adjust':
      return `${f.fix.label}: the adjustment is recorded with its evidence and reason, and this finding clears.`
    case 'decide':
      return `A decision on ${t} is recorded with the authority relied on.`
    case 'dispose':
      return `${t} is disposed with a reason (${f.fix.disposition?.replaceAll('_', ' ') ?? 'disposition'}).`
    case 'verify':
      return `${t} is verified against its evidence.`
    case 'note':
      return 'A note records the follow-up and who owns it.'
    default:
      return 'The finding is resolved with a reason, or cleared by an act that addresses it.'
  }
}

const moneyThenSeverity = (fs: Finding[]) => [...fs].sort(findingOrder)[0]

/** The act Go opens, judged as ActButton judges it: on the probed draft, so a field the form still collects never refuses. */
export function goInput(model: Model, state: State, request: OpenActRequest): ActInput {
  const req = normalizeRequest(request)
  return buildInput(req, probeDraft(req, initialDraft(req, model, state), state), state)
}

/** The single most valuable next action for this viewer (spec §3.1 Next card). */
export function nextAction(model: Model, state: State, viewer: Viewer): NextAction | null {
  const names = namesOf(model)
  const name = (id: string) => names[id] ?? id
  const mine = myAreas(state, viewer)
  const v3At = model.packet.return_versions[model.packet.return_versions.length - 1].computed_at

  // 1. Blocking review notes on my work, then questions addressed to me.
  const myWork = (target: string) => {
    const c = claimOf(model, target)
    const area = areaOfRef(model, target)
    return (!!c && state.claims[c]?.preparedBy.includes(viewer.id)) || (!!area && mine.has(area) && viewer.role === 'preparer')
  }
  const notes = state.notes
    .filter((n) => n.open && ((n.blocking && n.kind === 'review_note' && n.actor !== viewer.id && myWork(n.target)) || (n.kind.startsWith('question') && n.to === viewer.id)))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.seq - b.seq)
  if (notes[0]) {
    const n = notes[0]
    return {
      kind: n.blocking ? 'note' : 'question',
      what: n.blocking ? `Answer ${name(n.actor)}'s blocking review note on ${n.target}` : `Answer ${name(n.actor)}'s question on ${n.target}`,
      why: n.text,
      doneWhen: n.blocking
        ? `${name(n.actor)} (or a higher level) resolves the note. Until then it blocks client approval and filing.`
        : 'You reply, and the person who asked resolves the question.',
      ref: claimOf(model, n.target) ?? `act:${n.seq}`,
      request: { type: 'reply', target: `act:${n.seq}` },
    }
  }

  // 2. My sign-offs that reopened.
  const reopened = latestSignoffs(state.signoffs).find((s) => s.actor === viewer.id && !s.valid)
  if (reopened) {
    return {
      kind: 'signoff',
      what: `Re-sign ${targetLabel(reopened.target)}: your ${reopened.level} sign-off reopened`,
      why: `${reopened.changed.length} claims changed after you signed${reopened.changed.length ? `: ${reopened.changed.slice(0, 3).join(', ')}` : ''}.`,
      doneWhen: 'You review what changed and sign again; the new sign-off fingerprints the current values and evidence.',
      ref: reopened.changed[0] ?? `act:${reopened.seq}`,
      request: { type: 'signoff', target: reopened.target, prefill: { level: reopened.level } },
    }
  }

  const open = openFindings(model, state)
  const { hidden } = collapseToRoots(model, open)
  const inMine = open.filter((f) => !hidden.has(f.id) && !!f.claims[0] && mine.has(model.claims[f.claims[0]].area))
  const fromFinding = (f: Finding, kind: NextAction['kind']): NextAction => ({
    kind, what: f.title, why: f.why, doneWhen: doneWhen(f), ref: f.claims[0] ?? f.id, request: fixToRequest(f), finding: f.id,
  })

  // 3. The largest-money finding in my areas. Process items are partner work and swings come later.
  const money = inMine.filter((f) => f.family !== 'process_control' && f.family !== 'prior_year_swing' && f.severity !== 'info' && big(absStake(f)) > 0)
  if (money.length) return fromFinding(moneyThenSeverity(money), 'finding')

  // 4. Evidence that arrived after v3 and is in the file now.
  const arrived = model.claimList
    .filter((c) => (c.kind === 'doc' || c.kind === 'comm') && c.knownAt > v3At && c.knownAt <= state.clock && state.claims[c.id]?.status === 'open')
    .sort((a, b) => a.knownAt.localeCompare(b.knownAt) || a.id.localeCompare(b.id))[0]
  if (arrived) {
    const f = moneyThenSeverity(open.filter((x) => x.claims[0] === arrived.id))
    return {
      kind: 'evidence',
      what: `${arrived.label} (${arrived.id}) arrived ${arrived.knownAt.slice(0, 10)}, after v3`,
      why: f?.why ?? 'No return version reflects it. Decide whether it changes a number, then cite it or dispose it.',
      doneWhen: 'It is cited by an adjustment or verification, or disposed with a reason.',
      ref: arrived.id,
      request: f ? fixToRequest(f) : { type: 'dispose', target: arrived.id },
      finding: f?.id,
    }
  }

  // 5. Unexplained swings.
  const swings = inMine.filter((f) => f.family === 'prior_year_swing')
  if (swings.length) return fromFinding(moneyThenSeverity(swings), 'swing')

  // 6. The first red required step.
  const step = state.steps.find((s) => !s.ok)
  if (step) {
    return {
      kind: 'step',
      what: `Step ${step.n}: ${step.label}`,
      why: step.reasons[0]?.text ?? 'Not met yet.',
      doneWhen: 'Every item listed under the step is cleared. Steps are derived from the work, never ticked by hand.',
      ref: step.reasons[0]?.ref && claimOf(model, step.reasons[0].ref) ? step.reasons[0].ref : `step:${step.n}`,
    }
  }
  return null
}

// ── Bulk and undo ─────────────────────────────────────────────────────────────────────────

/** The level a reviewer or partner accepts at; null for roles that may not accept. */
export function acceptLevel(viewer: Viewer): LevelT | null {
  const l = levelsFor(viewer.role)[0]
  return l === 'reviewer' || l === 'partner' ? l : null
}

/** verify{accepted_check_tied} for each claim, seen value = its effective value, evidence = its sources in the file. */
export function acceptInputs(model: Model, state: State, claims: string[], level: LevelT): ActInput[] {
  return claims
    .filter((id) => state.claims[id] && model.claims[id])
    .map((id): ActInput => ({
      type: 'verify', target: id,
      body: {
        method: 'accepted_check_tied', level, seen_value: state.claims[id].effective,
        evidence: model.claims[id].sources.filter((s) => model.knownAt(s) <= state.clock).slice(0, 200),
      },
    }))
}

/** One dispose per row: the top finding (addressing all of the row's findings), or the claim itself. */
export function disposeInputs(model: Model, rows: Row[], disposition: DispositionT, reason: string): { inputs: ActInput[]; skipped: Row[] } {
  const inputs: ActInput[] = []
  const skipped: Row[] = []
  for (const r of rows) {
    if (r.findings.length) inputs.push({ type: 'dispose', target: r.findings[0], body: { disposition, reason, findings: r.findings } })
    else if (r.kind === 'claim' && r.claim) inputs.push({ type: 'dispose', target: r.claim, body: { disposition, reason } })
    else skipped.push(r)
  }
  return { inputs, skipped }
}

/** Revert target for this viewer's last live batch (u = undo), or null when there is nothing to undo. */
export function lastUndoTarget(acts: Act[], viewerId: string): string | null {
  const { dead } = indexActs(acts)
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i]
    if (a.actor !== viewerId || dead.has(a.seq)) continue
    const t = undoTargets([a])[0]
    if (t) return t
  }
  return null
}

/** Chunks of at most `n` (POST /api/acts takes 300 acts per batch). */
export const chunk = <T>(xs: T[], n = 300): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
