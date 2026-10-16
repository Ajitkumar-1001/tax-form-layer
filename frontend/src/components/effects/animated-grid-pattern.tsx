'use client'
// Magic UI "Animated Grid Pattern", adapted: squares are placed from the ResizeObserver callback (not by an effect that
// sets state), and nothing moves under prefers-reduced-motion (the plain grid stays).
import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

interface AnimatedGridPatternProps extends ComponentPropsWithoutRef<'svg'> {
  width?: number
  height?: number
  x?: number
  y?: number
  strokeDasharray?: number
  numSquares?: number
  maxOpacity?: number
  duration?: number
  repeatDelay?: number
}

type Square = { id: number; pos: [number, number]; iteration: number }

/** A random grid cell inside a w × h box of cw × ch cells. */
const cell = (w: number, h: number, cw: number, ch: number): [number, number] => [
  Math.floor((Math.random() * w) / cw),
  Math.floor((Math.random() * h) / ch),
]

export function AnimatedGridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = 0,
  numSquares = 50,
  maxOpacity = 0.5,
  duration = 4,
  repeatDelay = 0.5,
  className,
  ...props
}: AnimatedGridPatternProps) {
  const id = useId()
  const svg = useRef<SVGSVGElement | null>(null)
  const box = useRef({ w: 0, h: 0 })
  const [squares, setSquares] = useState<Square[]>([])
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = svg.current
    if (!el || reduce) return
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      box.current = { w, h }
      setSquares(Array.from({ length: numSquares }, (_, i) => ({ id: i, pos: cell(w, h, width, height), iteration: 0 })))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [numSquares, reduce, width, height])

  /** A finished square reappears somewhere else. */
  function move(squareId: number) {
    const pos = cell(box.current.w, box.current.h, width, height)
    setSquares((all) => all.map((s) => (s.id === squareId ? { ...s, pos, iteration: s.iteration + 1 } : s)))
  }

  return (
    <svg
      ref={svg}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full fill-foreground/[0.04] stroke-foreground/[0.08]', className)}
      {...props}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <svg x={x} y={y} className="overflow-visible">
        {squares.map(({ pos: [sx, sy], id: sid, iteration }, index) => (
          <motion.rect
            key={`${sid}-${iteration}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: maxOpacity }}
            transition={{ duration, repeat: 1, delay: index * 0.1, repeatType: 'reverse', repeatDelay }}
            onAnimationComplete={() => move(sid)}
            width={width - 1}
            height={height - 1}
            x={sx * width + 1}
            y={sy * height + 1}
            fill="currentColor"
            strokeWidth="0"
          />
        ))}
      </svg>
    </svg>
  )
}
