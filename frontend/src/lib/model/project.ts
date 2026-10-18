// project(model, acts, viewer) → State. One pure module: the browser runs it for speed,
// the server runs it for enforcement. Acts must be in ascending seq order.
import { type Act, type ActInput, type AdjustDerived, type AgencyResultBody, type ApprovalDerived, DUE_DILIGENCE_QUESTIONS, type SignoffDerived } from './acts'
import type { Model } from './build'
import type { Claim, Val } from './claims'
import { effectSpec } from './effects'
import { hash } from './hash'
import { AREAS, AREA_LABEL, type AreaKey, SEASON_START, parsePageRef, seasonEvents } from './ids'
import { MASK_RE, sameValue } from './mask-token'
import type {
  AdjustView, ApprovalView, AreaView, ClaimState, ClaimStatus, FilingView, FindingState, Flag, InboxItem, NoteView,
  Reason, SignoffView, Stage, State, StepView, Support, SupportLetter, Totals, Viewer,
} from './state'
import { identities } from './viewer'

export type Body<T extends ActInput['type']> = Extract<ActInput, { type: T }>['body']

/** Review hierarchy: a higher rank may clear or revert a lower rank's work. */
export const RANK: Record<string, number> = {
  client: 0, system: 0, firm_administrator: 0, preparer: 1, reviewer: 2, partner: 3, quality_reviewer: 3,
}

const LETTER: Record<string, SupportLetter> = {
  agreed_to_source_document: 'D',
  recalculated: 'R',
  confirmed_with_client: 'C',
  agreed_to_prior_year: 'P',
  agreed_to_third_party_record: 'T',
}

const seqOf = (ref: string) => (ref.startsWith('act:') ? Number(ref.slice(4)) : NaN)

// A date, or a UTC time. Strings without a zone parse as machine-local time, so browser and server would disagree.
const INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/

/** A season-clock instant as `YYYY-MM-DDTHH:MM:SSZ` (to the second), or null unless `s` is a date or a full UTC time. */
export function seasonInstant(s: string): string | null {
  const t = INSTANT.test(s) ? Date.parse(s) : NaN
  const iso = Number.isNaN(t) ? null : `${new Date(t).toISOString().slice(0, 19)}Z`
  return iso && iso.slice(0, 10) === s.slice(0, 10) ? iso : null
}

/** A required entry the return lacks (CHK-49 subject, e.g. F1040.digital_assets): not a claim, but a line-shaped key. */
const REQUIRED_ENTRY = /^[A-Za-z0-9-]+\.[\w.]+$/

// ── Act index ─────────────────────────────────────────────────────────────────────────────

export interface ActIndex {
  live: Act[]
  dead: Set<number>
  bySeq: Map<number, Act>
  clock: string
}

/** Acts a revert of `act:<seq>` or `batch:<id>` written at `before` would undo. */
export function revertTargets(acts: Act[], target: string, before = Infinity): Act[] {
  if (target.startsWith('act:')) return acts.filter((a) => a.seq === seqOf(target) && a.seq < before)
  if (target.startsWith('batch:')) return acts.filter((a) => a.batch_id === target.slice(6) && a.seq < before)
  return []
}

export function indexActs(acts: Act[]): ActIndex {
  const dead = new Set<number>()
  // Newest first, so a reverted revert never kills its targets.
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i]
    if (a.type === 'revert' && !dead.has(a.seq)) for (const t of revertTargets(acts, a.target, a.seq)) dead.add(t.seq)
  }
  const live = acts.filter((a) => !dead.has(a.seq))
  let clock = SEASON_START
  for (const a of live) {
    const to = a.type === 'clock' ? seasonInstant((a.body as Body<'clock'>).to) : null
    if (to && to > clock) clock = to
  }
  return { live, dead, bySeq: new Map(acts.map((a) => [a.seq, a])), clock }
}

/**
 * Claims a ref points at: the claim itself, a page's document, a finding's primary claim, a required entry's
 * anchor line, or an act's target.
 */
export function claimsOfRef(model: Model, bySeq: Map<number, Act>, ref: string, depth = 0): string[] {
  if (model.claims[ref]) return [ref]
  const primary = ref.startsWith('chk:') ? model.findingsById[ref]?.claims[0]
    : REQUIRED_ENTRY.test(ref) ? model.findingsById[`chk:CHK-49:${ref}`]?.claims[0]
    : undefined
  if (primary) return [primary]
  if (ref.startsWith('chk:')) return []
  if (ref.startsWith('act:')) {
    const a = bySeq.get(seqOf(ref))
    return a && depth < 4 ? claimsOfRef(model, bySeq, a.target, depth + 1) : []
  }
  const pg = parsePageRef(ref)
  return pg && model.claims[pg.doc] ? [pg.doc] : []
}

/** Live adjusts citing what-if `id`, oldest first. The first carries the engine result; later ones carry zero. */
export function whatIfCites(state: State, id: string): Act[] {
  const live = new Set(state.adjusts.filter((v) => !v.reverted).map((v) => v.seq))
  return state.acts.filter((a) => a.type === 'adjust' && live.has(a.seq) && (a.body as Body<'adjust'>).what_if === id)
}

/** Step 5's reason; its `refs` are the CHK-26 findings the gate still counts as unexplained, which the swings record reads. */
export const SWING_UNEXPLAINED = 'Prior-year swing not explained'

const isNoticeResponse = (a: Pick<Act, 'type' | 'body'>) => a.type === 'decide' && (a.body as Body<'decide'>).kind === 'notice_response'

