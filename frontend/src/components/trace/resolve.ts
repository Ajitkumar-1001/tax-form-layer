// Pure lookups behind the trace pane: what a ref is, and everything the pane lists about it.
// No React here, so all of it is tested against the real packet.
import type { Act } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { Finding } from '@/lib/model/checks/types'
import type { Claim, Val } from '@/lib/model/claims'
import { AREAS, type AreaKey, jsonPointer, parsePageRef, refKind } from '@/lib/model/ids'
import { splitMasked } from '@/lib/model/mask-token'
import type { ExtractedValue, PacketDocument } from '@/lib/model/packet-types'
import { indexActs } from '@/lib/model/project'
import type { SignoffView, State } from '@/lib/model/state'

export type Resolved =
  | { kind: 'claim'; ref: string; claim: Claim }
  | { kind: 'ev'; ref: string; ev: ExtractedValue }
  | { kind: 'page'; ref: string; doc: PacketDocument; page: number }
  | { kind: 'finding'; ref: string; finding: Finding }
  | { kind: 'act'; ref: string; seq: number }
  | { kind: 'batch'; ref: string; id: string }
  | { kind: 'area'; ref: string; area: AreaKey }
  /** A line key that is not a v3 line, e.g. a required entry (F1040.digital_assets) or a line removed after v1. */
  | { kind: 'entry'; ref: string; findings: Finding[]; earlier: { version: string; label: string; value: Val }[] }
  /** Any other packet location: py:/, agency:/, ref:, asset:, timeline:, v1..v3, household:<person>, identities. */
  | { kind: 'data'; ref: string; title: string; value: unknown }
  | { kind: 'unknown'; ref: string }

/** The route param: catch-all segments, each URI-encoded; a hand-typed /r/py:/a/b arrives as several. */
export function decodeRefParam(segments: string[] | string | undefined): string {
  const parts = segments === undefined ? [] : typeof segments === 'string' ? [segments] : segments
  return parts
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    .join('/')
}

const pick = <T,>(v: T | undefined, title: string, ref: string): Resolved => (v === undefined ? { kind: 'unknown', ref } : { kind: 'data', ref, title, value: v })

