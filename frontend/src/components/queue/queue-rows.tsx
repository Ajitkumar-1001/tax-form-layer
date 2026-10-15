'use client'
// One queue group (<details> with a count) and its rows. Rows are buttons: click / Enter selects into the
// claim pane, double-click opens the full Trace page. The checkbox picks the row for bulk acts.
import type { ReactNode } from 'react'
import { FlagChips, Money, Stake, StatusPill, SupportLetters } from '@/components/atoms'
import { formatVal } from '@/components/acts/draft'
import { Checkbox } from '@/components/ui/checkbox'
import type { Model } from '@/lib/model/build'
import type { ClaimState, State } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { initials } from './area-strip'
import type { Group, Row } from './queue-model'

export interface RowHandlers {
  onSelect: (row: Row) => void
  onOpen: (row: Row) => void
  onPick: (row: Row) => void
  onCursor: (row: Row) => void
}

export function GroupView({ group, count, open, learn, onToggle, toolbar, children }: {
  group: Pick<Group, 'key' | 'n' | 'label' | 'learn'>
  count: number
  open: boolean
  learn: boolean
  onToggle: (open: boolean) => void
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className="border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/40 px-3 py-1.5 text-sm font-semibold outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="w-3 text-muted-foreground">{open ? '▾' : '▸'}</span>
        <span>
          {group.n}. {group.label}
        </span>
        <span className="rounded-full bg-background px-1.5 text-xs font-medium tabular-nums ring-1 ring-border">{count}</span>
      </summary>
      {learn && <p className="px-3 pt-1.5 text-xs text-muted-foreground">{group.learn}</p>}
      {toolbar}
      {children}
    </details>
  )
}

function Value({ claim, cs }: { claim: Model['claims'][string]; cs: ClaimState }) {
  if (claim.kind !== 'line' && claim.kind !== 'fact') return null
  const adjusted = cs.adjust && !cs.adjust.reverted && cs.adjust.field === 'value'
  const show = (v: ClaimState['effective']) => (typeof v === 'number' ? <Money value={v} /> : <span className="max-w-40 truncate">{formatVal(v)}</span>)
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 text-xs">
      {adjusted && <s className="text-muted-foreground">{show(cs.original)}</s>}
      <span className={cn('font-medium', adjusted && 'text-amber-800 dark:text-amber-300')}>{show(cs.effective)}</span>
    </span>
  )
}

export function RowView({ row, model, state, names, selected, cursor, picked, on }: {
  row: Row
  model: Model
  state: State
  names: Record<string, string>
  selected: boolean
  cursor: boolean
  picked: boolean
  on: RowHandlers
}) {
  const claim = row.claim ? model.claims[row.claim] : undefined
  const cs = row.claim ? state.claims[row.claim] : undefined
  const label = claim?.label ?? row.title
  const assignee = row.area ? state.assignments[row.area] : undefined
  const more = row.findings.length - 1
  return (
    <li className={cn('flex items-start gap-2 border-t px-3 py-1.5 first:border-t-0', selected && 'bg-muted', cursor && 'shadow-[inset_2px_0_0_var(--color-primary)]')}>
      <Checkbox checked={picked} onCheckedChange={() => on.onPick(row)} aria-label={`Select ${row.claim ?? row.ref} for bulk actions`} className="mt-1" />
      <button
        type="button"
        data-row={row.key}
        aria-current={selected || undefined}
        onClick={() => on.onSelect(row)}
        onDoubleClick={() => on.onOpen(row)}
        onFocus={() => on.onCursor(row)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          {cs && <StatusPill status={cs.status} />}
          <span className="min-w-0 truncate text-sm font-medium">{label}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.claim ?? (row.ref.startsWith('act:') ? row.ref : '')}</span>
          <span className="ml-auto" />
          {claim && cs && <Value claim={claim} cs={cs} />}
        </span>
        {label !== row.title && (
          <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{row.title}</span>
            {more > 0 && <span className="shrink-0">+{more} more</span>}
          </span>
        )}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {cs && <SupportLetters support={cs.support} />}
          <Stake fed={row.stake.fed} ca={row.stake.ca} />
          {cs && <FlagChips flags={cs.flags} />}
          {row.downstream > 0 && (
            <span className="text-[11px] text-muted-foreground" title="Findings on totals above this line, collapsed because this is their root">
              root of {row.downstream} above
            </span>
          )}
          {assignee && (
            <span title={`Assigned to ${names[assignee] ?? assignee}`} className="ml-auto shrink-0 rounded-full bg-muted px-1 text-[11px] font-medium">
              {initials(names[assignee] ?? assignee)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