/**
 * Findings an act clears, in order: those it lists, then (unless it answers a notice) its chk: target for a resolve, dispose
 * or decide, then the findings whose primary claim it targets for a dispose or decide. Pass `byPrimary` to skip the scan.
 */
export function findingsClearedBy(model: Model, a: Pick<Act, 'type' | 'target' | 'body'>, byPrimary?: Record<string, string[]>): string[] {
  const ids = [...((a.body as { findings?: string[] }).findings ?? [])]
  if (!isNoticeResponse(a)) {
    if (a.type === 'resolve' || a.type === 'dispose' || a.type === 'decide') ids.push(a.target)
    if (a.type === 'dispose' || a.type === 'decide') ids.push(...(byPrimary ? (byPrimary[a.target] ?? []) : model.findings.filter((f) => f.claims[0] === a.target).map((f) => f.id)))
  }
  return ids.filter((id) => model.findingsById[id])
}

/** Logged hours to the hundredth, so a sum of decimal time acts (0.4 + 0.8 + 0.3) meets its budget exactly instead of passing it by float noise. */
export const roundHours = (n: number): number => Math.round(n * 100) / 100

/** Sign-off scope: the area's claims, or every claim for `return`. */
export function scopeOf(model: Model, target: string): string[] {
  return model.claimList.filter((c) => target === 'return' || `area:${c.area}` === target).map((c) => c.id)
}

export function fingerprintOf(claims: Record<string, { hash: string }>, scope: string[]): string {
  return hash([...scope].sort().map((id) => [id, claims[id]?.hash ?? null]))
}

// ── Preparers and evidence ────────────────────────────────────────────────────────────────

const PREPARING = new Set(['adjust', 'decide', 'dispose', 'attach'])

function preparedRefsOf(model: Model, ix: ActIndex): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  const add = (claim: string, actor: string, ref: string) => {
    const m = (out[claim] ??= {})
    m[actor] ??= ref
  }
  const timeline = new Map(model.packet.timeline.map((t) => [`timeline:${t.id}`, t]))
  for (const c of model.claimList) {
    for (const s of c.sources) {
      const t = timeline.get(s)
      if (t?.actor && t.at <= ix.clock) add(c.id, t.actor, s)
      else if (s.startsWith('qa-')) add(c.id, 'client', s)
    }
  }
  for (const a of ix.live) {
    let refs: string[] = []
    // Lead decision: the partner decides elections and still signs the return, so a partner's decide prepares nothing.
    if (a.type === 'decide' && a.actor_role === 'partner') continue
    if (a.type === 'verify') refs = (a.body as Body<'verify'>).level === 'preparer' ? [a.target] : []
    else if (a.type === 'attach') refs = [a.target, ...((a.body as Body<'attach'>).filed_against ?? [])]
    else if (PREPARING.has(a.type)) refs = [a.target]
    for (const r of refs) for (const c of claimsOfRef(model, ix.bySeq, r)) add(c, a.actor, `act:${a.seq}`)
  }
  return out
}

/** claim → actor → the ref that makes them its preparer (packet timeline event or act). */
export function preparedRefs(model: Model, acts: Act[]): Record<string, Record<string, string>> {
  return preparedRefsOf(model, indexActs(acts))
}

/** Evidence added by acts: attaches and replies filed against a claim, and comms disposed as applied to it. */
function extraEvidence(model: Model, ix: ActIndex): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const add = (refs: string[], ev: string) => {
    for (const r of refs) for (const c of claimsOfRef(model, ix.bySeq, r)) (out[c] ??= []).push(ev)
  }
  for (const a of ix.live) {
    if (a.type === 'attach') add([a.target, ...((a.body as Body<'attach'>).filed_against ?? [])], `act:${a.seq}`)
    else if (a.type === 'reply') add([a.target], `act:${a.seq}`)
    else if (a.type === 'dispose') {
      const b = a.body as Body<'dispose'>
      if (b.disposition === 'applied_to' && b.ref) add([b.ref], a.target)
    }
  }
  return out
}

function evidenceSet(model: Model, c: Claim, extra: string[] | undefined, clock: string): string[] {
  return [...new Set([...c.sources.filter((s) => model.knownAt(s) <= clock), ...(extra ?? [])])].sort()
}

/** A claim's evidence set now (verify stores its hash as support_hash). */
export function evidenceOf(model: Model, acts: Act[], id: string): string[] {
  const c = model.claims[id]
  if (!c) return []
  const ix = indexActs(acts)
  return evidenceSet(model, c, extraEvidence(model, ix)[id], ix.clock)
}

// ── Projection ────────────────────────────────────────────────────────────────────────────

const STEP_COUNT = 12

