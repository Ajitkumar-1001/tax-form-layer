// Pure half of the Overview (spec §4): where the return is, what blocks filing, the money, the team and the next steps.
// No React here, so vitest runs it in node against buildModel(maskedPacket) + project(...).
import { canOpen } from '@/components/acts/draft'
import { formatMoney, refHref } from '@/components/atoms/format'
import { areaOfRef, claimOf, collapseToRoots, findingOrder, type GroupKey, groupOf, latestSignoffs, myAreas, nextAction, openFindings } from '@/components/queue/queue-model'
import { nextDeadline, type SpectrumPart, spectrum, stageLabel } from '@/components/shell/return-state'
import type { OpenActRequest } from '@/components/workspace/types'
import type { ActInput } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import type { Model } from '@/lib/model/build'
import type { Finding } from '@/lib/model/checks/types'
import type { AreaKey } from '@/lib/model/ids'
import type { Packet } from '@/lib/model/packet-types'
import { roundHours } from '@/lib/model/project'
import type { SignoffView, State, Viewer } from '@/lib/model/state'
import { identities } from '@/lib/model/viewer'

export interface Blocker {
  /** Required step 1..12, or null for a blocking review note. */
  step: number | null
  label: string
  text: string
  /** Context for masked rendering: the reason's ref, or act:<seq> for a note. */
  context: string
  /** Display name(s) of who acts. */
  who: string
  href: string
}

// This name shadows TypeScript's global Pick<T, K> inside this module; spell such types out here instead.
export interface Pick {
  finding: string
  claim: string
  title: string
  fed: number
  ca: number
}

export interface Money {
  errors: { count: number; exposure: { fed: number; ca: number }; net: { fed: number; ca: number }; top: Pick[] }
  unproven: { count: number; exposure: { fed: number; ca: number } }
  choices: number
  adjusted: { fed: number; ca: number }
}

export interface TeamRow {
  key: AreaKey
  label: string
  href: string
  assignee: { id: string; name: string; inactiveUntil: string | null }
  open: number
  signoffs: 'none' | 'prepared' | 'reviewed' | 'partner' | 'changed'
  hours: number
  budget: number | null
  over: boolean
}

export type NextKind =
  | 'checklist' | 'signoff_owed' | 'waiting' | 'partner_adjust' | 'request_approval' | 'return_signoff'
  | 'quality_wait' | 'over_budget' | 'reassign' | 'fresh_copy' | 'inactive' | 'client_portal'

export interface NextItem {
  kind: NextKind
  text: string
  context: string
  href?: string
  request?: OpenActRequest
}

export interface NextSteps {
  top: { what: string; why: string; doneWhen: string; ref: string; request: OpenActRequest | null } | null
  /** How many items the viewer has before the cap; `items` holds at most five of them. */
  total: number
  items: NextItem[]
}

export interface Where {
  steps: { n: number; label: string; ok: boolean }[]
  done: number
  claims: { parts: SpectrumPart[]; total: number }
}

export interface Blockers {
  ok: boolean
  total: number
  items: Blocker[]
  beforeApproval: string | null
}

export interface Overview {
  sentence: string
  where: Where
  blockers: Blockers
  money: Money
  team: TeamRow[]
  next: NextSteps
}

/** Required steps and the claim bar (spec §4.8). The stage and the season already sit in the rail and the top bar. */
export function whereOf(state: State): Where {
  return {
    steps: state.steps.map(({ n, label, ok }) => ({ n, label, ok })),
    done: state.steps.filter((s) => s.ok).length,
    claims: spectrum(state),
  }
}

const NOT_YET_APPROVED = 'Not yet approved by'

/**
 * What blocks filing (spec §4.5): the red steps in order, then the open blocking review notes, so the items match
 * state.gates.submit.reasons one for one. Texts are never clipped (the gate clips notes to about 80 characters).
 */
