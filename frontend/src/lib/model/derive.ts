// Server-computed act fields (`derived`): tax effects, partner routing, sign-off fingerprints,
// approval/filing hashes. Client-sent values for these are never trusted.
// Called with the state *before* the act; in a batch, re-project after each act.
import type { ActInput, AdjustDerived, ApprovalDerived, FileDerived, SignoffDerived } from './acts'
import type { Model } from './build'
import type { Val } from './claims'
import { type AdjustField, type Effect, computeEffect, needsPartner, whatIfEffect } from './effects'
import { hash } from './hash'
import { evidenceOf, fingerprintOf, scopeOf, whatIfCites } from './project'
import type { State } from './state'

const NO_EFFECT: Effect = { fed: 0, ca: 0, basis: 'none', category: 'none' }
const LATER_CITE: Effect = { fed: 0, ca: 0, basis: 'what_if', category: 'none' }

/** The value as delivered: the packet value, the line label, or the basis as read. */
function delivered(model: Model, target: string, field: AdjustField): Val {
  const line = model.lines[target]
  if (field === 'value') return model.claims[target]?.value ?? null
  if (field === 'label') return line?.label ?? model.claims[target]?.label ?? null
  return line?.sources.map((s) => model.ev[s]).find((e) => e?.field.endsWith('_basis'))?.value ?? null
}

/** The value an adjust of `field` moves away from: the effective value, the last basis/label, or as delivered. */
function adjustFrom(model: Model, state: State, target: string, field: AdjustField): Val {
  if (field === 'value') return state.claims[target]?.effective ?? null
  const last = state.adjusts.filter((v) => !v.reverted && v.target === target && v.field === field).at(-1)
  return last ? last.to : delivered(model, target, field)
}

export function deriveFor(model: Model, state: State, input: ActInput): Record<string, unknown> {
  switch (input.type) {
    case 'adjust': {
      const { field, to, what_if } = input.body
      const from = adjustFrom(model, state, input.target, field)
      const line = model.lines[input.target]
      const effectFrom = (v: Val) =>
        line && typeof to === 'number' && (typeof v === 'number' || v === null) ? computeEffect(model.packet, line, field, v ?? 0, to) : NO_EFFECT
      // A what-if's exact engine result rides on its first live cite; later cites (its other lines) carry zero.
      const cited = what_if && (whatIfCites(state, what_if).length ? LATER_CITE : whatIfEffect(model.packet, what_if))
      const effect = cited || effectFrom(from)
      // Partner threshold on the running total: from the value as delivered, so small steps cannot avoid the partner.
      const total = cited ? effect : effectFrom(delivered(model, input.target, field))
      const d: AdjustDerived = { from, effect, needs_partner: needsPartner(effect) || needsPartner(total), amendment: state.amendment }
      return { ...d }
    }
    case 'verify':
      return { support_hash: hash(evidenceOf(model, state.acts, input.target)) }
    case 'decide': {
      const effect = input.body.what_if ? whatIfEffect(model.packet, input.body.what_if) : null
      return effect ? { effect } : {}
    }
    case 'signoff': {
      const scope = scopeOf(model, input.target)
      const inScope = new Set(scope)
      const d: SignoffDerived = {
        fingerprint: fingerprintOf(state.claims, scope),
        claim_hashes: Object.fromEntries(scope.map((id) => [id, state.claims[id]?.hash.slice(0, 8) ?? ''])),
        scope,
        covered_adjusts: state.adjusts.filter((v) => !v.reverted && inScope.has(v.target)).map((v) => v.seq),
      }
      return { ...d }
    }
    case 'request_approval': {
      const d: ApprovalDerived = {
        amounts_hash: state.amountsHash,
        identity_hash: state.identityHash,
        summary: { federal_balance: state.totals.federal.balance_estimate, california_balance: state.totals.california.balance_estimate },
      }
      return { ...d }
    }
    case 'client_approve':
      return { amounts_hash: state.amountsHash }
    case 'file': {
      const d: FileDerived = { amounts_hash: state.amountsHash, identity_hash: state.identityHash, head_seq: state.head }
      return { ...d }
    }
    default:
      return {}
  }
}
