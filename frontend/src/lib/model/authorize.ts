// authorize(model, state, input, actor): the firm rules, enforced. Shared by the browser (to disable
// buttons and say why) and the server (the only enforcer, inside the POST transaction).
import type { Act, ActInput } from './acts'
import type { Model } from './build'
import type { Val } from './claims'
import type { Jurisdiction } from './packet-types'
import { AREAS } from './ids'
import { sameValue } from './mask-token'
import { type Body, RANK, claimsOfRef, indexActs, preparedRefs, revertTargets, scopeOf, seasonInstant, whatIfCites } from './project'
import type { AuthResult, NoteView, Reason, State, Viewer } from './state'
import { identities } from './viewer'

const ok: AuthResult = { ok: true }
const no = (reason: string): AuthResult => ({ ok: false, reason })
const orOk = (reason: string | null): AuthResult => (reason ? no(reason) : ok)
const noClearance = (actor: Viewer) => `${actor.name} has no sensitive-data clearance (firm.staff ${actor.id}).`
const NO_ACTS = new Map<number, Act>()

const LEVELS: Record<string, string[]> = {
  preparer: ['preparer'],
  reviewer: ['preparer', 'reviewer'],
  partner: ['preparer', 'reviewer', 'partner'],
  quality_reviewer: ['quality'],
}
const ADMIN_TYPES = new Set<ActInput['type']>(['assign', 'time', 'clock', 'note', 'reply', 'revert'])
const QUALITY_TYPES = new Set<ActInput['type']>(['note', 'reply', 'resolve', 'signoff', 'time'])
const REVERTABLE = new Set(['verify', 'adjust', 'decide', 'dispose', 'note', 'reply', 'resolve', 'attach', 'assign', 'time', 'signoff', 'request_approval'])
/** Undoing these is itself a change to the filed return, so the freeze applies to their revert. */
const FROZEN_REVERT = new Set(['verify', 'adjust', 'decide', 'dispose', 'resolve', 'signoff', 'request_approval'])
const NEEDS_REF = new Set(['duplicate_of', 'superseded_by', 'applied_to', 'contradicted_by'])
const STEP_REFUSAL = 'Steps are derived; record the work they check instead.'

const show = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : JSON.stringify(v))
const isArea = (t: string) => (AREAS as readonly string[]).includes(t.slice('area:'.length)) && t.startsWith('area:')
const gateText = (what: string, reasons: Reason[]) =>
  `${what}: ${reasons.slice(0, 4).map((r) => r.text).join('; ')}${reasons.length > 4 ? ` (+${reasons.length - 4} more)` : ''}`

