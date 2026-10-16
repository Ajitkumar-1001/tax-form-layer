// The tour's progress in the browser: localStorage `wp:tour` (a per-browser convenience, like wp:rail and wp:learn), shared
// with React through useSyncExternalStore (tour-host.tsx). The snapshot is the raw text, a stable primitive; parseTour
// (machine.ts) turns it into state in render.
import { skipTour, startTour, type TourStored } from './machine'

const KEY = 'wp:tour'
const listeners = new Set<() => void>()
// What THIS page view last wrote: undefined until the visitor (or a ?tour link) has touched the tour. It also keeps a tour
// working in a browser that refuses storage (private mode, blocked site data).
let held: string | null | undefined

function readStorage(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function writeStorage(raw: string): void {
  try {
    localStorage.setItem(KEY, raw)
  } catch {
    // storage unavailable: the tour's place lasts for this page view only
  }
}

/** The stored text, or null when nothing is stored. */
export function readTourRaw(): string | null {
  return held !== undefined ? held : readStorage()
}

/** Whether this page view has touched the tour. Until then a stored, running tour is only offered back (machine.ts). */
export function readTourEngaged(): boolean {
  return held !== undefined
}

export function subscribeTour(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function writeTour(next: TourStored): void {
  held = JSON.stringify(next)
  writeStorage(held)
  for (const l of listeners) l()
}

/** Start the tour from anywhere (the command palette, a button): the host navigates to the first stop. With no host listening
 *  (its code did not load, or it failed) nothing happens: writing would only make the next page view offer a tour nobody saw. */
export function openTour(): void {
  if (listeners.size === 0) return
  writeTour(startTour())
}

/** Turn the tour off for this browser (?tour=0). */
export function closeTour(): void {
  writeTour(skipTour())
}

/** Tests only: forget this page view's copy of the stored text. */
export function resetTourMemory(): void {
  held = undefined
}