export function blockersOf(model: Model, state: State): Blockers {
  const people = identities(model.packet)
  const name = (id: string) => people.find((v) => v.id === id)?.name ?? id
  const names = (ids: string[]) => ids.map(name).join(' and ')
  const start = model.packet.firm.assignment_at_start
  const assignee = (ref: string) => {
    const area = areaOfRef(model, ref)
    return area ? state.assignments[area] : undefined
  }
  // Only claims and acts have a page; return, area:<key> and client ids are fixed on Filing.
  const hrefOf = (ref: string) => (claimOf(model, ref) || ref.startsWith('act:') ? refHref(ref) : '/filing#steps')

  const items: Blocker[] = []
  for (const s of state.steps) {
    if (s.ok) continue
    const text = s.reasons[0]?.text ?? 'Not met'
    const ref = s.reasons[0]?.ref ?? `step:${s.n}`
    const who =
      s.n === 10 ? name(start.reviewer)
      : s.n === 11 ? name(start.partner)
      // "Not yet approved by: cu-01, cu-02": the clients who still have to sign.
      : s.n === 12 ? (text.startsWith(NOT_YET_APPROVED) ? names(text.slice(text.indexOf(':') + 1).split(',').map((x) => x.trim())) : name(start.partner))
      : name(assignee(ref) ?? start.preparer)
    items.push({ step: s.n, label: s.label, text, context: ref, who, href: hrefOf(ref) })
  }
  // The gate's own filter (project.ts): Zod allows `blocking` on any note kind, but only review notes block.
  for (const n of state.notes) {
    if (!n.open || !n.blocking || n.kind !== 'review_note') continue
    const ref = `act:${n.seq}`
    items.push({
      step: null, label: `Blocking review note by ${name(n.actor)}`, text: n.text, context: ref,
      who: name(n.to ?? assignee(n.target) ?? start.preparer), href: hrefOf(ref),
    })
  }

  const owed = state.adjusts.filter((v) => !v.reverted && v.needs_partner && !v.partner_covered).length
  const s = owed === 1 ? '' : 's'
  return {
    ok: state.gates.submit.ok,
    total: items.length,
    items,
    beforeApproval: owed ? `Before client approval also: partner sign-off${s} for ${owed} adjustment${s} over $1,000` : null,
  }
}

// ── Money at stake (spec §4.6) ───────────────────────────────────────────────────────────

const stakeSize = (f: Finding) => Math.max(Math.abs(f.stake?.fed ?? 0), Math.abs(f.stake?.ca ?? 0))

/** One finding per primary claim, so a claim with several findings counts once. findingOrder ranks the largest
 * max(|fed|, |ca|) first, then severity, then id. */
function picksOf(list: Finding[]): Finding[] {
  const byClaim = new Map<string, Finding[]>()
  for (const f of list) {
    const k = f.claims[0] ?? f.id
    byClaim.set(k, [...(byClaim.get(k) ?? []), f])
  }
  return [...byClaim.values()].map((fs) => [...fs].sort(findingOrder)[0])
}

const stakeSum = (picks: Finding[], f: (n: number) => number) =>
  picks.reduce((t, p) => ({ fed: t.fed + f(p.stake?.fed ?? 0), ca: t.ca + f(p.stake?.ca ?? 0) }), { fed: 0, ca: 0 })

const toPick = (f: Finding): Pick => ({ finding: f.id, claim: f.claims[0] ?? f.id, title: f.title, fed: f.stake?.fed ?? 0, ca: f.stake?.ca ?? 0 })

/** Errors are proven against evidence, unproven rests on weak support or an unexplained swing, and choices are
 * engine alternatives: counted, never added to money. Blocks and the other decisions are not money. */
export function moneyOf(model: Model, state: State): Money {
  const open = openFindings(model, state)
  const { hidden } = collapseToRoots(model, open)
  const roots = open.filter((f) => !hidden.has(f.id))
  const inGroup = (g: GroupKey) => roots.filter((f) => groupOf(model, f) === g)
  const errors = inGroup('contradicted')
  const weak = inGroup('weak')
  const swings = inGroup('swings')
  const errorPicks = picksOf(errors)
  const unprovenPicks = [...picksOf(weak), ...picksOf(swings)]
  return {
    errors: {
      count: errors.length,
      exposure: stakeSum(errorPicks, Math.abs),
      net: stakeSum(errorPicks, (n) => n),
      top: errorPicks.filter((f) => stakeSize(f) > 0).sort(findingOrder).slice(0, 5).map(toPick),
    },
    unproven: { count: weak.length + swings.length, exposure: stakeSum(unprovenPicks, Math.abs) },
    choices: inGroup('decisions').filter((f) => model.claims[f.claims[0]]?.kind === 'whatif').length,
    adjusted: { fed: state.totals.federal.delta, ca: state.totals.california.delta },
  }
}

// ── Team, next steps, sentence ──────────────────────────────────────────────────────────