export function authorize(model: Model, state: State, input: ActInput, actor: Viewer): AuthResult {
  if (state.clock.slice(0, 10) < actor.active_from) return no(`${actor.name} is active from ${actor.active_from}.`)
  if (actor.kind === 'client') return clientRules(state, input, actor)
  if (input.type === 'client_approve') return no('Only the clients sign the e-file authorization.')
  if (actor.role === 'firm_administrator' && !ADMIN_TYPES.has(input.type)) {
    return no(`${actor.name} is the firm administrator: read-only on return claims (no value changes or sign-offs).`)
  }
  if (actor.role === 'quality_reviewer' && !QUALITY_TYPES.has(input.type)) return no(`${actor.name} is the quality reviewer: no value changes.`)

  const t = input.target
  const claim = model.claims[t]
  const cs = state.claims[t]
  const clearance = () => no(noClearance(actor))
  const notYet = () => no(`${t} is not in the file yet (arrives ${claim.knownAt.slice(0, 10)}).`)

  switch (input.type) {
    case 'verify': {
      if (!claim || !cs) return no(`Unknown claim ${t}.`)
      if (claim.kind === 'step') return no(STEP_REFUSAL)
      if (claim.sensitive && !actor.clearance) return clearance()
      if (claim.knownAt > state.clock) return notYet()
      const { level, method, seen_value } = input.body
      if (!LEVELS[actor.role]?.includes(level)) return no(`A ${actor.role.replace('_', ' ')} cannot verify at ${level} level.`)
      const accept = method === 'accepted_check_tied'
      if (accept && level === 'preparer') return no('Accepting a tied check is a reviewer or partner act.')
      if (accept && cs.openFindings.length) return no(`${t} has open findings; resolve them before accepting.`)
      const frozen = frozenFor(model, state, t)
      if (frozen) return no(frozen)
      if (!sameValue(seen_value, cs.effective)) return no(`${t} is now ${show(cs.effective)}, not ${show(seen_value)}. Reload and verify again.`)
      const bad = findingsRefusal(model, state, input, actor)
      if (bad) return no(bad)
      return level === 'preparer' ? ok : selfReview(model, state, [t], actor)
    }

    case 'adjust': {
      if (!claim || !cs || (claim.kind !== 'line' && claim.kind !== 'fact')) return no(`Only a return line or a household fact can be adjusted; ${t} is neither.`)
      if (claim.sensitive && !actor.clearance) return clearance()
      if (claim.knownAt > state.clock) return notYet()
      const { field, to, what_if } = input.body
      if (claim.kind === 'fact' && field !== 'value') return no('A household fact has only a value to adjust.')
      if (field === 'basis' && claim.form !== 'F8949') return no('Only Form 8949 lots carry a basis to adjust.')
      if (field === 'label' && typeof to !== 'string') return no('A label must be text.')
      if (field !== 'label' && typeof claim.value === 'number' && typeof to !== 'number') return no(`${t} takes a number.`)
      if (field === 'value' && sameValue(to, cs.effective)) return no(`${t} is already ${show(to)}.`)
      const wrongWhatIf = what_if ? whatIfRefusal(model, state, t, field, to, what_if) : null
      if (wrongWhatIf) return no(wrongWhatIf)
      return orOk(frozenFor(model, state, t) ?? findingsRefusal(model, state, input, actor))
    }

    case 'decide':
    case 'dispose': {
      if (claim?.kind === 'step') return no(STEP_REFUSAL)
      if (t.startsWith('act:')) return no(`${t} is an act; judge the claim it targets instead.`)
      if (t.startsWith('chk:') && !model.findingsById[t]) return no(`Unknown finding ${t}.`)
      // A claim, a page of a document, a finding or a required entry (CHK-49 subject); nothing else can be judged.
      if (!model.findingsById[t] && !claimsOfRef(model, NO_ACTS, t).length) return no(`Nothing to ${input.type} at ${t}: pick a claim, a finding or a required entry.`)
      if (claim && claim.knownAt > state.clock) return notYet()
      if (t.startsWith('chk:') && !state.findings[t]?.visible) return no(`${t} is not in the file yet.`)
      if (!actor.clearance && touchesSensitive(model, t)) return clearance()
      if (input.type === 'dispose' && NEEDS_REF.has(input.body.disposition) && !input.body.ref) {
        return no(`A "${input.body.disposition.replaceAll('_', ' ')}" disposition needs the ref it points to.`)
      }
      if (input.type === 'decide' && input.body.what_if && !model.packet.what_if.alternatives.some((a) => a.id === input.body.what_if)) {
        return no(`Unknown what-if ${input.body.what_if}.`)
      }
      // Answering an agency notice is allowed on a filed claim (it changes no return value); listed findings still freeze.
      const notice = input.type === 'decide' && input.body.kind === 'notice_response'
      return orOk(findingsRefusal(model, state, input, actor) ?? (notice ? null : frozenFor(model, state, t)))
    }

    case 'note': {
      const { kind, blocking, to } = input.body
      if (kind === 'review_note' && RANK[actor.role] < RANK.reviewer) return no('Review notes come from a reviewer, partner or quality reviewer; use a memo or a question.')
      if (blocking && kind !== 'review_note') return no('Only a review note can block filing.')
      if (blocking && actor.role === 'quality_reviewer' && state.stage !== 'amending') return no('A quality review note can block only an open amendment.')
      if (to && to !== 'client' && !identities(model.packet).some((v) => v.id === to)) return no(`Unknown recipient ${to}.`)
      return ok
    }

    case 'reply':
      return noteAt(state, t) ? ok : no(`${t} is not a note.`)

    case 'resolve': {
      if (t.startsWith('chk:')) {
        const f = state.findings[t]
        if (!f) return no(`Unknown finding ${t}.`)
        if (!f.visible) return no(`${t} is not in the file yet.`)
        if (actor.role === 'quality_reviewer') return no('The quality reviewer resolves review notes, not findings.')
        if (f.status === 'resolved') return no(`${t} is already resolved.`)
        if (!input.body.authority?.trim()) return no('Resolving a finding needs an authority: the rule, document or standard relied on.')
        if (!actor.clearance && touchesSensitive(model, t)) return clearance()
        return orOk(frozenFor(model, state, t))
      }
      const n = noteAt(state, t)
      if (!n) return no(`${t} is not a note or a finding.`)
      if (n.kind === 'memo') return no('A memo has nothing to resolve.')
      if (!n.open) return no(`${t} is already resolved.`)
      const author = identities(model.packet).find((v) => v.id === n.actor)
      if (n.blocking && actor.id !== n.actor && RANK[actor.role] <= RANK[author?.role ?? 'preparer']) {
        return no(`Only ${author?.name ?? n.actor} or a higher level can clear this blocking review note.`)
      }
      return ok
    }

    case 'attach':
      return ok

    case 'signoff': {
      const { level } = input.body
      if (!LEVELS[actor.role]?.includes(level)) return no(`A ${actor.role.replace('_', ' ')} cannot sign off at ${level} level.`)
      if (t !== 'return' && !isArea(t)) return no(`Unknown area ${t}.`)
      if (level === 'quality') {
        if (!state.filings.some((f) => f.results.some((r) => r.status === 'accepted'))) return no('Quality sign-off comes after an accepted filing.')
      } else {
        const frozen = frozenFor(model, state, 'return')
        if (frozen) return no(frozen)
      }
      return level === 'preparer' ? ok : selfReview(model, state, scopeOf(model, t), actor)
    }

    case 'request_approval': {
      if (actor.role !== 'reviewer' && actor.role !== 'partner') return no('Requesting client approval is a reviewer or partner act.')
      const frozen = frozenFor(model, state, 'return')
      if (frozen) return no(frozen)
      const g = state.gates.request_approval
      return g.ok ? ok : no(gateText('Client approval cannot be requested yet', g.reasons))
    }

    case 'file': {
      if (actor.role !== 'partner') return no('Only the partner (the paid preparer) can file.')
      if (input.body.kind === 'extension') {
        const blocking = state.notes.filter((n) => n.open && n.blocking && n.kind === 'review_note')
        return blocking.length ? no(`Open blocking review notes: ${blocking.map((n) => `act:${n.seq}`).join(', ')}.`) : ok
      }
      const done = input.body.jurisdictions.find((j) => state.frozen[j])
      if (done) return no(`The ${done} return is already filed and accepted; open an amendment.`)
      const g = state.gates.submit
      return g.ok ? ok : no(gateText('The return cannot be filed yet', g.reasons))
    }

    case 'amend_open':
      if (actor.role !== 'partner') return no('Only the partner can open an amendment.')
      return state.frozen.federal || state.frozen.california ? ok : no('Nothing is filed and accepted; there is nothing to amend.')

    case 'revert': {
      const targets = revertTargets(state.acts, t)
      if (!targets.length) return no(`Nothing to revert at ${t}.`)
      const { dead } = indexActs(state.acts)
      for (const a of targets) {
        if (dead.has(a.seq)) return no(`act:${a.seq} is already reverted.`)
        if (!REVERTABLE.has(a.type)) return no(`A ${a.type.replaceAll('_', ' ')} act cannot be reverted.`)
        if (a.actor !== actor.id && RANK[actor.role] <= (RANK[a.actor_role] ?? 0)) {
          return no(`Only ${identities(model.packet).find((v) => v.id === a.actor)?.name ?? a.actor} or a higher level can revert act:${a.seq}.`)
        }
        const frozen = FROZEN_REVERT.has(a.type) ? frozenFor(model, state, a.target) : null
        if (frozen) return no(frozen)
        if (a.type === 'adjust') {
          const { field, what_if } = a.body as Body<'adjust'>
          const later = state.adjusts.find((v) => !v.reverted && v.seq > a.seq && v.target === a.target && v.field === field && !targets.some((x) => x.seq === v.seq))
          if (later) return no(`Revert the later change to ${a.target} (act:${later.seq}) first.`)
          // The first live cite of a what-if carries its engine result; later cites carry zero and would lose it.
          const cite = what_if ? whatIfCites(state, what_if).find((x) => x.seq > a.seq && !targets.some((y) => y.seq === x.seq)) : undefined
          if (cite) return no(`Revert act:${cite.seq} first: it also cites what-if ${what_if}, whose engine result act:${a.seq} carries.`)
        }
      }
      return ok
    }

    case 'assign': {
      if (!['reviewer', 'partner', 'firm_administrator'].includes(actor.role)) return no('Assigning work is a reviewer, partner or administrator act.')
      if (!isArea(t)) return no(`Unknown area ${t}.`)
      const staff = model.packet.firm.staff.some((s) => s.id === input.body.assignee)
      return staff ? ok : no(`Unknown staff member ${input.body.assignee}.`)
    }

    case 'time':
      return isArea(t) ? ok : no(`Unknown area ${t}.`)

    case 'clock': {
      if (actor.role !== 'partner' && actor.role !== 'firm_administrator') return no('Only the partner or the firm administrator moves the season clock.')
      const to = seasonInstant(input.body.to)
      if (!to) return no(`${input.body.to} is not a season date: use YYYY-MM-DD or a UTC time such as 2027-01-04T15:00:00Z.`)
      if (to <= state.clock) return no(`The season clock only moves forward (now ${state.clock.slice(0, 16).replace('T', ' ')}).`)
      return ok
    }
  }
}

