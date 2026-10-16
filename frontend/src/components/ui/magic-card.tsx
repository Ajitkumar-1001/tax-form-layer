'use client'
// Magic UI "Magic Card", trimmed: only the pointer-following border and wash (no orb mode, so no next-themes), in the
// pen-blue ramp. Square corners follow the parent (`rounded-[inherit]`); the fill is the page background.
import { type PointerEvent, type ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue, type MotionStyle } from 'motion/react'
import { cn } from '@/lib/utils'

interface MagicCardProps {
  children?: ReactNode
  className?: string
  /** Radius of the light that follows the pointer, in px. */
  size?: number
  /** Border light: centre colour, then edge colour. */
  from?: string
  to?: string
  /** Wash under the pointer (a pen-blue ramp value, not a signal colour), and how strong. */
  wash?: string
  washOpacity?: number
}

export function MagicCard({
  children,
  className,
  size = 220,
  from = 'var(--ring)',
  to = 'var(--primary)',
  wash = 'var(--chart-1)',
  washOpacity = 0.45,
}: MagicCardProps) {
  const x = useMotionValue(-size)
  const y = useMotionValue(-size)

  function move(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    x.set(e.clientX - r.left)
    y.set(e.clientY - r.top)
  }
  function leave() {
    x.set(-size)
    y.set(-size)
  }

  const border = useMotionTemplate`linear-gradient(var(--color-background) 0 0) padding-box, radial-gradient(${size}px circle at ${x}px ${y}px, ${from}, ${to}, var(--color-border) 100%) border-box`
  const light = useMotionTemplate`radial-gradient(${size}px circle at ${x}px ${y}px, ${wash}, transparent 100%)`

  return (
    <motion.div
      className={cn('group relative isolate overflow-hidden rounded-[inherit] border border-transparent', className)}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ background: border }}
    >
      <div className="absolute inset-px rounded-[inherit] bg-background" />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-px rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-(--wash-opacity)"
        style={{ background: light, '--wash-opacity': washOpacity } as MotionStyle}
      />
      <div className="relative">{children}</div>
    </motion.div>
  )
}