type AreaLevel = 'preparer' | 'reviewer' | 'partner'

/** Latest sign-off per level on an area. A reviewer or partner may sign the whole return instead, which covers it. */
function areaSignoffs(latest: SignoffView[], key: AreaKey): Record<AreaLevel, SignoffView | undefined> {
  const at = (target: string, level: AreaLevel) => latest.find((s) => s.target === target && s.level === level)
  return {
    preparer: at(`area:${key}`, 'preparer'),
    reviewer: at(`area:${key}`, 'reviewer') ?? at('return', 'reviewer'),
    partner: at(`area:${key}`, 'partner') ?? at('return', 'partner'),
  }
}

/** authorize() compares active_from with the clock's date, so the dashboard does too. */
const inactiveAt = (state: State, activeFrom: string) => state.clock.slice(0, 10) < activeFrom

export function teamOf(model: Model, state: State): TeamRow[] {
  const people = identities(model.packet)
  const latest = latestSignoffs(state.signoffs)
  return state.areas.map((a): TeamRow => {
    const L = areaSignoffs(latest, a.key)
    const signoffs: TeamRow['signoffs'] = [L.preparer, L.reviewer, L.partner].some((s) => s && !s.valid) ? 'changed'
      : L.partner?.valid ? 'partner'
      : L.reviewer?.valid ? 'reviewed'
      : L.preparer?.valid ? 'prepared'
      : 'none'
    const who = people.find((v) => v.id === a.assignee)
    // The area's hours are already rounded to the hundredth; rounding here too keeps `over` and the item text safe from float noise on any state.
    const hours = roundHours(a.hours)
    return {
      key: a.key, label: a.label, href: `/queue?area=${a.key}&mine=0`,
      assignee: { id: a.assignee, name: who?.name ?? a.assignee, inactiveUntil: who && inactiveAt(state, who.active_from) ? who.active_from : null },
      // Never a.claims: it counts claims the season clock has not brought into the file yet.
      open: a.open, signoffs, hours, budget: a.budget, over: a.budget !== null && hours > a.budget,
    }
  })
}

const NEXT_LIMIT = 5

