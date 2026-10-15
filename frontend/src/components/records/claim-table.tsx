'use client'
// Renders a RecordTable: notes, then one native <table> per group, exceptions only until "Show all".
import { useState } from 'react'
import { MaskedText, Money, RefLink } from '@/components/atoms'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Banner, Cell, Column, Group, RecordTable, Tone } from './table'

export const TONE: Record<Tone, string> = {
  bad: 'text-red-700 dark:text-red-400',
  warn: 'text-amber-700 dark:text-amber-400',
  good: 'text-emerald-700 dark:text-emerald-400',
  muted: 'text-muted-foreground',
}

const BANNER: Record<Tone, string> = {
  bad: 'border-red-500 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100',
  warn: 'border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100',
  good: 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100',
  muted: 'border-border bg-muted/40 text-foreground',
}

export function BannerView({ banner }: { banner: Banner }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-l-4 px-3 py-1.5 text-xs', BANNER[banner.tone])}>
      <MaskedText text={banner.text} context={banner.refs[0] ?? 'records'} />
      {banner.meter && (
        <meter min={0} max={banner.meter.max} high={banner.meter.max} value={Math.min(banner.meter.value, banner.meter.max)} className="h-2 w-40" aria-label={banner.text}>
          {banner.meter.value} of {banner.meter.max}
        </meter>
      )}
      {banner.refs.map((r) => (
        <RefLink key={r} to={r} />
      ))}
    </div>
  )
}

/** `context` is the row key: what a Reveal is logged against when the cell has no ref of its own. */
export function CellView({ cell, context }: { cell: Cell; context: string }) {
  const tone = cell.tone ? TONE[cell.tone] : undefined
  const body = cell.money ? (
    <Money value={typeof cell.v === 'number' ? cell.v : null} className={tone} />
  ) : cell.v === null ? null : (
    <span className={tone}>
      <MaskedText text={cell.v} context={cell.ref ?? context} />
    </span>
  )
  return (
    <>
      {cell.ref ? <RefLink to={cell.ref}>{body ?? cell.ref}</RefLink> : body ?? (cell.refs?.length ? null : <span className="text-muted-foreground">—</span>)}
      {cell.refs?.length ? (
        <span className="ml-1 inline-flex flex-wrap gap-x-1.5">
          {cell.refs.map((r) => (
            <RefLink key={r} to={r} />
          ))}
        </span>
      ) : null}
    </>
  )
}

function GroupView({ group, columns, all }: { group: Group; columns: Column[]; all: boolean }) {
  const rows = all ? group.rows : group.rows.filter((r) => r.exception)
  const hidden = group.rows.length - rows.length
  return (
    <section className="flex flex-col gap-1.5 [contain-intrinsic-size:auto_400px] [content-visibility:auto] print:break-inside-avoid-page">
      {group.title && (
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          {group.ref ? <RefLink to={group.ref}>{group.title}</RefLink> : group.title}
          {group.rows.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {group.rows.length} row{group.rows.length === 1 ? '' : 's'}
              {hidden ? ` · ${hidden} without exceptions hidden` : ''}
            </span>
          )}
        </h2>
      )}
      {group.banner && <BannerView banner={group.banner} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border print:overflow-visible">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                {columns.map((c, i) => (
                  <th key={i} scope="col" className={cn('px-2 py-1.5 font-medium whitespace-nowrap', c.money && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn('border-t align-top', all && r.exception && 'bg-amber-50/40 dark:bg-amber-950/20')}>
                  {r.cells.map((c, i) => (
                    <td
                      key={i}
                      className={cn('px-2 py-1', columns[i]?.money && 'text-right whitespace-nowrap tabular-nums')}
                      style={i === 0 && r.depth ? { paddingLeft: `${0.5 + r.depth * 1}rem` } : undefined}
                    >
                      <CellView cell={c} context={r.key} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** One table component for every record: exceptions first, "Show all" for the rest, print friendly. */
export function ClaimTable({ table }: { table: RecordTable }) {
  const total = table.groups.reduce((s, g) => s + g.rows.length, 0)
  // Short papers are shown whole; filtering a 10-row pivot hides the paper itself.
  const [showAll, setShowAll] = useState(table.allByDefault ?? total <= 20)
  const exceptions = table.groups.reduce((s, g) => s + g.rows.filter((r) => r.exception).length, 0)
  return (
    <div className="flex flex-col gap-4">
      {table.notes.map((n, i) => (
        <BannerView key={i} banner={n} />
      ))}
      <div className="flex items-center gap-3 text-xs text-muted-foreground print:hidden">
        <span>
          {exceptions} exception{exceptions === 1 ? '' : 's'} of {total} rows
        </span>
        {exceptions < total && (
          <Button size="xs" variant="outline" onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>
            {showAll ? 'Exceptions only' : `Show all ${total}`}
          </Button>
        )}
      </div>
      {table.groups.map((g) => (
        <GroupView key={g.key} group={g} columns={g.columns ?? table.columns} all={showAll} />
      ))}
    </div>
  )
}
