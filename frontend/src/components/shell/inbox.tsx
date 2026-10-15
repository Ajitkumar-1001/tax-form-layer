'use client'
import { useState } from 'react'
import Link from 'next/link'
import { BellIcon, CalendarIcon, CircleHelpIcon, MessageSquareIcon, ReplyIcon, RotateCcwIcon, UserPlusIcon } from 'lucide-react'
import { Ago } from '@/components/atoms/ago'
import { refHref } from '@/components/atoms/format'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspace } from '@/components/workspace/context'
import type { InboxItem } from '@/lib/model/state'
import { cn } from '@/lib/utils'

const ICON: Record<InboxItem['kind'], typeof BellIcon> = {
  note: MessageSquareIcon, reply: ReplyIcon, assign: UserPlusIcon, reopened: RotateCcwIcon, deadline: CalendarIcon, question: CircleHelpIcon,
}

/**
 * state.inbox for the viewer. Items newer than "last seen" count as unread; deadlines carry no seq and never do.
 * Every item's `at` is on the season calendar (season_at, due dates), so ages read against the season clock.
 */
export function Inbox() {
  const { state, lastSeenSeq, markSeen } = useWorkspace()
  const [open, setOpen] = useState(false)
  const isNew = (i: InboxItem) => i.seq != null && i.seq > lastSeenSeq
  const unread = state.inbox.filter(isNew).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative cursor-pointer max-lg:pointer-coarse:size-11" aria-label={`Inbox, ${unread} unread`} />}>
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-medium">Inbox</span>
          <Button variant="ghost" size="xs" onClick={markSeen} disabled={state.head <= lastSeenSeq}>
            Mark all seen
          </Button>
        </div>
        {state.inbox.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground">Nothing addressed to you.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {state.inbox.map((i, n) => {
              const Icon = ICON[i.kind]
              return (
                <li key={`${i.kind}:${i.seq ?? i.ref}:${n}`}>
                  <Link href={refHref(i.ref)} onClick={() => setOpen(false)} className="flex gap-2.5 px-3 py-2 hover:bg-muted">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn('line-clamp-2', isNew(i) && 'font-medium')}>{i.text}</span>
                      <span className="flex gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate font-mono">{i.ref}</span>·<Ago iso={i.at} now={state.clock} />
                      </span>
                    </span>
                    {isNew(i) && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="unread" />}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
