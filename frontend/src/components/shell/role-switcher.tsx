'use client'
import { useState } from 'react'
import { ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { initials } from '@/components/queue/area-strip'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/components/workspace/context'
import type { Role, Viewer } from '@/lib/model/state'
import { cn } from '@/lib/utils'

const ROLE: Record<Role, string> = {
  preparer: 'Preparer', reviewer: 'Reviewer', partner: 'Partner', firm_administrator: 'Firm admin', quality_reviewer: 'Quality reviewer', client: 'Client',
}

/** Demo identity picker (not authentication): the server re-resolves role, clearance and active date per request. */
export function RoleSwitcher() {
  const { viewer, identities, state, switchIdentity } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const today = state.clock.slice(0, 10)

  async function choose(id: string | null) {
    if (!id || id === viewer.id) return
    setBusy(true)
    await switchIdentity(id)
    setBusy(false)
  }

  const item = (v: Viewer) => {
    const inactive = v.active_from > today
    return (
      <SelectItem key={v.id} value={v.id} disabled={inactive} className="py-1.5">
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="font-medium">{v.name}</span>
            <span className="text-muted-foreground">{ROLE[v.role]}{v.credential ? `, ${v.credential}` : ''}</span>
            {v.kind === 'staff' && <Clearance cleared={v.clearance} />}
          </span>
          {inactive && <span className="text-xs text-muted-foreground">Not active until {v.active_from}; the season clock is {today}</span>}
        </span>
      </SelectItem>
    )
  }

  return (
    <Select value={viewer.id} onValueChange={(v) => void choose(v)} disabled={busy}>
      <SelectTrigger
        className="max-w-56 cursor-pointer gap-2 rounded-full border-transparent bg-muted py-0 pr-3 pl-1 text-foreground ring-1 ring-inset ring-foreground/10 transition-colors duration-200 hover:bg-foreground/[0.08] aria-expanded:bg-foreground/[0.08] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none data-[size=default]:h-8 max-lg:pointer-coarse:data-[size=default]:h-11 dark:bg-muted dark:hover:bg-foreground/[0.08] [&_svg]:text-foreground/60"
        aria-label={`Acting as ${viewer.name}, ${ROLE[viewer.role]}. Demo identity, not authentication`}
      >
        <SelectValue>
          {(id: string) => {
            const v = identities.find((i) => i.id === id) ?? viewer
            return (
              <>
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {initials(v.name)}
                </span>
                {/* Below sm only the avatar shows (this text is visually hidden); the trigger's aria-label carries name and role. */}
                <span className="flex min-w-0 flex-col text-left leading-tight max-sm:sr-only">
                  <span className="truncate text-[13px] font-medium">{v.name}</span>
                  <span className="truncate text-xs text-foreground/70">
                    {ROLE[v.role]}
                    {v.kind === 'staff' && !v.clearance ? ' · no clearance' : ''}
                  </span>
                </span>
              </>
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="w-auto min-w-80 rounded-xl bg-popover/90 shadow-lg backdrop-blur-xl">
        <SelectGroup>
          <SelectLabel>Firm staff · demo identity, not authentication</SelectLabel>
          {identities.filter((v) => v.kind === 'staff').map(item)}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Client portal</SelectLabel>
          {identities.filter((v) => v.kind === 'client').map(item)}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function Clearance({ cleared }: { cleared: boolean }) {
  const Icon = cleared ? ShieldCheckIcon : ShieldOffIcon
  return (
    <span
      title={cleared ? 'Cleared for sensitive data (SSNs, bank numbers)' : 'No sensitive-data clearance: reveals are refused'}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 text-xs font-medium',
        cleared ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
      )}
    >
      <Icon className="size-3" />
      {cleared ? 'cleared' : 'no clearance'}
    </span>
  )
}