export function project(model: Model, acts: Act[], viewer: Viewer, engagement = 'main'): State {
  const p = model.packet
  const v3 = p.return_versions[p.return_versions.length - 1]
  const ix = indexActs(acts)
  const { live, clock } = ix
  const claimsOf = (ref: string) => claimsOfRef(model, ix.bySeq, ref)
  const people = identities(p)
  const nameOf = (id: string) => people.find((v) => v.id === id)?.name ?? id

  const byTarget: Record<string, Act[]> = {}
  for (const a of live) (byTarget[a.target] ??= []).push(a)
  const liveOn = (id: string, type: Act['type']) => (byTarget[id] ?? []).filter((a) => a.type === type)

  // Findings: cleared by an act listing them, a resolve, or a dispose/decide on the finding or its primary claim.
  // A notice response answers the agency about a filed claim: it clears only the findings it lists.
  const byPrimary: Record<string, string[]> = {}
  for (const f of model.findings) if (f.claims[0]) (byPrimary[f.claims[0]] ??= []).push(f.id)
  const resolvedBy = new Map<string, NonNullable<FindingState['resolvedBy']>>()
  const clear = (id: string, a: Act) => {
    if (model.findingsById[id] && !resolvedBy.has(id)) resolvedBy.set(id, { seq: a.seq, actor: a.actor, how: a.type })
  }
  for (const a of live) for (const id of findingsClearedBy(model, a, byPrimary)) clear(id, a)
  const findings: Record<string, FindingState> = {}
  for (const f of model.findings) {
    const r = resolvedBy.get(f.id)
    findings[f.id] = { id: f.id, status: r ? 'resolved' : 'open', visible: f.knownSince <= clock, ...(r && { resolvedBy: r }) }
  }
  const findingOpen = (id: string) => findings[id].visible && findings[id].status === 'open'
  // Spec §2.8: a higher-level verify never reopens a sign-off, so a finding it clears still counts as open in the hash.
  const clearedByReview = (id: string) => {
    const r = findings[id].resolvedBy
    const level = r?.how === 'verify' ? (ix.bySeq.get(r.seq)?.body as Body<'verify'> | undefined)?.level : undefined
    return level === 'reviewer' || level === 'partner' || level === 'quality'
  }

  // Notes, replies, resolutions. A blocking note clears only by its author or a higher level.
  const notes: NoteView[] = []
  const noteBySeq = new Map<number, NoteView>()
  for (const a of live) {
    if (a.type === 'note') {
      const b = a.body as Body<'note'>
      const n: NoteView = {
        seq: a.seq, actor: a.actor, target: a.target, kind: b.kind, to: b.to, text: b.text, blocking: b.blocking,
        due: b.due, recorded_at: a.recorded_at, season_at: a.season_at, replies: [], open: b.kind !== 'memo',
      }
      notes.push(n)
      noteBySeq.set(a.seq, n)
    } else if (a.type === 'reply') {
      const b = a.body as Body<'reply'>
      noteBySeq.get(seqOf(a.target))?.replies.push({
        seq: a.seq, actor: a.actor, text: b.text, recorded_at: a.recorded_at,
        attachments: (b.attachments ?? []).map(({ name, mime, size }) => ({ name, mime, size })),
      })
    } else if (a.type === 'resolve') {
      const n = noteBySeq.get(seqOf(a.target))
      const author = n && ix.bySeq.get(n.seq)
      if (!n || n.resolved || !author) continue
      if (n.blocking && a.actor !== n.actor && RANK[a.actor_role] <= RANK[author.actor_role]) continue
      const b = a.body as Body<'resolve'>
      n.resolved = { seq: a.seq, actor: a.actor, resolution: b.resolution, text: b.text }
      n.open = false
    }
  }
  const openNotesOn: Record<string, number[]> = {}
  for (const n of notes) if (n.open) for (const c of claimsOf(n.target)) (openNotesOn[c] ??= []).push(n.seq)

  // Adjusts: effective value = last live 'value' adjust; basis/label adjusts keep the value.
  const adjusts: AdjustView[] = []
  const effective: Record<string, Val> = {}
  const lastAdjust: Record<string, AdjustView> = {}
  const labelTo: Record<string, Val> = {}
  for (const a of acts) {
    if (a.type !== 'adjust') continue
    const b = a.body as Body<'adjust'>
    const d = a.derived as Partial<AdjustDerived>
    const v: AdjustView = {
      seq: a.seq, actor: a.actor, target: a.target, field: b.field, from: d.from ?? null, to: b.to, reason: b.reason,
      evidence: b.evidence, effect: { fed: d.effect?.fed ?? 0, ca: d.effect?.ca ?? 0, basis: d.effect?.basis ?? 'none' },
      needs_partner: d.needs_partner ?? false, partner_covered: false, amendment: d.amendment ?? 0,
      batch_id: a.batch_id, recorded_at: a.recorded_at, reverted: ix.dead.has(a.seq),
    }
    adjusts.push(v)
    if (v.reverted) continue
    lastAdjust[a.target] = v
    if (b.field === 'value') effective[a.target] = b.to
    if (b.field === 'label') labelTo[a.target] = b.to
  }
  const liveAdjusts = adjusts.filter((v) => !v.reverted)

  // Live adjust/decide seqs per claim feed the claim hash; verify acts and notice responses never do.
  const changeSeqs: Record<string, number[]> = {}
  for (const a of live) {
    if (a.type === 'adjust' || (a.type === 'decide' && !isNoticeResponse(a))) for (const c of claimsOf(a.target)) (changeSeqs[c] ??= []).push(a.seq)
  }

  // Filings, freeze and amendments.
  const filings: FilingView[] = []
  const filingBySeq = new Map<number, FilingView>()
  const frozen = { federal: false, california: false }
  let amendment = 0
  for (const a of live) {
    if (a.type === 'file') {
      const b = a.body as Body<'file'>
      const f: FilingView = { seq: a.seq, kind: b.kind, jurisdictions: b.jurisdictions, actor: a.actor, recorded_at: a.recorded_at, results: [] }
      filings.push(f)
      filingBySeq.set(a.seq, f)
    } else if (a.type === 'agency_result') {
      const f = filingBySeq.get(seqOf(a.target))
      const b = a.body as unknown as AgencyResultBody
      if (!f) continue
      f.results.push({ seq: a.seq, jurisdiction: b.jurisdiction, status: b.status, errors: b.errors ?? [] })
      if (f.kind === 'submit' && b.status === 'accepted') frozen[b.jurisdiction] = true
    } else if (a.type === 'amend_open') {
      frozen.federal = frozen.california = false
      amendment++
    }
  }

  const prepared = preparedRefsOf(model, ix)
  const extra = extraEvidence(model, ix)
  const cited = new Set(Object.keys(model.citedBy))
  for (const a of live) {
    const b = a.body as { evidence?: string[]; filed_against?: string[]; ref?: string }
    for (const r of [...(b.evidence ?? []), ...(b.filed_against ?? [])]) cited.add(r)
    if (a.type === 'attach') cited.add(a.target)
    if (b.ref) cited.add(b.ref)
  }

  // Per-claim state. Step claims get their status after the steps are computed.
  const claims: Record<string, ClaimState> = {}
  for (const c of model.claimList) {
    const known = c.knownAt <= clock
    const eff = c.id in effective ? effective[c.id] : (c.value ?? null)
    const visibleF = (model.findingsByClaim[c.id] ?? []).filter((id) => findings[id].visible)
    const openF = visibleF.filter((id) => findings[id].status === 'open')
    const hashF = visibleF.filter((id) => findings[id].status === 'open' || clearedByReview(id)).sort()
    const evidence = evidenceSet(model, c, extra[c.id], clock)
    const evidenceHash = hash(evidence)
    const openNotes = openNotesOn[c.id] ?? []

    const supportOf = (a: Act) => (a.derived as { support_hash?: string }).support_hash
    const verifyActs = liveOn(c.id, 'verify')
    const verifications = verifyActs.map((a) => {
      const b = a.body as Body<'verify'>
      const support = supportOf(a)
      return { seq: a.seq, actor: a.actor, method: b.method, level: b.level, valid: sameValue(b.seen_value, eff) && (!support || support === evidenceHash) }
    })
    // Evidence added after the latest verify reopens the claim; verifying again (on the new evidence) closes it.
    const latestSupport = verifyActs.length ? supportOf(verifyActs[verifyActs.length - 1]) : undefined
    const supportBroken = !!latestSupport && latestSupport !== evidenceHash
    const disposeAct = liveOn(c.id, 'dispose').at(-1)
    const decideAct = liveOn(c.id, 'decide').at(-1)

    const human = verifications.filter((v) => v.valid && LETTER[v.method])
    const accepted = verifications.find((v) => v.valid && v.method === 'accepted_check_tied' && (v.level === 'reviewer' || v.level === 'partner'))
    const support: Support[] = []
    for (const v of human) if (!support.some((s) => s.letter === LETTER[v.method])) support.push({ letter: LETTER[v.method], how: 'filled', by: v.actor })
    const familyOpen = (family: string) => openF.some((id) => model.findingsById[id].family === family)
    const hasEv = c.sources.some((s) => s.startsWith('ev-'))
    const earned: SupportLetter[] = []
    if (hasEv && !familyOpen('printed_vs_extracted')) earned.push('D')
    if (c.sources.some((s) => s.startsWith('agency:')) && !familyOpen('agency_tieout')) earned.push('T')
    if (c.kind === 'line' && typeof eff === 'number' && sameValue(c.versions?.py, eff)) earned.push('P')
    if (c.sources.some((s) => s.startsWith('qa-'))) earned.push('C')
    for (const l of earned) {
      if (!support.some((s) => s.letter === l)) support.push(accepted ? { letter: l, how: 'ringed', by: accepted.actor } : { letter: l, how: 'outlined' })
    }

    const undisposed = known && !disposeAct && (
      (c.kind === 'doc' && !model.landedIn[c.id]?.length) ||
      (c.kind === 'comm' && !cited.has(c.id)) ||
      ((c.kind === 'diag' || c.kind === 'whatif') && !decideAct) ||
      c.kind === 'prior_item')
    const open = openF.some((id) => model.findingsById[id].severity !== 'info') || openNotes.length > 0 || supportBroken || undisposed
    const status: ClaimStatus = open ? 'open'
      : lastAdjust[c.id] ? 'adjusted'
      : human.length ? 'verified'
      : accepted ? 'accepted'
      : hasEv && openF.length === 0 ? 'read_ok'
      : 'unreviewed'

    const flags: Flag[] = []
    if (!known) flags.push('not_yet_in_file')
    if (c.jurisdiction ? frozen[c.jurisdiction] : frozen.federal || frozen.california) flags.push('frozen')

    const stake = { fed: 0, ca: 0 }
    for (const id of openF) {
      const s = model.findingsById[id].stake
      if (s) {
        stake.fed = Math.max(stake.fed, Math.abs(s.fed))
        stake.ca = Math.max(stake.ca, Math.abs(s.ca))
      }
    }

    const da = disposeAct?.body as Body<'dispose'> | undefined
    const de = decideAct?.body as Body<'decide'> | undefined
    claims[c.id] = {
      id: c.id, status, original: c.value ?? null, effective: eff, ...(lastAdjust[c.id] && { adjust: lastAdjust[c.id] }),
      support, openFindings: openF, resolvedFindings: visibleF.filter((id) => findings[id].status === 'resolved'),
      openNotes,
      ...(disposeAct && da && { disposition: { seq: disposeAct.seq, actor: disposeAct.actor, disposition: da.disposition, ref: da.ref, reason: da.reason } }),
      ...(decideAct && de && { decision: { seq: decideAct.seq, actor: decideAct.actor, kind: de.kind, choice: de.choice, authority: de.authority } }),
      verifications, flags, stake, preparedBy: Object.keys(prepared[c.id] ?? {}),
      hash: hash([c.id, eff, evidence, hashF, [...openNotes].sort((x, y) => x - y), [...(changeSeqs[c.id] ?? [])].sort((x, y) => x - y)]),
      openBelow: 0,
    }
  }

  // Sign-offs are valid while the scope's fingerprint is unchanged.
  const signoffs: SignoffView[] = live.filter((a) => a.type === 'signoff').map((a) => {
    const d = a.derived as Partial<SignoffDerived>
    const scope = d.scope ?? []
    const valid = !!d.fingerprint && fingerprintOf(claims, scope) === d.fingerprint
    return {
      seq: a.seq, actor: a.actor, target: a.target, level: (a.body as Body<'signoff'>).level, valid,
      changed: valid ? [] : scope.filter((id) => claims[id]?.hash.slice(0, 8) !== d.claim_hashes?.[id]),
      recorded_at: a.recorded_at, scope_size: scope.length,
    }
  })
  const latestSignoff = new Map<string, SignoffView>()
  for (const s of signoffs) latestSignoff.set(`${s.target}|${s.level}`, s)
  for (const s of latestSignoff.values()) if (!s.valid) for (const id of s.changed) addFlag(claims[id], 'reopened')

  // Partner coverage: a valid partner sign-off listing the adjust, by a partner who did not prepare the claim.
  const coveredBy = new Map<number, string[]>()
  for (const s of signoffs) {
    if (!s.valid || s.level !== 'partner') continue
    for (const seq of (ix.bySeq.get(s.seq)?.derived as Partial<SignoffDerived>).covered_adjusts ?? []) {
      coveredBy.set(seq, [...(coveredBy.get(seq) ?? []), s.actor])
    }
  }
  for (const v of liveAdjusts) {
    v.partner_covered = (coveredBy.get(v.seq) ?? []).some((actor) => !claims[v.target]?.preparedBy.includes(actor))
    if (v.needs_partner && !v.partner_covered) addFlag(claims[v.target], 'needs_partner')
  }

  // Stale: an input (transitively) was adjusted, so the engine value above it does not include the change.
  const staleSeen = new Set<string>()
  const markStale = (id: string) => {
    for (const u of model.claims[id]?.usedBy ?? []) {
      if (staleSeen.has(u)) continue
      staleSeen.add(u)
      addFlag(claims[u], 'stale')
      markStale(u)
    }
  }
  for (const v of liveAdjusts) if (v.field !== 'label') markStale(v.target)

  // Totals and hashes.
  const sum = (k: 'fed' | 'ca') => liveAdjusts.reduce((s, v) => s + v.effect[k], 0)
  const totals: Totals = {
    federal: { v3: { ...v3.summary.federal }, delta: sum('fed'), balance_estimate: v3.summary.federal.balance_due + sum('fed') },
    california: { v3: { ...v3.summary.california }, delta: sum('ca'), balance_estimate: v3.summary.california.balance_due + sum('ca') },
    warnings: thresholdWarnings(model, liveAdjusts),
  }
  const byId = (x: [string, unknown], y: [string, unknown]) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)
  const lineValues = model.claimList.filter((c) => c.kind === 'line').map((c): [string, Val] => [c.id, claims[c.id].effective])
  const amountsHash = hash({
    summary: v3.summary,
    estimate: { federal: totals.federal.balance_estimate, california: totals.california.balance_estimate },
    lines: lineValues.filter(([, v]) => typeof v === 'number').sort(byId),
  })
  const identityHash = hash({
    facts: model.claimList.filter((c) => c.kind === 'fact').map((c): [string, Val] => [c.id, claims[c.id].effective]).sort(byId),
    text: lineValues.filter(([, v]) => typeof v === 'string').sort(byId),
    labels: Object.entries(labelTo).sort(byId),
  })

  // Client approval binds to the amounts at request time.
  const request = [...live].reverse().find((a) => a.type === 'request_approval')
  let approval: ApprovalView | undefined
  if (request) {
    const d = request.derived as Partial<ApprovalDerived>
    const current = d.amounts_hash === amountsHash
    const approvals = live
      .filter((a) => a.type === 'client_approve' && a.target === `act:${request.seq}`)
      .map((a) => ({ signer: a.actor, seq: a.seq, valid: current && ((a.derived as { amounts_hash?: string }).amounts_hash ?? d.amounts_hash) === amountsHash }))
    approval = {
      request_seq: request.seq, requested_by: request.actor, amounts_hash: d.amounts_hash ?? '', current, approvals,
      complete: p.firm.client_users.every((u) => approvals.some((x) => x.signer === u.id && x.valid)),
    }
  }

  // Required steps, gates, blocks_filing.
  const verifiedBy = (id: string, letters?: SupportLetter[]) =>
    !!claims[id]?.verifications.some((v) => v.valid && (letters ? letters.includes(LETTER[v.method]) : true))
  const decidedAs = (id: string, kind: string) => liveOn(id, 'decide').some((a) => (a.body as Body<'decide'>).kind === kind)
  const openOf = (check: string) => model.findings.filter((f) => f.check === check && findingOpen(f.id)).map((f) => f.id)
  const validSignoff = (target: string, level: string) =>
    signoffs.some((s) => s.valid && s.level === level && (s.target === target || s.target === 'return'))
  const uncovered = liveAdjusts.filter((v) => v.needs_partner && !v.partner_covered)
  const stepItems: string[][] = []
  const steps: StepView[] = []
  const step = (checks: [string, string[]][]) => {
    const n = steps.length + 1
    const items = checks.flatMap(([, ids]) => ids)
    stepItems.push(items)
    steps.push({ n, label: p.firm.starter_standards.required_steps[n - 1] ?? `Step ${n}`, ok: items.length === 0, reasons: checks.flatMap(([what, ids]) => listReason(what, ids)) })
  }
  const kindOf = (k: Claim['kind']) => model.claimList.filter((c) => c.kind === k && c.knownAt <= clock).map((c) => c.id)
  const idFacts = model.claimList.filter((c) => /^household:[^#]+#(ssn|dob)$/.test(c.id)).map((c) => c.id)
  const carryLines = model.claimList.filter((c) => c.kind === 'line' && c.sources.some((s) => s.startsWith('py:/carryovers_into_2025'))).map((c) => c.id)
  const swingIds = model.findings
    .filter((f) => f.check === 'CHK-26' && findingOpen(f.id))
    .filter((f) => !(f.claims[0] && (decidedAs(f.claims[0], 'swing_explained') || lastAdjust[f.claims[0]])))
    .map((f) => f.id)
  const dd = liveOn('F8867.status', 'decide').some((a) => {
    const b = a.body as Body<'decide'>
    return b.kind === 'due_diligence' && DUE_DILIGENCE_QUESTIONS.every((q) => b.checklist?.[q.key]) // also guards forced or older acts
  })
  // The Form 2210 prompt needs a live 'penalty' decide on its line; resolving the finding or a judgment does not answer it.
  const penalty = model.findingsById['chk:CHK-38:penalty']
  const penaltyUndecided = penalty && findings[penalty.id].visible && !decidedAs(penalty.claims[0], 'penalty') ? [penalty.claims[0]] : []

  step([['Not verified to the signed document', ['D01', 'D02'].filter((id) => !verifiedBy(id, ['D']))]])
  step([
    ['Identity not verified D or T (or decided with authority)', idFacts.filter((id) => !verifiedBy(id, ['D', 'T']) && !decidedAs(id, 'judgment'))],
    ['Open identity finding', openOf('CHK-08')],
  ])
  step([['Not disposed', ['D06', 'D07', ...kindOf('prior_item')].filter((id) => !claims[id]?.disposition)]])
  step([
    ['Document not accounted for', [...openOf('CHK-48'), ...openOf('CHK-18'), ...openOf('CHK-03').filter((id) => /^chk:CHK-03:D\d+$/.test(id))]],
    ['Client communication neither cited nor disposed', kindOf('comm').filter((id) => !cited.has(id) && !claims[id].disposition)],
  ])
  step([[SWING_UNEXPLAINED, swingIds]])
  step([
    ['Carryover not agreed to prior year', carryLines.filter((id) => !verifiedBy(id, ['P']) && !lastAdjust[id])],
    ['Open carryover finding', openOf('CHK-28')],
  ])
  step([
    ['Not agreed to the IRS or FTB record', ['F1040.26', 'F540NR.72'].filter((id) => !verifiedBy(id, ['T']))],
    ['Extension payment not verified', ['Sch3.10'].filter((id) => !verifiedBy(id))],
    ['Open payment finding', openOf('CHK-19')],
    ['Underpayment penalty not decided with authority', penaltyUndecided],
    // By id: CHK-60's late-payment finding appears only after filing, when the payment lines are frozen.
    ['Open extension finding', openOf('CHK-60').filter((id) => id === 'chk:CHK-60:extension')],
  ])
  step([
    ["Due diligence not documented (F8867 'Not completed')", dd ? [] : ['F8867.status']],
    ['Identity (step 2) not green', steps[1].ok ? [] : ['step:2']],
    ['Student status not verified', ['D59'].filter((id) => !verifiedBy(id))],
  ])
  step([
    ['Engine diagnostic or alternative without a disposition', [...kindOf('diag'), ...kindOf('whatif')].filter((id) => !claims[id].disposition && !claims[id].decision)],
    ['Open diagnostic finding', openOf('CHK-52')],
  ])
  step([['No valid reviewer sign-off', AREAS.map((k) => `area:${k}`).filter((t) => !validSignoff(t, 'reviewer'))]])
  step([
    ['No valid partner sign-off on the return', signoffs.some((s) => s.valid && s.level === 'partner' && s.target === 'return') ? [] : ['return']],
    ['Over 1,000 without a valid partner sign-off', uncovered.map((v) => v.target)],
  ])
  step([
    ['Client approval not requested', approval ? [] : ['return']],
    ['Amounts changed since approval was requested', approval && !approval.current ? [`act:${approval.request_seq}`] : []],
    ['Not yet approved by', approval?.current ? p.firm.client_users.filter((u) => !approval.approvals.some((x) => x.signer === u.id && x.valid)).map((u) => u.id) : []],
  ])
  for (const s of steps) {
    const c = claims[`step:${s.n}`]
    if (c && !s.ok) c.status = 'open'
  }

  const blocking = notes.filter((n) => n.open && n.blocking && n.kind === 'review_note')
  const blockReasons: Reason[] = blocking.map((n) => ({ text: `Blocking review note by ${nameOf(n.actor)} on ${n.target}: ${clip(n.text)}`, ref: `act:${n.seq}` }))
  const stepReasons = (upTo: number): Reason[] =>
    steps.slice(0, upTo).filter((s) => !s.ok).map((s) => ({ text: `Step ${s.n} (${s.label}): ${s.reasons[0]?.text ?? 'not met'}`, ref: s.reasons[0]?.ref ?? `step:${s.n}` }))
  const partnerReason: Reason[] = uncovered.length
    ? [{ text: `${uncovered.length} ${uncovered.length === 1 ? 'item' : 'items'} over 1,000 ${uncovered.length === 1 ? 'lacks' : 'lack'} a valid partner sign-off.`, ref: uncovered[0].target }]
    : []
  const approvalReasons = [...stepReasons(STEP_COUNT - 1), ...blockReasons, ...partnerReason]
  const submitReasons = [...stepReasons(STEP_COUNT), ...blockReasons]
  const gates = {
    request_approval: { ok: approvalReasons.length === 0, reasons: approvalReasons },
    submit: { ok: submitReasons.length === 0, reasons: submitReasons },
  }
  const blockingRefs = [...stepItems.flat(), ...blocking.map((n) => n.target), ...uncovered.map((v) => v.target)]
  for (const r of blockingRefs) for (const c of claimsOf(r)) addFlag(claims[c], 'blocks_filing')

  // Open claims below each line in the inputs tree.
  const below = new Map<string, Set<string>>()
  const openBelow = (id: string): Set<string> => {
    let s = below.get(id)
    if (s) return s
    s = new Set()
    below.set(id, s)
    for (const i of model.claims[id]?.inputs ?? []) {
      if (claims[i]?.status === 'open') s.add(i)
      for (const x of openBelow(i)) s.add(x)
    }
    return s
  }
  for (const c of model.claimList) if (c.kind === 'line') claims[c.id].openBelow = openBelow(c.id).size

  // Areas: assignments, time, definition of done.
  const a0 = p.firm.assignment_at_start
  const assignments = Object.fromEntries(AREAS.map((k) => [k, a0.preparer])) as Record<AreaKey, string>
  const hours: Record<string, number> = {}
  for (const a of live) {
    const key = a.target.slice('area:'.length) as AreaKey
    if (a.type === 'assign' && key in assignments) assignments[key] = (a.body as Body<'assign'>).assignee
    if (a.type === 'time') hours[key] = (hours[key] ?? 0) + (a.body as Body<'time'>).hours
  }
  const areas: AreaView[] = AREAS.map((key) => {
    const target = `area:${key}`
    const inArea = model.claimList.filter((c) => c.area === key)
    const known = inArea.filter((c) => c.knownAt <= clock)
    const ids = (cs: Claim[]) => cs.map((c) => c.id)
    const areaFindings = model.findings.filter((f) => findingOpen(f.id) && model.claims[f.claims[0]]?.area === key)
    const latest = (level: 'preparer' | 'reviewer' | 'partner') => latestSignoff.get(`${target}|${level}`)
    const questions = notes.filter((n) => n.open && n.kind.startsWith('question') && (n.target === target || claimsOf(n.target).some((c) => model.claims[c].area === key)))
    const signoffsOk = !!latest('preparer')?.valid && !!latest('reviewer')?.valid
    const item = (label: string, open: string[]) => ({ label, ok: open.length === 0, ...(open[0] && { ref: open[0] }) })
    return {
      key, label: AREA_LABEL[key], claims: inArea.length, open: inArea.filter((c) => claims[c.id].status === 'open').length,
      findingsOpen: areaFindings.length,
      signoffs: Object.fromEntries((['preparer', 'reviewer', 'partner'] as const).flatMap((l) => (latest(l) ? [[l, latest(l)]] : []))),
      assignee: assignments[key], hours: roundHours(hours[key] ?? 0), budget: p.firm.budget_hours[key] ?? null,
      done: [
        item('Every document landed or disposed', ids(known.filter((c) => c.kind === 'doc' && !model.landedIn[c.id]?.length && !claims[c.id].disposition))),
        item('Every leaf line verified, accepted or adjusted', ids(known.filter((c) => c.kind === 'line' && c.inputs.length === 0 && !lastAdjust[c.id] && !verifiedBy(c.id)))),
        item('Every finding resolved or decided', areaFindings.map((f) => f.id)),
        item('Every prior-year swing explained', areaFindings.filter((f) => f.check === 'CHK-26').map((f) => f.id)),
        item('Every required entry answered with a source', areaFindings.filter((f) => f.check === 'CHK-49').map((f) => f.id)),
        item('Every engine diagnostic disposed', ids(known.filter((c) => (c.kind === 'diag' || c.kind === 'whatif') && !claims[c.id].disposition && !claims[c.id].decision))),
        item('Every question answered or carried', questions.map((n) => `act:${n.seq}`)),
        item('Preparer then reviewer sign-off, both valid', signoffsOk ? [] : [target]),
      ],
    }
  })

  const anyFrozen = frozen.federal || frozen.california
  const stage: Stage = anyFrozen ? 'filed'
    : amendment > 0 ? 'amending'
    : approval ? 'approval'
    : steps[9].ok ? 'partner'
    : signoffs.some((s) => s.valid && s.level === 'preparer') ? 'review'
    : 'preparation'

  const actsByRef: Record<string, number[]> = {}
  for (const a of acts) for (const r of new Set([a.target, ...a.refs])) (actsByRef[r] ??= []).push(a.seq)
  const next = seasonEvents(p, clock)[0]

  return {
    engagement, head: acts.at(-1)?.seq ?? 0, clock, ...(next && { nextEvent: next }), viewer, stage, claims, findings, notes,
    adjusts, signoffs, steps, gates, ...(approval && { approval }), filings, frozen, amendment, areas, assignments, totals,
    viewLog: acts.filter((a) => a.type === 'view_sensitive'),
    inbox: inboxFor(viewer, notes, live, [...latestSignoff.values()], p.firm.deadlines, clock, nameOf, (seq) => ix.bySeq.get(seq)?.season_at ?? clock),
    acts, actsByRef, amountsHash, identityHash,
  }
}

function addFlag(c: ClaimState | undefined, f: Flag) {
  if (c && !c.flags.includes(f)) c.flags.push(f)
}

/** About n characters for one-line copies. A mask token that straddles the cut is kept whole, so a token is never split. */
export function clip(s: string, n = 80): string {
  if (s.length <= n) return s
  let end = n - 1
  for (const m of s.matchAll(MASK_RE)) {
    const a = m.index!, b = a + m[0].length
    if (a < end && end < b) { end = b; break }
  }
  return end >= s.length ? s : `${s.slice(0, end)}…`
}

function listReason(what: string, ids: string[]): Reason[] {
  if (!ids.length) return []
  const more = ids.length > 3 ? ` and ${ids.length - 3} more` : ''
  return [{ text: `${what}: ${ids.slice(0, 3).join(', ')}${more}`, ref: ids[0], what, refs: ids }]
}

/** Linear estimates are wrong once a summed change crosses an engine threshold. */
function thresholdWarnings(model: Model, live: AdjustView[]): string[] {
  const qty: Record<string, number> = {}
  for (const v of live) {
    const line = model.lines[v.target]
    const from = v.from === null ? 0 : v.from
    if (!line || v.effect.basis !== 'rate' || typeof from !== 'number' || typeof v.to !== 'number') continue
    const spec = effectSpec(line, v.field)
    qty[spec.category] = (qty[spec.category] ?? 0) + (v.to - from) * spec.sign
  }
  const q = (k: string) => qty[k] ?? 0
  const params = model.packet.engine_reference.parameters
  const param = (k: string) => (typeof params[k] === 'number' ? (params[k] as number) : null)
  const lineNum = (k: string) => (typeof model.lines[k]?.value === 'number' ? (model.lines[k].value as number) : null)
  const agi = q('wages') + q('interest') + q('schc_profit') + q('stcg') + q('ltcg') + q('ordinary_income') - q('adjustment')
  const amti = agi - q('itemized') // SALT is added back for AMT
  const tests: [string, number | null, number, number | null][] = [
    ['the SALT cap', lineNum('SchA.5d'), q('salt'), param('salt_cap')],
    ['the child tax credit phase-out', model.packet.return_versions[model.packet.return_versions.length - 1].summary.federal.agi, agi, param('ctc_phaseout_start')],
    ['the AMT exemption', lineNum('F6251.4'), amti, param('amt_exemption')],
    ['the AMT 28% bracket', lineNum('F6251.6'), amti, param('amt_28_start')],
  ]
  return tests
    .filter(([, base, d, t]) => base !== null && t !== null && d !== 0 && base > t !== base + d > t)
    .map(([what, , , t]) => `Linear estimate crosses ${what} (${(t as number).toLocaleString('en-US')}): the engine must recompute.`)
}

/** Inbox `at` is on the season clock (act season_at, deadline dates), so the UI can say "3 days ago" against it. */
function inboxFor(
  viewer: Viewer, notes: NoteView[], live: Act[], signoffs: SignoffView[],
  deadlines: { what: string; date: string }[], clock: string, nameOf: (id: string) => string, seasonAt: (seq: number) => string,
): InboxItem[] {
  const today = clock.slice(0, 10)
  const horizon = new Date(Date.parse(clock) + 14 * 86_400_000).toISOString().slice(0, 10)
  const addressed = (n: NoteView) =>
    n.to === viewer.id || (viewer.kind === 'client' && n.kind === 'question_client' && (!n.to || n.to === 'client'))
  const items: InboxItem[] = []
  for (const n of notes) {
    if (n.open && addressed(n)) {
      items.push({ kind: n.kind.startsWith('question') ? 'question' : 'note', text: `${nameOf(n.actor)}: ${clip(n.text)}`, ref: `act:${n.seq}`, seq: n.seq, at: n.season_at })
    }
    if (n.actor === viewer.id) {
      for (const r of n.replies) if (r.actor !== viewer.id) items.push({ kind: 'reply', text: `${nameOf(r.actor)} replied: ${clip(r.text)}`, ref: `act:${n.seq}`, seq: r.seq, at: seasonAt(r.seq) })
    }
    if (n.open && n.due && (n.actor === viewer.id || addressed(n)) && n.due.slice(0, 10) <= horizon) {
      items.push({ kind: 'deadline', text: `Due ${n.due.slice(0, 10)}: ${clip(n.text)}`, ref: `act:${n.seq}`, seq: n.seq, at: n.due })
    }
  }
  if (viewer.kind === 'staff') {
    for (const a of live) {
      if (a.type === 'assign' && (a.body as Body<'assign'>).assignee === viewer.id) {
        items.push({ kind: 'assign', text: `${nameOf(a.actor)} assigned you ${AREA_LABEL[a.target.slice(5) as AreaKey] ?? a.target}`, ref: a.target, seq: a.seq, at: a.season_at })
      }
    }
    for (const s of signoffs) {
      if (s.actor === viewer.id && !s.valid) {
        items.push({ kind: 'reopened', text: `Your ${s.level} sign-off on ${s.target} reopened (${s.changed.length} changed)`, ref: s.target, seq: s.seq, at: seasonAt(s.seq) })
      }
    }
    for (const d of deadlines) {
      if (d.date >= today && d.date <= horizon) items.push({ kind: 'deadline', text: `${d.what}: ${d.date}`, ref: 'season', at: d.date })
    }
  }
  return items.sort((x, y) => y.at.localeCompare(x.at))
}
