'use client'
// Magic UI "Border Beam": a short gradient that travels the border of its (relatively positioned) parent. Colours and the
// path come from props; `rounded-[inherit]` follows the parent's corners. Callers gate it on prefers-reduced-motion.
import { motion, type MotionStyle, type Transition } from 'motion/react'
import { cn } from '@/lib/utils'

interface BorderBeamProps {
  /** Length of the beam in px. */
  size?: number
  /** Seconds for one lap. */
  duration?: number
  /** Seconds to hold back the start. */
  delay?: number
  colorFrom?: string
  colorTo?: string
  transition?: Transition
  className?: string
  style?: React.CSSProperties
  reverse?: boolean
  /** Starting position on the path, 0-100. */
  initialOffset?: number
  borderWidth?: number
}

export function BorderBeam({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = 'var(--ring)',
  colorTo = 'var(--primary)',
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ '--border-beam-width': `${borderWidth}px` } as React.CSSProperties}
    >
      <motion.div
        className={cn('absolute aspect-square', 'bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent', className)}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            '--color-from': colorFrom,
            '--color-to': colorTo,
            ...style,
          } as MotionStyle
        }
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{ offsetDistance: reverse ? [`${100 - initialOffset}%`, `${-initialOffset}%`] : [`${initialOffset}%`, `${100 + initialOffset}%`] }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay, ...transition }}
      />
    </div>
  )
}