/** POST /api/reveal: cleared, active staff only. The server logs the attempt either way. */
export function canReveal(state: State, actor: Viewer): AuthResult {
  if (state.clock.slice(0, 10) < actor.active_from) return no(`${actor.name} is active from ${actor.active_from}.`)
  if (actor.kind === 'client') return no('Sensitive values stay masked in the client portal.')
  return actor.clearance ? ok : no(noClearance(actor))
}

/** A sensitive claim, a finding attached to one, or a ref standing for one. */
function touchesSensitive(model: Model, ref: string): boolean {
  const ids = model.findingsById[ref]?.claims ?? claimsOfRef(model, NO_ACTS, ref)
  return ids.some((id) => model.claims[id]?.sensitive)
}

/**
 * body.findings: an act clears only findings that are visible, about its target (attached to the claim the
 * target stands for, the finding itself, its subject, or its suggested-fix target), not frozen, and within clearance.
 * A required entry stands for its anchor line only to place the act; it is about its own CHK-49 finding, not its siblings'.
 */
function findingsRefusal(model: Model, state: State, input: ActInput, actor: Viewer): string | null {
  const t = input.target
  const entry = !model.claims[t] && !!model.findingsById[`chk:CHK-49:${t}`]
  const targetClaims = entry ? [] : claimsOfRef(model, NO_ACTS, t)
  for (const id of (input.body as { findings?: string[] }).findings ?? []) {
    const f = model.findingsById[id]
    if (!f) return `Unknown finding ${id}.`
    if (!state.findings[id]?.visible) return `${id} is not in the file yet.`
    const about = id === t || id.split(':').slice(2).join(':') === t || f.fix?.target === t || f.claims.some((c) => targetClaims.includes(c))
    if (!about) return `${id} is not about ${t}; address it from ${f.claims[0]}.`
    if (!actor.clearance && touchesSensitive(model, id)) return noClearance(actor)
    const frozen = frozenFor(model, state, id)
    if (frozen) return frozen
  }
  return null
}