export function resolveRef(model: Model, ref: string): Resolved {
  const p = model.packet
  const claim = model.claims[ref]
  if (claim) return { kind: 'claim', ref, claim }
  const kind = refKind(ref)
  switch (kind) {
    case 'ev': {
      const ev = model.ev[ref]
      return ev ? { kind: 'ev', ref, ev } : { kind: 'unknown', ref }
    }
    case 'page': {
      const pg = parsePageRef(ref)
      const doc = pg && model.docs[pg.doc]
      return doc && pg ? { kind: 'page', ref, doc, page: pg.page } : { kind: 'unknown', ref }
    }
    case 'chk': {
      const finding = model.findingsById[ref]
      return finding ? { kind: 'finding', ref, finding } : { kind: 'unknown', ref }
    }
    case 'act': {
      const seq = Number(ref.slice(4))
      return Number.isInteger(seq) && seq > 0 ? { kind: 'act', ref, seq } : { kind: 'unknown', ref }
    }
    case 'batch':
      return { kind: 'batch', ref, id: ref.slice('batch:'.length) }
    case 'area': {
      const area = ref.slice('area:'.length) as AreaKey
      return AREAS.includes(area) ? { kind: 'area', ref, area } : { kind: 'unknown', ref }
    }
    case 'py':
      return pick(jsonPointer(p.prior_years, ref.slice(3)), 'Prior-year record', ref)
    case 'agency':
      return pick(jsonPointer(p.tax_agency_records, ref.slice(7)), 'Tax agency record', ref)
    case 'param': {
      const name = ref.slice('ref:'.length)
      if (name.startsWith('param.')) return pick(p.engine_reference.parameters[name.slice(6)], 'Engine parameter', ref)
      if (name.startsWith('fx.')) {
        const [, cur, rate] = name.split('.')
        const table = p.fx_rates[`${cur}_per_USD`] as Record<string, unknown> | undefined
        return pick(table?.[rate], `Exchange rate (${cur} per USD)`, ref)
      }
      return { kind: 'unknown', ref }
    }
    case 'asset': {
      const id = ref.slice('asset:'.length)
      const v3 = p.return_versions[p.return_versions.length - 1]
      return pick(v3.assets.find((a) => a.asset_id === id) ?? p.prior_years.asset_records.find((a) => a.asset_id === id), 'Depreciable asset', ref)
    }
    case 'timeline':
      return pick(p.timeline.find((t) => t.id === ref.slice('timeline:'.length)), 'Timeline event', ref)
    case 'version': {
      const v = p.return_versions.find((x) => x.version === ref)
      if (!v) return { kind: 'unknown', ref }
      const { lines, assets, ...rest } = v
      return { kind: 'data', ref, title: `Return version ${v.version}`, value: { ...rest, lines: lines.length, assets: assets.length } }
    }
    case 'household': {
      if (ref === 'household') {
        const { people, ...rest } = p.household
        return { kind: 'data', ref, title: 'Household', value: { ...rest, people: people.map((x) => x.id) } }
      }
      const id = ref.slice('household:'.length).split('#')[0]
      return pick(p.household.people.find((x) => x.id === id), 'Household member', ref)
    }
    case 'return': {
      const v3 = p.return_versions[p.return_versions.length - 1]
      return { kind: 'data', ref, title: 'The return (v3 summary)', value: v3.summary }
    }
    case 'season':
      return { kind: 'data', ref, title: 'Season deadlines', value: p.firm.deadlines }
    case 'line': {
      const findings = model.findings.filter((f) => f.fix?.target === ref || f.id.endsWith(`:${ref}`))
      const earlier = p.return_versions.flatMap((v) => {
        const l = model.linesByVersion[v.version]?.[ref]
        return l ? [{ version: v.version, label: l.label, value: l.value }] : []
      })
      return { kind: 'entry', ref, findings, earlier }
    }
    default: {
      const who = [...p.firm.staff, ...p.firm.client_users].find((x) => x.id === ref)
      return who ? { kind: 'data', ref, title: 'Person', value: who } : { kind: 'unknown', ref }
    }
  }
}

// ── Evidence ─────────────────────────────────────────────────────────────────────────────

export interface PageGroup {
  doc: string
  page: number
  /** Reads on this page that the refs name (drawn strongly). */
  focus: string[]
}

/**
 * Split evidence refs into document pages to draw (ev → its page, doc:D###pageN → that page, a bare
 * single-page D## → its page) and everything else, both in first-seen order.
 */
export function groupEvidence(model: Model, refs: string[]): { pages: PageGroup[]; other: string[] } {
  const pages: PageGroup[] = []
  const other: string[] = []
  const at = (doc: string, page: number): PageGroup => {
    let g = pages.find((x) => x.doc === doc && x.page === page)
    if (!g) pages.push((g = { doc, page, focus: [] }))
    return g
  }
  for (const r of [...new Set(refs)]) {
    const ev = model.ev[r]
    const pg = parsePageRef(r)
    if (ev) at(ev.document_id, ev.page).focus.push(r)
    else if (pg && model.docs[pg.doc]) at(pg.doc, pg.page)
    else if (model.docs[r]?.pages.length === 1 && !pages.some((x) => x.doc === r)) at(r, model.docs[r].pages[0].page)
    else other.push(r)
  }
  return { pages, other }
}

/** Findings that cite any of the refs as evidence or attach to one of them. */
export function findingsCiting(model: Model, refs: string[]): Finding[] {
  const set = new Set(refs)
  return model.findings.filter((f) => f.evidence.some((e) => set.has(e)) || f.claims.some((c) => set.has(c)))
}

/** Both spellings of a page ref: acts and finding evidence use `doc:D23#page3`, finding ids embed `D23#page3`. */
export const pageRefForms = (doc: string, page: number): string[] => [`doc:${doc}#page${page}`, `${doc}#page${page}`]

