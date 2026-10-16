// The tour's state, as pure functions: what is remembered, what that means (a phase), and how Back, Next and Skip move it.
// No storage and no React here (store.ts and tour-host.tsx do those), so every rule is unit-tested.
import { z } from 'zod'
import { END, STEPS, type TourStep } from './steps'

/** What is remembered: whether the welcome card has been dealt with, and where a running tour is (END: the closing card). */
export interface TourStored {
  seen: boolean
  step: string | null
}

export const FRESH: TourStored = { seen: false, step: null }

const StoredZ = z.object({ seen: z.boolean(), step: z.string().nullable() })

// try/catch lives in its own function, as in provider.tsx: the React compiler cannot lower it inside a component.
function json(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** The stored text as state. Anything missing or unreadable is a first visit. */
export function parseTour(raw: string | null): TourStored {
  if (raw === null) return FRESH
  const parsed = StoredZ.safeParse(json(raw))
  return parsed.success ? parsed.data : FRESH
}

export type Phase =
  | { kind: 'off' }
  | { kind: 'welcome' }
  | { kind: 'resume'; index: number; step: TourStep }
  | { kind: 'step'; index: number; step: TourStep }
  | { kind: 'end' }

// An id this build does not know (a stop removed since the visitor started) resumes at the first stop.
function indexOf(id: string): number {
  const i = STEPS.findIndex((s) => s.id === id)
  return i < 0 ? 0 : i
}

/**
 * What to show. `engaged` is whether the visitor has touched the tour in THIS page view (store.ts). A tour that was running
 * when an earlier page view ended is only offered back ('resume'): it never resumes, takes anyone to another page, or
 * guards a write by itself.
 */
export function phaseOf(s: TourStored, engaged: boolean): Phase {
  if (s.step === null) return s.seen ? { kind: 'off' } : { kind: 'welcome' }
  if (!engaged) {
    if (s.step === END) return { kind: 'off' }
    const index = indexOf(s.step)
    return { kind: 'resume', index, step: STEPS[index] }
  }
  if (s.step === END) return { kind: 'end' }
  const index = indexOf(s.step)
  return { kind: 'step', index, step: STEPS[index] }
}

export const startTour = (): TourStored => ({ seen: true, step: STEPS[0].id })
export const skipTour = (): TourStored => ({ seen: true, step: null })

/** The next stop; after the last, the closing card. Outside a running tour, nothing moves. */
export function nextTour(s: TourStored): TourStored {
  const p = phaseOf(s, true)
  if (p.kind !== 'step') return s
  return { seen: true, step: p.index + 1 < STEPS.length ? STEPS[p.index + 1].id : END }
}

/** The previous stop; from the closing card, the last stop. The first stop stays put. */
export function backTour(s: TourStored): TourStored {
  const p = phaseOf(s, true)
  if (p.kind === 'end') return { seen: true, step: STEPS[STEPS.length - 1].id }
  if (p.kind !== 'step' || p.index === 0) return s
  return { seen: true, step: STEPS[p.index - 1].id }
}
