// Pure helpers for the client copy of the act log.
import type { Act, ActInput, ActType } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import type { Model } from '@/lib/model/build'
import { AREA_LABEL, type AreaKey } from '@/lib/model/ids'
import { project } from '@/lib/model/project'
import type { Viewer } from '@/lib/model/state'

/** Merge acts by seq (sorted, deduped). Returns `prev` itself when nothing is new, so state stays referentially stable. */
export function mergeActs(prev: Act[], add: Act[]): Act[] {
  if (!add.length) return prev
  const have = new Set(prev.map((a) => a.seq))
  const fresh = add.filter((a) => !have.has(a.seq))
  if (!fresh.length) return prev
  return [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
}

// Undo would be wrong or meaningless for these: the clock only moves forward, a filing went to an agency,
// a revert of a revert is a redo, and views and agency results are records, not changes.
const NO_UNDO = new Set<ActType>(['revert', 'clock', 'file', 'view_sensitive', 'agency_result'])

/** Revert targets that undo a posted batch: `batch:<id>` when the server grouped it, else each `act:<seq>`. */
export function undoTargets(acts: Act[]): string[] {
  const own = acts.filter((a) => !NO_UNDO.has(a.type))
  if (!own.length) return []
  const batch = own.find((a) => a.batch_id)?.batch_id
  return batch ? [`batch:${batch}`] : own.map((a) => `act:${a.seq}`)
}

export const undoInput = (target: string): ActInput => ({ type: 'revert', target, body: { reason: 'Undone from the confirmation toast' } })

/**
 * The undo targets this viewer may actually revert, judged by the shared firm rules on the log as it stands
 * after the post (clients, the quality reviewer, amendment openings and client approvals never can).
 * `held` is the log before the post; the current State cannot be used because it lacks the posted acts.
 */
export function offerUndo(model: Model, held: Act[], posted: Act[], viewer: Viewer, engagement: string): string[] {
  const targets = undoTargets(posted)
  if (!targets.length) return []
  try {
    const state = project(model, mergeActs(held, posted), viewer, engagement)
    return targets.filter((target) => authorize(model, state, undoInput(target), viewer).ok)
  } catch {
    return [] // no Undo is safer than one the server would refuse
  }
}

export const VERB: Record<ActType, string> = {
  verify: 'Verified', adjust: 'Adjusted', decide: 'Decision recorded', dispose: 'Disposed', note: 'Note added',
  reply: 'Replied', resolve: 'Resolved', attach: 'Attached', signoff: 'Signed off', request_approval: 'Approval requested',
  client_approve: 'Approved', file: 'Filed', amend_open: 'Amendment opened', revert: 'Reverted', assign: 'Assigned',
  time: 'Time logged', clock: 'Clock moved', view_sensitive: 'Viewed', agency_result: 'Agency result',
}

/**
 * An act's target in plain words (spec §6): `area:<key>` is the area's label, `act:<n>` is "change n", a batch is
 * "a group of changes", `return` is "the return", and the season clock's target is empty (its verb says it all).
 * Claim, document and finding ids pass through: they are the app's own words everywhere, and may hold mask tokens.
 */
export function targetText(target: string): string {
  if (target === 'return') return 'the return'
  if (target === 'season') return ''
  if (target.startsWith('area:')) {
    const key = target.slice(5)
    return AREA_LABEL[key as AreaKey] ?? key.replaceAll('_', ' ')
  }
  if (/^act:\d+$/.test(target)) return `change ${target.slice(4)}`
  if (target.startsWith('batch:')) return 'a group of changes'
  return target
}

/** Who did an act: the identity's name, "System" for simulated agency results, else the raw id. */
export function actorName(identities: Viewer[], id: string): string {
  return identities.find((v) => v.id === id)?.name ?? (id === 'system' ? 'System' : id)
}

/** Toast text for a posted batch. System acts (simulated agency results) are not the user's. */
export function describeActs(acts: Act[]): string {
  const own = acts.filter((a) => a.actor !== 'system')
  if (own.length === 1) return `${VERB[own[0].type]} · ${own[0].target}`
  return own.length ? `${own.length} acts recorded` : 'Recorded'
}

const seenKey = (engagement: string, viewer: string) => `wp:seen:${engagement}:${viewer}`

/** "Since I last looked" seq for this viewer; 0 when storage is unavailable (private mode, server). */
export function readSeen(engagement: string, viewer: string): number {
  try {
    return Number(localStorage.getItem(seenKey(engagement, viewer))) || 0
  } catch {
    return 0
  }
}

export function writeSeen(engagement: string, viewer: string, seq: number): void {
  try {
    localStorage.setItem(seenKey(engagement, viewer), String(seq))
  } catch {
    // storage unavailable: the marker lasts for this page view only
  }
}