/** A cited what-if prices an adjust exactly only when it moves one of its lines from its current value to `to`, once per line. */
function whatIfRefusal(model: Model, state: State, t: string, field: string, to: Val, id: string): string | null {
  const alt = model.packet.what_if.alternatives.find((a) => a.id === id)
  if (!alt) return `Unknown what-if ${id}.`
  const line = alt.changed_lines.find((c) => c.key === t)
  if (!line || field !== 'value') return `What-if ${id} does not change ${t}, so its engine result cannot price this adjustment.`
  if (!sameValue(state.claims[t]?.effective, line.old) || !sameValue(to, line.new)) {
    return `What-if ${id} moves ${t} from ${show(line.old)} to ${show(line.new)}; this adjustment does not.`
  }
  const used = whatIfCites(state, id).find((a) => a.target === t)
  return used ? `What-if ${id} already moved ${t} (act:${used.seq}).` : null
}

function noteAt(state: State, ref: string): NoteView | undefined {
  return state.notes.find((n) => `act:${n.seq}` === ref)
}

/** Clients reply to and upload against questions addressed to them, and approve with their own signature. */
function clientRules(state: State, input: ActInput, actor: Viewer): AuthResult {
  const asked = (ref: string) => {
    const n = noteAt(state, ref)
    return !!n && n.kind === 'question_client' && (!n.to || n.to === actor.id || n.to === 'client')
  }
  switch (input.type) {
    case 'reply':
      return asked(input.target) ? ok : no('You can only reply to questions addressed to you.')
    case 'attach':
      return asked(input.target) && input.body.filed_against.every((r) => r === input.target)
        ? ok
        : no('Upload documents against a question addressed to you.')
    case 'client_approve': {
      const ap = state.approval
      if (state.frozen.federal || state.frozen.california) return no('This return is already filed.')
      if (!ap || input.target !== `act:${ap.request_seq}`) return no('There is no open approval request for this return.')
      if (!ap.current) return no('The amounts changed after approval was requested; the firm must request approval again.')
      if (ap.approvals.some((x) => x.signer === actor.id && x.valid)) return no('You have already approved this return.')
      return ok
    }
    default:
      return no('Clients can only reply to questions, upload documents and approve the return.')
  }
}

