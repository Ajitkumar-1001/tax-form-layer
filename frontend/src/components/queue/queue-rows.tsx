'use client'
// One queue group (<details> with a count) and its rows. Rows are buttons of at most two lines: click / Enter selects
// into the claim pane, double-click opens the full Trace page. The checkbox picks the row for bulk acts. Row text
// goes through plainMasked: a token has no Reveal button inside a row button, so it shows as •••-••-NNNN.
import type { ReactNode } from 'react'
import { FlagChips, Money, Stake } from '@/components/atoms'
import { formatVal } from '@/components/acts/draft'
import { Checkbox } from '@/components/ui/checkbox'
import type { Model } from '@/lib/model/build'
import type { Val } from '@/lib/model/claims'
import { plainMasked } from '@/lib/model/mask-token'
import type { ClaimState, State } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import type { Group, Row } from './queue-model'

export interface RowHandlers {
  onSelect: (row: Row) => void
  onOpen: (row: Row) => void
  onPick: (row: Row) => void
  onCursor: (row: Row) => void
}

export interface SelectAll {
  state: 'none' | 'some' | 'all'
  enabled: boolean
  onToggle: () => void
}

/** The group's count with its unit: rows are items; the tied group counts claims. */
export function countLabel(group: { key: string }, n: number): string {
  return `${n} ${group.key === 'tied' ? 'claim' : 'item'}${n === 1 ? '' : 's'}`
}

export function GroupView({ group, count, countLabel: countText, open, explanation, selectAll, onToggle, toolbar, children }: {
  group: Pick<Group, 'key' | 'n' | 'label'>
  count: number
  /** The count with its unit ("12 items"); the bare count when absent. */
  countLabel?: string
  open: boolean
  /** One muted line under the header while the group has rows. */
  explanation?: string | null
  /** The select-all box, outside <summary> so a click never toggles the group. null keeps the header's gutter with no
   * box (the tied group), so every header lines up; undefined is the header without a gutter. */
  selectAll?: SelectAll | null
  onToggle: (open: boolean) => void
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="relative border-b last:border-b-0">
      {selectAll && (
        <Checkbox
          checked={selectAll.state === 'all'}
          indeterminate={selectAll.state === 'some'}
          disabled={!selectAll.enabled}
          onCheckedChange={() => selectAll.onToggle()}
          aria-label={`Select all in ${group.label}`}
          className="absolute top-2 left-3"
        />
      )}
      <details open={open} data-tour="queue-group" onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center gap-2 bg-muted/40 px-3 py-1.5 text-sm font-semibold outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden',
            selectAll !== undefined && 'pl-9',
            group.key === 'blocks' && 'border-l-2 border-danger',
          )}
        >
          <span aria-hidden className="w-3 text-muted-foreground">{open ? '▾' : '▸'}</span>
          <span>
            {group.n}. {group.label}
          </span>
          <span className="rounded-full bg-background px-1.5 text-xs font-medium tabular-nums ring-1 ring-border">{countText ?? count}</span>
        </summary>
        {explanation && count > 0 && <p className="px-3 pt-1.5 text-xs text-muted-foreground">{explanation}</p>}
        {toolbar}
        {children}
      </details>
    </div>
  )
}

/** Line 2's value: a correction as was / now; otherwise only a number (a text value adds nothing to a scan). */
function rowValue(claim: Model['claims'][string], cs: ClaimState): ReactNode {
  if (claim.kind !== 'line' && claim.kind !== 'fact') return null
  const show = (v: Val) => (typeof v === 'number' ? <Money value={v} /> : <span className="max-w-40 truncate">{formatVal(v)}</span>)
  if (cs.adjust && !cs.adjust.reverted && cs.adjust.field === 'value') {
    return (
      <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
        <span className="sr-only">was </span>
        <s>{show(cs.original)}</s>
        <span className="sr-only"> now </span>
        <span className="font-medium text-amber-800 dark:text-amber-300">{show(cs.effective)}</span>
      </span>
    )
  }
  return typeof cs.effective === 'number' ? <span className="ml-auto shrink-0"><Money value={cs.effective} /></span> : null
}

export function RowView({ row, model, state, selected, cursor, picked, on }: {
  row: Row
  model: Model
  state: State
  selected: boolean
  cursor: boolean
  picked: boolean
  on: RowHandlers
}) {
  const claim = row.claim ? model.claims[row.claim] : undefined
  const cs = row.claim ? state.claims[row.claim] : undefined
  const label = claim?.label ?? row.title
  const plainLabel = plainMasked(label)
  const reason = label !== row.title ? row.title : row.reason
  const more = row.findings.length - 1
  // The blocks group already says it; elsewhere the chip is the only flag a row keeps.
  const blocks = row.group !== 'blocks' && !!cs?.flags.includes('blocks_filing')
  const value = claim && cs ? rowValue(claim, cs) : null
  const staked = row.stake.fed !== 0 || row.stake.ca !== 0
  return (
    <li className={cn('flex items-start gap-2 border-t px-3 py-1.5 first:border-t-0', selected ? 'bg-muted' : 'hover:bg-muted/50', cursor && 'shadow-[inset_2px_0_0_var(--color-primary)]')}>
      <Checkbox checked={picked} onCheckedChange={() => on.onPick(row)} aria-label={`Select ${plainLabel}`} className="mt-0.5" />
      <button
        type="button"
        data-row={row.key}
        title={row.ref}
        aria-current={selected || undefined}
        onClick={() => on.onSelect(row)}
        onDoubleClick={() => on.onOpen(row)}
        onFocus={() => on.onCursor(row)}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{plainLabel}</span>
          {staked && (
            <span className="flex shrink-0">
              <Stake fed={row.stake.fed} ca={row.stake.ca} />
              <span className="sr-only"> at stake</span>
            </span>
          )}
        </span>
        {(reason || more > 0 || row.downstream > 0 || blocks || value) && (
          <span className="flex flex-nowrap items-center gap-2 text-xs text-muted-foreground">
            {reason && <span className="min-w-0 truncate">{plainMasked(reason)}</span>}
            {more > 0 && <span className="shrink-0">{`+${more} more`}</span>}
            {row.downstream > 0 && (
              <span className="shrink-0" title="Findings on totals above this line, folded into this root">
                {`explains ${row.downstream} total${row.downstream === 1 ? '' : 's'} above`}
              </span>
            )}
            {blocks && (
              <span className="flex shrink-0">
                <FlagChips flags={['blocks_filing']} />
              </span>
            )}
            {value}
          </span>
        )}
      </button>
    </li>
  )
}