export function nextOf(model: Model, state: State, viewer: Viewer): NextSteps {
  if (viewer.kind === 'client') return { top: null, total: 1, items: [{ kind: 'client_portal', text: 'Clients use the client portal', context: 'return', href: '/client' }] }
  if (inactiveAt(state, viewer.active_from)) {
    return { top: null, total: 1, items: [{ kind: 'inactive', text: `You are not active until ${viewer.active_from}; your actions are refused until then.`, context: 'return' }] }
  }
  // Judged on the state being summarized (a replayed one too), the way the workspace judges the live one.
  const can = (input: ActInput) => authorize(model, state, input, viewer)
  const latest = latestSignoffs(state.signoffs)
  const n = viewer.role === 'preparer' || viewer.role === 'reviewer' || viewer.role === 'partner' ? nextAction(model, state, viewer) : null
  const top: NextSteps['top'] = n && { what: n.what, why: n.why, doneWhen: n.doneWhen, ref: n.ref, request: n.request ?? null }
  // A request that is still current needs no second one: re-requesting would only restart the clients' approval.
  const approval: NextItem[] = state.gates.request_approval.ok && !state.approval?.current
    ? [{ kind: 'request_approval', text: 'Request client approval', context: 'return', request: { type: 'request_approval', target: 'return' } }]
    : []
  // Repeated rows (one per area, adjustment or document) and the one-off actions. The cap cuts rows only, so a long run of
  // rows can never hide the action that advances the return; the one-offs keep their place at the end of the list.
  const rows: NextItem[] = []
  const once: NextItem[] = []

  if (viewer.role === 'preparer') {
    const mine = myAreas(state, viewer)
    for (const a of state.areas) {
      if (!mine.has(a.key)) continue
      for (const d of a.done) {
        if (!d.ok) rows.push({ kind: 'checklist', text: `${a.label}: ${d.label}`, context: `area:${a.key}`, href: d.ref ? refHref(d.ref) : `/queue?area=${a.key}&mine=0` })
      }
    }
  } else if (viewer.role === 'reviewer') {
    let waiting = 0
    for (const a of state.areas) {
      const L = areaSignoffs(latest, a.key)
      if (!L.preparer?.valid) waiting++
      else if (!L.reviewer?.valid) {
        const request: OpenActRequest = { type: 'signoff', target: `area:${a.key}`, prefill: { level: 'reviewer' } }
        if (canOpen(request, { model, state, can }).auth.ok) rows.push({ kind: 'signoff_owed', text: `Review sign-off owed: ${a.label}`, context: `area:${a.key}`, request })
      }
    }
    if (!rows.length && waiting) rows.push({ kind: 'waiting', text: `Waiting for preparer sign-offs (${waiting} ${waiting === 1 ? 'area' : 'areas'})`, context: 'return' })
    once.push(...approval)
  } else if (viewer.role === 'partner') {
    for (const v of state.adjusts) {
      if (v.reverted || !v.needs_partner || v.partner_covered) continue
      // Signed in place, over the claim's whole area as on the desk; a target with no area takes the whole return (signTargets, filing-logic.ts).
      const area = areaOfRef(model, v.target)
      const request: OpenActRequest = { type: 'signoff', target: area ? `area:${area}` : 'return', prefill: { level: 'partner' } }
      rows.push({
        kind: 'partner_adjust', text: `Partner sign-off needed: ${v.target} (Federal ${formatMoney(v.effect.fed)}, California ${formatMoney(v.effect.ca)})`,
        context: v.target, request,
      })
    }
    once.push(...approval)
    const signed = latest.some((s) => s.target === 'return' && s.level === 'partner' && s.valid)
    if (state.steps.find((s) => s.n === 10)?.ok && !signed) {
      once.push({ kind: 'return_signoff', text: 'Partner sign-off on the return', context: 'return', request: { type: 'signoff', target: 'return', prefill: { level: 'partner' } } })
    }
  } else if (viewer.role === 'quality_reviewer') {
    const accepted = state.filings.some((f) => f.kind === 'submit' && f.results.some((r) => r.status === 'accepted'))
    if (!accepted) rows.push({ kind: 'quality_wait', text: 'Quality review opens after an accepted filing', context: 'return' })
  } else if (viewer.role === 'firm_administrator') {
    const people = identities(model.packet)
    const team = teamOf(model, state)
    for (const r of team) {
      if (r.over) rows.push({ kind: 'over_budget', text: `${r.label} is over budget (${r.hours} of ${r.budget} h)`, context: `area:${r.key}`, href: '/firm#time' })
    }
    for (const r of team) {
      const why = r.assignee.inactiveUntil ? `is not active until ${r.assignee.inactiveUntil}`
        : people.find((v) => v.id === r.assignee.id)?.role !== 'preparer' ? 'is not a preparer'
        : null
      if (why) rows.push({ kind: 'reassign', text: `Reassign ${r.label}: ${r.assignee.name} ${why}`, context: `area:${r.key}`, request: { type: 'assign', target: `area:${r.key}` } })
    }
    once.push({ kind: 'fresh_copy', text: 'Start a fresh copy', context: 'return', href: '/firm#engagements' })
  }
  const items = [...rows.slice(0, Math.max(0, NEXT_LIMIT - once.length)), ...once]
  return { top, total: rows.length + once.length, items }
}

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const wholeDollars = (n: number) => `$${formatMoney(Math.round(Math.abs(n)))}`

export function sentenceOf(packet: Packet, state: State, where: Where, blockers: Blockers, money: Money): string {
  const n = blockers.total
  const gate = blockers.ok ? 'every filing gate passes' : `${n} ${n === 1 ? 'reason blocks' : 'reasons block'} filing`
  const due = nextDeadline(packet, state.clock)
  const days = due
    ? `; ${due.daysLeft} ${due.daysLeft === 1 ? 'day' : 'days'} to the ${/extended/i.test(due.what) ? 'extended' : 'original'} due date (${monthDay.format(due.at)})`
    : '; past the extended due date'
  const stake = money.errors.count > 0 ? `; ${wholeDollars(money.errors.exposure.fed)} federal and ${wholeDollars(money.errors.exposure.ca)} California at stake in errors` : ''
  return `${stageLabel(state.stage)}. ${where.done} of ${where.steps.length} required steps done; ${gate}${days}${stake}.`
}

export function summarize(model: Model, state: State, viewer: Viewer): Overview {
  const where = whereOf(state)
  const blockers = blockersOf(model, state)
  const money = moneyOf(model, state)
  return {
    sentence: sentenceOf(model.packet, state, where, blockers, money),
    where, blockers, money, team: teamOf(model, state), next: nextOf(model, state, viewer),
  }
}
