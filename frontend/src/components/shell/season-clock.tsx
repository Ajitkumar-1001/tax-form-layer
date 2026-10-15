'use client'
import { useState } from 'react'
import { ChevronRightIcon, ClockIcon } from 'lucide-react'
import { formatClock } from '@/components/atoms/format'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspace } from '@/components/workspace/context'
import type { ActInput } from '@/lib/model/acts'
import { seasonEvents } from '@/lib/model/ids'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * The season so far, from the first packet event to the extended due date (or later, once the clock passes it): a tick
 * for every packet event the clock has passed, the filing deadlines, the next event (hollow) and now (pen blue). Only what
 * the clock has reached shows, like everywhere else: the future stays hidden. The deadline the return faces next is
 * named with its days left. The track is a picture of the time and next-event text around it, so it is hidden from
 * assistive tech.
 */
function SeasonTrack({ className }: { className?: string }) {
  const { model, state } = useWorkspace()
  const events = seasonEvents(model.packet, '')
  const deadlines = model.packet.firm.deadlines
    .filter((d) => !/internal|outside/i.test(d.what))
    .map((d) => ({ ...d, at: Date.parse(`${d.date}T00:00:00Z`) }))
  const now = Date.parse(state.clock)
  const next = state.nextEvent ? Date.parse(state.nextEvent.at) : now
  const start = Math.min(Date.parse(events[0]?.at ?? state.clock), now)
  const end = Math.max(now, next, ...deadlines.map((d) => d.at))
  const x = (t: number) => `${((t - start) / (end - start || 1)) * 100}%`
  const due = deadlines.filter((d) => d.at > now).sort((a, b) => a.at - b.at)[0]
  return (
    <span className={cn('min-w-0 flex-1 items-center gap-3 pr-3', className)}>
      <span aria-hidden className="relative h-4 min-w-16 flex-1">
        <span className="absolute inset-x-0 top-1/2 h-px bg-foreground/15" />
        <span className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full bg-foreground/40" style={{ width: x(now) }} />
        {events.map(
          (e, i) => e.at <= state.clock && <span key={i} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-foreground/45" style={{ left: x(Date.parse(e.at)) }} />,
        )}
        {deadlines.map((d) => (
          <span key={d.what} className={cn('absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full', d.at > now ? 'bg-warning' : 'bg-foreground/50')} style={{ left: x(d.at) }} />
        ))}
        {state.nextEvent && (
          <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-primary ring-inset" style={{ left: x(next) }} />
        )}
        <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: x(now) }} />
      </span>
      {due && (
        <span className="shrink-0 whitespace-nowrap text-foreground/70 tabular-nums" title={due.what}>
          <span className="text-foreground">{shortDate(due.date)}</span> · {Math.ceil((due.at - now) / DAY)} days
        </span>
      )}
    </span>
  )
}

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
      {/* One rounded chip: the time, the season so far (xl up), then the next event (a button), a hairline before it. */}
      <div className="flex h-8 w-full min-w-0 items-center overflow-hidden rounded-full bg-muted text-xs ring-1 ring-inset ring-foreground/10 sm:w-fit xl:w-full">
        <span className="flex h-full shrink-0 items-center gap-1.5 px-3 text-foreground" title="Season clock (UTC). It only moves forward, through clock acts.">
          <ClockIcon className="size-3.5 text-foreground/60" />
          <span className="whitespace-nowrap tabular-nums">{formatClock(state.clock)}</span>
        </span>
        <SeasonTrack className="hidden xl:flex" />
        {next && input && auth && (
          // The title sits on a wrapper: a disabled button gets no pointer events, so it cannot carry the reason.
          <span title={auth.ok ? `Move the season clock to ${formatClock(next.at)}` : auth.reason} className="flex h-full min-w-0 flex-1 sm:flex-none">
            <span aria-hidden className="my-2 w-px shrink-0 bg-foreground/20" />
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger
                disabled={!auth.ok}
                className="group/next flex h-full w-full min-w-0 cursor-pointer items-center justify-between gap-1 px-3 text-foreground outline-none transition-colors duration-200 hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground disabled:pointer-events-none motion-reduce:transition-none sm:justify-start"
              >
                {/* Not allowed to move the clock: the label stays at full strength (it is information), only the arrow goes. */}
                <span className="truncate sm:max-w-64 lg:max-w-36 xl:max-w-64">
                  <span className="text-foreground/65">Next:</span> {next.label}
                </span>
                <ChevronRightIcon className="size-3.5 shrink-0 text-foreground/60 transition-transform duration-200 group-hover/next:translate-x-0.5 group-disabled/next:hidden motion-reduce:transition-none" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 rounded-2xl bg-popover/90 backdrop-blur-xl">
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
