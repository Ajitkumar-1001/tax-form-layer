'use client'
// The highlight: a ring drawn around the stop's anchor, following it as the page scrolls, resizes and re-renders. It is only
// ever a picture (pointer-events none), so the page underneath is never blocked. Drawn from lg only: below it the docked card
// stands alone (the page is still scrolled to the stop's subject). z-44: above the sticky header (z-40) so it can ring a top-bar
// control, below the card (z-45) and dialogs (z-50). In forced colors a box shadow vanishes, so the ring is an outline there.
//
// It writes its box into its own element's style from the measuring frame (no React state): it then follows in the same frame
// as the page, and its own style changes are not mistaken for the page changing.
import { useEffect, useRef } from 'react'
import { decodePath, routeOf } from './machine'
import { clearBand, findAnchor, scrollDelta } from './resolve'

const PAD = 6
const WIDE = '(min-width: 64rem)'
const SETTLE_MS = 1500 // how long after the anchor first appears the page may still be scrolled to it
const CARD = 'section[role="dialog"][aria-labelledby="tour-title"]'

// Scrolls the page so the stop's subject is clear of the sticky header and of the card (resolve.ts decides how far). A stop's
// page can still be laying out when its anchor first appears, so the caller keeps calling this for a moment: it does nothing
// once the anchor is in place.
function bringIntoView(el: HTMLElement): void {
  if (el.closest('header.sticky')) return // the header never scrolls
  const r = el.getBoundingClientRect()
  const header = document.querySelector('header.sticky')
  const card = document.querySelector(CARD)?.getBoundingClientRect() ?? null
  const band = clearBand({ headerBottom: header ? header.getBoundingClientRect().bottom : 0, height: innerHeight }, r, card)
  const delta = scrollDelta(r, band)
  if (delta === 0) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const tall = r.height > Math.max(band.bottom - band.top, 120)
  scrollBy({ top: delta, behavior: reduce || tall ? 'auto' : 'smooth' })
}

export function TourRing({ selector, href }: { selector?: string; href: string }) {
  const ring = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ring.current
    if (!node || !selector) return
    let frame = 0
    let alive = true
    let appeared = 0
    // Measures on the next frame, never in the effect body: the anchor may mount late (screens load after the shell), so the
    // observer keeps looking until it is there, and keeps following it after.
    const measure = () => {
      frame = 0
      if (!alive) return
      // Only on the stop's own page: earlier pages stay mounted (hidden), and a page being left can hold a look-alike.
      const el = decodePath(location.pathname) === routeOf(href) ? findAnchor(selector) : null
      if (!el) {
        node.style.display = ''
        return
      }
      if (!appeared) appeared = performance.now()
      if (performance.now() - appeared < SETTLE_MS) bringIntoView(el)
      if (!matchMedia(WIDE).matches) {
        node.style.display = ''
        return
      }
      const r = el.getBoundingClientRect()
      node.style.display = 'block'
      node.style.top = `${r.top - PAD}px`
      node.style.left = `${r.left - PAD}px`
      node.style.width = `${r.width + PAD * 2}px`
      node.style.height = `${r.height + PAD * 2}px`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const watcher = new MutationObserver((records) => {
      if (records.some((rec) => rec.target !== node)) schedule()
    })
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
      node.style.display = ''
    }
  }, [selector, href])
  return (
    <div
      ref={ring}
      aria-hidden
      className="pointer-events-none fixed z-44 hidden rounded-xl forced-colors:outline-3 forced-colors:outline-[color:Highlight] print:hidden"
      style={{ boxShadow: '0 0 0 2px var(--background), 0 0 0 5px var(--ring)' }}
    />
  )
}
