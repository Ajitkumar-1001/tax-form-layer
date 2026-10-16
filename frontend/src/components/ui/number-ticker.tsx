'use client'
// Magic UI "Number Ticker", rebuilt on animate(): counts up to `value` once the first time it scrolls into view. Under
// prefers-reduced-motion it renders `value` from the first paint and never animates. The count lives in an effect that
// stops itself on cleanup and starts again whenever the effect re-mounts (the app keeps hidden routes alive with <Activity>),
// so leaving mid-count and coming back replays the count and always ends on `value`, never on a frozen in-between figure.
// The digits are written straight to the DOM (no re-render per frame), so give it an aria-hidden wrapper and put the real
// figure in text a screen reader can reach.
import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { animate, useInView, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  startValue?: number
  /** Seconds to wait before counting. */
  delay?: number
}

const format = (n: number) => Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n))

export function NumberTicker({ value, startValue = 0, delay = 0, className, ...props }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: '0px' })

  useEffect(() => {
    if (reduce || !inView) return
    const count = animate(startValue, value, {
      delay,
      duration: 1.8,
      ease: 'easeOut',
      onUpdate: (n) => {
        if (ref.current) ref.current.textContent = format(n)
      },
    })
    return () => count.stop()
  }, [reduce, inView, startValue, value, delay])

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)} {...props}>
      {format(reduce ? value : startValue)}
    </span>
  )
}