/** Findings shown on a claim's trace: its own, and for a document also those citing its pages or reads. */
export function claimFindingIds(model: Model, claim: Claim): string[] {
  const own = model.findingsByClaim[claim.id] ?? []
  if (claim.kind !== 'doc') return own
  const pages = (model.docs[claim.id]?.pages ?? []).flatMap((p) => pageRefForms(claim.id, p.page))
  const reads = (model.evByDoc[claim.id] ?? []).map((e) => e.id)
  return [...new Set([...own, ...findingsCiting(model, [claim.id, ...pages, ...reads]).map((f) => f.id)])]
}

export type Provenance = 'documents' | 'inputs' | 'client' | 'unsourced' | 'engine'
/** Where a line's value comes from. Client-only and unsourced come from the CHK-24 finding itself; a line with neither sources nor inputs that CHK-24 skipped holds an engine default, parameter or zero. */
export function provenanceOf(model: Model, claim: Claim): { kind: Provenance; finding?: string } {
  const id = `chk:CHK-24:${claim.id}`
  if (model.findingsById[id]) return { kind: claim.sources.length ? 'client' : 'unsourced', finding: id }
  if (claim.sources.length) return { kind: 'documents' }
  return { kind: claim.inputs.length ? 'inputs' : 'engine' }
}

/** A finding's `why` up to its first sentence: the statement of fact, without the advice that follows it. */
export const firstSentence = (s: string): string => {
  const end = s.indexOf('. ')
  return end < 0 ? s : s.slice(0, end + 1)
}

export interface FileLink {
  name: string
  mime: string
  size: number
  href: string // data URL
}
export interface AttachmentRow {
  seq: number
  actor: string
  recorded_at: string
  label: string
  text?: string
  files: FileLink[]
}

interface RawFile {
  name: string
  mime: string
  size: number
  data_base64?: string
}
const fileLink = (f: RawFile): FileLink => ({ name: f.name, mime: f.mime, size: f.size, href: `data:${f.mime};base64,${f.data_base64 ?? ''}` })

/** Files an act carries: an attach's file or a reply's attachments, as downloadable data URLs. */
export function actFiles(act: Act): FileLink[] {
  const b = act.body as { file?: RawFile; attachments?: RawFile[] }
  return [...(b.file ? [b.file] : []), ...(b.attachments ?? [])].map(fileLink)
}

/** Files and pasted text filed against a ref: attach acts (target or filed_against) and replies on its notes. */
export function attachmentsFor(state: State, ref: string): AttachmentRow[] {
  const dead = indexActs(state.acts).dead
  const notesOn = new Set(state.notes.filter((n) => n.target === ref).map((n) => `act:${n.seq}`))
  const out: AttachmentRow[] = []
  for (const a of state.acts) {
    if (dead.has(a.seq)) continue
    const b = a.body as { label?: string; text?: string; filed_against?: string[]; attachments?: RawFile[] }
    if (a.type === 'attach' && (a.target === ref || b.filed_against?.includes(ref))) {
      out.push({ seq: a.seq, actor: a.actor, recorded_at: a.recorded_at, label: b.label ?? 'Attachment', ...(b.text && { text: b.text }), files: actFiles(a) })
    } else if (a.type === 'reply' && notesOn.has(a.target) && b.attachments?.length) {
      out.push({ seq: a.seq, actor: a.actor, recorded_at: a.recorded_at, label: `Reply on ${a.target}`, ...(b.text && { text: b.text }), files: actFiles(a) })
    }
  }
  return out
}

/** Client communications among refs, plus any whose live disposition applies them to the claim. */
export function linkedComms(model: Model, state: State, ref: string, refs: string[]): string[] {
  const applied = Object.values(state.claims).filter((c) => c.disposition?.disposition === 'applied_to' && c.disposition.ref === ref).map((c) => c.id)
  return [...new Set([...refs, ...applied])].filter((r) => model.claims[r]?.kind === 'comm')
}

