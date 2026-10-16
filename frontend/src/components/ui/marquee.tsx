// Magic UI "Marquee", horizontal only: the children scroll past in a loop (CSS only, keyframes and --animate-marquee in
// globals.css). `repeat` copies make the loop seamless, so every copy after the first is hidden from assistive tech; under
// prefers-reduced-motion it stops, shows one copy, and wraps. Meant for decoration: pass it content that is also on the page.
import { type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

interface MarqueeProps extends ComponentPropsWithoutRef<'div'> {
  reverse?: boolean
  pauseOnHover?: boolean
  /** Copies of the children; enough that one copy plus the gap is wider than the viewport. */
  repeat?: number
}

export function Marquee({ className, reverse = false, pauseOnHover = false, repeat = 4, children, ...props }: MarqueeProps) {
  return (
    <div {...props} className={cn('group flex gap-(--gap) overflow-hidden [--duration:60s] [--gap:0.75rem]', className)}>
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          className={cn(
            'animate-marquee flex min-w-full shrink-0 flex-row justify-around gap-(--gap) motion-reduce:animate-none motion-reduce:flex-wrap motion-reduce:justify-start motion-reduce:shrink motion-reduce:basis-full',
            i > 0 && 'motion-reduce:hidden',
            pauseOnHover && 'group-hover:[animation-play-state:paused]',
            reverse && '[animation-direction:reverse]',
          )}
        >
          {children}
        </div>
      ))}
    </div>
  )
}
