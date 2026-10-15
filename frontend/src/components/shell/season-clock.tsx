'use client'
import { useState } from 'react'
import { ChevronRightIcon, ClockIcon } from 'lucide-react'
import { formatClock } from '@/components/atoms/format'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspace } from '@/components/workspace/context'
import type { ActInput } from '@/lib/model/acts'
import { cn } from '@/lib/utils'

/** [clock 2026-06-23 06:05 | Next: msg-07 from client ›]. Moving the shared clock is an act, so it asks first. */
export function SeasonClock({ className }: { className?: string }) {
  const { state, can, post } = useWorkspace()
  const [open, setOpen] = useState(false)
  const next = state.nextEvent
  const input: ActInput | null = next ? { type: 'clock', target: 'season', body: { to: next.at, event: next.ref } } : null
  const auth = input ? can(input) : null

  async function move() {
    if (!input || !next) return
    setOpen(false)
    await post([input], { undoLabel: `Season clock moved to ${formatClock(next.at)} (${next.label})` })
  }

  return (
    <div className={cn('flex min-w-0', className)}>
      <div className="flex h-8 w-full min-w-0 items-center rounded-lg border bg-card text-xs sm:w-fit">
        <span className="flex shrink-0 items-center gap-1.5 px-2.5" title="Season clock (UTC). It only moves forward, through clock acts.">
          <ClockIcon className="size-3.5 text-muted-foreground" />
          <span className="font-mono whitespace-nowrap tabular-nums">{formatClock(state.clock)}</span>
        </span>
        {next && input && auth && (
          // The title sits on a wrapper: a disabled button gets no pointer events, so it cannot carry the reason.
          <span title={auth.ok ? `Move the season clock to ${formatClock(next.at)}` : auth.reason} className="flex h-full min-w-0 flex-1 border-l sm:flex-none">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger
                disabled={!auth.ok}
                className="flex h-full w-full min-w-0 cursor-pointer items-center justify-between gap-1 rounded-r-[7px] px-2.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:justify-start"
              >
                <span className="truncate sm:max-w-64 lg:max-w-36 xl:max-w-64">Next: {next.label}</span>
                <ChevronRightIcon className="size-3.5 shrink-0" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <PopoverHeader>
                  <PopoverTitle>Move the season clock?</PopoverTitle>
                  <PopoverDescription>
                    To {formatClock(next.at)}: {next.label}. Everyone on this engagement sees the new time, and the clock cannot move back.
                  </PopoverDescription>
                </PopoverHeader>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={move}>
                    Move clock
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {!auth.ok && <span className="sr-only">{auth.reason}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