// ── Built ────────────────────────────────────────────────────────────────────────────────

export interface ValueRow {
  label: string // 2024 | v1 | v2 | v3
  value: Val | undefined
  delta: number | null // vs the row before
  pct: number | null // percent vs the row before
}

export function valueRows(claim: Claim): ValueRow[] {
  const v = claim.versions ?? {}
  const rows: [string, Val | undefined][] = [['2024', v.py], ['v1', v.v1], ['v2', v.v2], ['v3', v.v3]]
  return rows.map(([label, value], i) => {
    const prev = i > 0 ? rows[i - 1][1] : undefined
    const delta = typeof value === 'number' && typeof prev === 'number' ? value - prev : null
    const pct = delta !== null && typeof prev === 'number' && prev !== 0 ? (delta / Math.abs(prev)) * 100 : null
    return { label, value, delta, pct }
  })
}

export interface WhatIfTouch {
  id: string
  description: string
  old: number
  new: number
  fed: number
  ca: number
}

export function whatIfsTouching(model: Model, key: string): WhatIfTouch[] {
  return model.packet.what_if.alternatives.flatMap((a) => {
    const c = a.changed_lines.find((x) => x.key === key)
    return c ? [{ id: a.id, description: a.description, old: c.old, new: c.new, fed: a.federal.total_tax_change + (a.federal.penalty_change ?? 0), ca: a.california.total_tax_change }] : []
  })
}

// ── History ──────────────────────────────────────────────────────────────────────────────

export interface HistoryRow {
  act: Act
  reverted: boolean
  /** Undo would be wrong or meaningless: the clock only moves forward, filings reached an agency. */
  revertable: boolean
}

const NO_REVERT = new Set<Act['type']>(['revert', 'clock', 'file', 'view_sensitive', 'agency_result'])

/** Every act on or citing any of the refs, plus follow-ups on those acts (replies, resolutions, reverts). */
export function historyFor(state: State, refs: string[]): HistoryRow[] {
  const seqs = new Set(refs.flatMap((r) => state.actsByRef[r] ?? []))
  for (const s of [...seqs]) for (const f of state.actsByRef[`act:${s}`] ?? []) seqs.add(f)
  const dead = indexActs(state.acts).dead
  return state.acts.filter((a) => seqs.has(a.seq) && a.type !== 'view_sensitive').map((a) => historyRow(a, dead))
}

export const historyRow = (act: Act, dead: ReadonlySet<number>): HistoryRow => ({
  act,
  reverted: dead.has(act.seq),
  revertable: !NO_REVERT.has(act.type) && !dead.has(act.seq),
})

/** Net tax effect of the live adjusts on a ref. */
export function netEffect(state: State, ref: string): { fed: number; ca: number; count: number } {
  const live = state.adjusts.filter((a) => a.target === ref && !a.reverted)
  return { fed: live.reduce((s, a) => s + a.effect.fed, 0), ca: live.reduce((s, a) => s + a.effect.ca, 0), count: live.length }
}

/** Sign-offs whose scope includes the claim (its area, or the whole return). */
export function signoffsCovering(state: State, claim: Pick<Claim, 'id' | 'area'>): (SignoffView & { changedHere: boolean })[] {
  return state.signoffs
    .filter((s) => s.target === 'return' || s.target === `area:${claim.area}`)
    .map((s) => ({ ...s, changedHere: s.changed.includes(claim.id) }))
}

/** Reveal log rows for a ref: views logged with it as context, or of a token its value carries. */
export function viewLogFor(state: State, ref: string, value: Val | undefined): Act[] {
  const eqs = new Set(typeof value === 'string' ? splitMasked(value).flatMap((p) => (typeof p === 'string' ? [] : [p.eq])) : [])
  return state.viewLog.filter((a) => {
    const b = a.body as { context?: string; eq?: string }
    return b.context === ref || (b.eq !== undefined && eqs.has(b.eq))
  })
}
