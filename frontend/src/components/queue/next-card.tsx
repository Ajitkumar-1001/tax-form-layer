'use client'
// The Next card: the one most valuable action for this viewer, with what / why / done-when and Go.
import { ChevronDownIcon, ChevronRightIcon, CompassIcon, PartyPopperIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms/ref-link'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { AuthResult } from '@/lib/model/state'
import { type NextAction, goInput } from './queue-model'

export function NextCard({ next, open, onOpenChange, onGo }: {
  next: NextAction | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onGo: (next: NextAction, auth: AuthResult) => void
}) {
  const { model, state, can } = useWorkspace()
  if (!next) {
    return (
      <section aria-label="Next" className="flex items-center gap-2 rounded-lg border bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50">
        <PartyPopperIcon className="size-4 shrink-0" />
        Nothing is waiting on you. Everything open is with someone else.
      </section>
    )
  }
  const auth: AuthResult = next.request ? can(goInput(model, state, next.request)) : { ok: true }
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon
  return (
    <section aria-label="Next" className="rounded-lg border border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" />
          <CompassIcon className="size-4 shrink-0 text-primary" />
          <span className="shrink-0 font-semibold">Next</span>
          <span className={open ? 'min-w-0' : 'min-w-0 truncate'}>{next.what}</span>
        </button>
        <span title={auth.ok ? undefined : auth.reason} className="inline-flex shrink-0">
          <Button size="sm" onClick={() => onGo(next, auth)}>
            Go
          </Button>
        </span>
      </div>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 pl-9 text-sm">
          <dt className="text-muted-foreground">Why</dt>
          <dd className="min-w-0">{next.why}</dd>
          <dt className="text-muted-foreground">Done when</dt>
          <dd className="min-w-0">{next.doneWhen}</dd>
          <dt className="text-muted-foreground">Where</dt>
          <dd className="min-w-0">
            <RefLink to={next.ref} />
            {next.request && !auth.ok && <span className="ml-2 text-xs text-muted-foreground">Go opens it; the fix is not yours to record: {auth.reason}</span>}
          </dd>
        </dl>
      )}
    </section>
  )
}
