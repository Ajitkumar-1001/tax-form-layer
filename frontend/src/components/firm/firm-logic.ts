// Pure half of the firm page (spec §3.9): the sensitive-data view log and time against budget.
import type { ViewSensitiveBody } from '@/lib/model/acts'
import { AREA_LABEL, AREAS, type AreaKey } from '@/lib/model/ids'
import { indexActs } from '@/lib/model/project'
import type { State } from '@/lib/model/state'

export interface ViewLogRow {
  seq: number
  actor: string
  kind: string
  context: string
  granted: boolean
  reason?: string
  recorded_at: string
  season_at: string
}

/** Every reveal attempt, granted or denied, newest first. */
export function viewLogRows(state: State): ViewLogRow[] {
  return state.viewLog
    .map((a) => {
      const b = a.body as Partial<ViewSensitiveBody>
      return {
        seq: a.seq, actor: a.actor, kind: b.kind ?? 'sensitive', context: b.context ?? a.target, granted: !b.denied,
        ...(b.reason && { reason: b.reason }), recorded_at: a.recorded_at, season_at: a.season_at,
      }
    })
    .reverse()
}

export interface PersonTime {
  actor: string
  hours: Partial<Record<AreaKey, number>>
  total: number
}

/** Logged hours (live `time` acts only) per person and area. */
export function timeByPerson(state: State): PersonTime[] {
  const out = new Map<string, PersonTime>()
  for (const a of indexActs(state.acts).live) {
    if (a.type !== 'time') continue
    const area = a.target.slice('area:'.length) as AreaKey
    const hours = Number((a.body as { hours?: unknown }).hours) || 0
    const p = out.get(a.actor) ?? { actor: a.actor, hours: {}, total: 0 }
    p.hours[area] = (p.hours[area] ?? 0) + hours
    p.total += hours
    out.set(a.actor, p)
  }
  return [...out.values()].sort((x, y) => y.total - x.total)
}

/** Budget lines that are not review areas (e.g. partner_review): shown, but time cannot be logged against them. */
export function budgetOnly(budget: Record<string, number>): { key: string; label: string; hours: number }[] {
  return Object.entries(budget)
    .filter(([k]) => !(AREAS as readonly string[]).includes(k))
    .map(([key, hours]) => ({ key, label: key.replaceAll('_', ' '), hours }))
}

/** Hours for display, to 2 decimals (0.1 + 0.2 shows as 0.3). */
export const hours = (n: number): number => Math.round(n * 100) / 100

export const areaName = (key: string): string => AREA_LABEL[key as AreaKey] ?? key.replaceAll('_', ' ')
