'use client'
// Aceternity "Background Beams", adapted: 17 curves instead of 50 (each animated gradient is main-thread work), timings from
// a fixed sequence instead of Math.random() (render stays pure and identical on every mount), the pen-blue ramp in place of
// the stock cyan-to-purple, animation only while on screen, and a static drawing under prefers-reduced-motion.
// Colour comes from `currentColor` for the hairlines and the chart ramp (globals.css) for the moving gradient.
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

/** Curve i: the stock curve shifted 7 right and 8 up per step. */
const curve = (i: number) => {
  const p = (x: number, y: number) => `${x + 7 * i} ${y - 8 * i}`
  return `M${p(-380, -189)}C${p(-380, -189)} ${p(-312, 216)} ${p(152, 343)}C${p(616, 470)} ${p(684, 875)} ${p(684, 875)}`
}
const PATHS = Array.from({ length: 17 }, (_, n) => curve(n * 3))

/** 0..1, evenly spread and stable: stands in for Math.random(). */
const frac = (n: number) => (n * 0.6180339887) % 1

export function BackgroundBeams({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const reduce = useReducedMotion()

  // Own observer rather than motion's useInView: that hook keeps `true` after the route is hidden and shown again (<Activity>),
  // and would run all 17 gradients off-screen. A fresh observer always reports the current state in its first callback.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const live = visible && !reduce

  return (
    <div ref={ref} aria-hidden="true" className={cn('pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center', className)}>
      <svg className="absolute h-full w-full" width="100%" height="100%" viewBox="0 0 696 316" fill="none" preserveAspectRatio="xMidYMid slice">
        <path d={PATHS.join('')} stroke="currentColor" strokeOpacity={reduce ? 0.2 : 0.11} strokeWidth="0.6" />
        {live && (
          <>
            {PATHS.map((d, i) => (
              <path key={i} d={d} stroke={`url(#beam-${i})`} strokeOpacity="0.95" strokeWidth="0.9" />
            ))}
            <defs>
              {PATHS.map((_, i) => (
                <motion.linearGradient
                  key={i}
                  id={`beam-${i}`}
                  initial={{ x1: '0%', x2: '0%', y1: '0%', y2: '0%' }}
                  animate={{ x1: ['0%', '100%'], x2: ['0%', '95%'], y1: ['0%', '100%'], y2: ['0%', `${93 + frac(i + 3) * 8}%`] }}
                  transition={{ duration: 14 + frac(i + 1) * 10, ease: 'easeInOut', repeat: Infinity, delay: frac(i + 7) * 10 }}
                >
                  <stop style={{ stopColor: 'var(--chart-2)' }} stopOpacity="0" />
                  <stop style={{ stopColor: 'var(--chart-1)' }} />
                  <stop offset="32.5%" style={{ stopColor: 'var(--chart-3)' }} />
                  <stop offset="100%" style={{ stopColor: 'var(--chart-4)' }} stopOpacity="0" />
                </motion.linearGradient>
              ))}
            </defs>
          </>
        )}
      </svg>
    </div>
  )
}
