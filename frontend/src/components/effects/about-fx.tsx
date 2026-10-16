'use client'
// The three decorative layers of /about, each sized and coloured for its place (pen-blue ramp only, never a signal colour).
// They are purely visual: aria-hidden, no pointer events, nothing in them is content. The page loads them through
// about-effects.tsx, so this file arrives after the text (`motion` itself is already in the page's chunk: the ticker and the
// cards use it).
import { useReducedMotion } from 'motion/react'
import { AnimatedGridPattern } from './animated-grid-pattern'
import { BackgroundBeams } from './background-beams'
import { BorderBeam } from './border-beam'

/** A faint grid with a few squares that breathe, fading out from the upper right behind the headline. */
export function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-160 max-h-full">
      <AnimatedGridPattern
        width={56}
        height={56}
        numSquares={12}
        maxOpacity={0.14}
        duration={6}
        className="text-primary [mask-image:radial-gradient(ellipse_75%_85%_at_72%_28%,white,transparent_85%)]"
      />
    </div>
  )
}

/** One pen-blue beam lapping the border of the ledger demo (a square frame, so a square path). The beam's box is wider than
 *  the lit ring and swings past the frame's edge each lap; a mask hides that but does not stop it widening the page (it
 *  scrolled sideways on phones), so the wrapper clips it to the frame. */
export function ChainBeam() {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <BorderBeam size={140} duration={9} borderWidth={2} colorFrom="var(--ring)" colorTo="var(--primary)" style={{ offsetPath: 'rect(0 auto auto 0)' }} />
    </div>
  )
}

/** Thin curves with light travelling along them, on the dark "Data model" band. */
export function ModelBackdrop() {
  return <BackgroundBeams className="-z-10 text-background" />
}
