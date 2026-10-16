'use client'
// The highlight: a ring drawn around the stop's anchor, following it as the page scrolls, resizes and re-renders. It is only
// ever a picture (pointer-events none), so the page underneath is never blocked. From lg only: below it the docked card
// stands alone. z-44: above the sticky header (z-40) so it can ring a top-bar control, below dialogs (z-50).
import { useEffect, useState } from 'react'
import { findAnchor } from './resolve'

interface Box {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 6
const WIDE = '(min-width: 64rem)'
const HEADER = 72 // the sticky header (56 px from lg) and some air
const SETTLE_MS = 1500 // how long after a stop appears the ring may still scroll its anchor into view

function same(a: Box | null, b: Box | null): boolean {
  return a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)
}

// Brings the anchor into the middle of the window; one taller than the window, to just under the sticky header. scrollIntoView
// scrolls nested scrollers too. A stop's page can still be laying out when its anchor first appears, so the caller keeps
// calling this for a moment: it does nothing once the anchor is in view.
function bringIntoView(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const tall = r.height > innerHeight - HEADER * 2
  if (tall ? r.top >= HEADER - 1 && r.top < innerHeight / 2 : r.top >= HEADER && r.bottom <= innerHeight - 24) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: reduce || tall ? 'auto' : 'smooth' })
  if (tall) scrollBy(0, -HEADER)
}

// Measures on the next frame, never in the effect body: the anchor may mount late (screens load after the shell), so the
// observer keeps looking until it is there, and keeps following it after.
function useAnchorBox(selector: string | undefined, stopId: string): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    if (!selector) return
    let frame = 0
    let alive = true
    const born = performance.now()
    const measure = () => {
      frame = 0
      if (!alive) return
      const el = matchMedia(WIDE).matches ? findAnchor(selector) : null
      if (!el) {
        setBox((prev) => (prev === null ? prev : null))
        return
      }
      if (performance.now() - born < SETTLE_MS) bringIntoView(el)
      const r = el.getBoundingClientRect()
      const next = { top: r.top, left: r.left, width: r.width, height: r.height }
      setBox((prev) => (same(prev, next) ? prev : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const watcher = new MutationObserver(schedule)
    watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] })
    addEventListener('scroll', schedule, true) // capture: scrolling containers too
    addEventListener('resize', schedule)
    schedule()
    return () => {
      alive = false
      watcher.disconnect()
      removeEventListener('scroll', schedule, true)
      removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [selector, stopId])
  return selector ? box : null
}

export function TourRing({ selector, stopId }: { selector?: string; stopId: string }) {
  const box = useAnchorBox(selector, stopId)
  if (!box) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[44] rounded-xl print:hidden"
      style={{
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
        boxShadow: '0 0 0 2px var(--background), 0 0 0 5px var(--ring)',
      }}
    />
  )
}