/** The refusal text when a value act on `ref` hits a filed and accepted jurisdiction, else null. */
function frozenFor(model: Model, state: State, ref: string): string | null {
  const id = claimsOfRef(model, NO_ACTS, ref)[0]
  const j = id ? model.claims[id]?.jurisdiction : undefined
  const js: Jurisdiction[] = j ? [j] : ['federal', 'california']
  const hit = js.find((x) => state.frozen[x])
  if (!hit) return null
  const filed = [...state.filings].reverse().find((f) => f.kind === 'submit' && f.results.some((r) => r.jurisdiction === hit && r.status === 'accepted'))
  const on = state.acts.find((a) => a.seq === filed?.seq)?.season_at.slice(0, 10) ?? ''
  return `Return filed ${on} (${hit === 'federal' ? 'federal' : 'California'}); open an amendment.`
}

/** No self-review: refused when the actor prepared anything in scope, including packet timeline events. */
function selfReview(model: Model, state: State, scope: string[], actor: Viewer): AuthResult {
  const mine = scope.filter((id) => state.claims[id]?.preparedBy.includes(actor.id))
  if (!mine.length) return ok
  const ref = preparedRefs(model, state.acts)[mine[0]]?.[actor.id] ?? 'act log'
  const more = mine.length > 1 ? ` and ${mine.length - 1} more in scope` : ''
  return no(`You prepared ${mine[0]} (${ref})${more}. Route to another reviewer or the partner.`)
}
