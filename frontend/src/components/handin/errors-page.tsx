'use client'
// /errors (hand-in #3): every canonical error, the check that raises it, and that check's live status.
import { useState } from 'react'
import { Money, RefLink } from '@/components/atoms'
import { useWorkspace } from '@/components/workspace/context'
import { CANON_ERRORS, type ErrorCategory } from '@/lib/errors-map'
import { ALL_CHECKS } from '@/lib/model/checks'
import { cn } from '@/lib/utils'
import {
  byCheck, CATEGORY_LABEL, countBy, type ErrorFilter, type ErrorRow, type ErrorStatus, errorRows, filterRows, implementedChecks, STATUS_LABEL,
} from './errors-rows'

const STATUS_CLASS: Record<ErrorStatus, string> = {
  open: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  resolved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  not_yet: 'border border-dashed border-border text-muted-foreground',
  not_raised: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  prompt: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
}

const SELECT = 'h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

export function ErrorsPage() {
  const { model, state, identities } = useWorkspace()
  const [filter, setFilter] = useState<ErrorFilter>({ category: 'all', status: 'all' })
  const rows = errorRows(model, state, CANON_ERRORS, implementedChecks(model, ALL_CHECKS))
  const shown = filterRows(rows, filter)
  const byStatus = countBy(rows, (r) => r.status)
  const byCategory = countBy(rows, (r) => r.error.category)
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex max-w-4xl flex-col gap-2">
        <h1 className="text-lg font-semibold">Errors found in the packet</h1>
        <p className="text-sm text-muted-foreground">
          {CANON_ERRORS.length} canonical errors from the error hunt, each joined to the engine-free checks that catch it. The workpaper runs
          every check on load, so a finding is waiting on its claim before anyone opens the file. The queue sorts open findings money-first,
          and the claim pane shows each one beside its evidence: the printed page, the other document, the agency record or the client answer.
          Status below is live: it comes from the findings in this engagement&rsquo;s projection at the season clock, not from this table.
        </p>
        <p className="text-sm text-muted-foreground">
          Errors whose checks are not implemented in code are labelled <em>prompt / reviewer judgment</em>: nothing detects them
          automatically; a reviewer must decide them.
        </p>
      </header>

      <section aria-label="Summary" className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_LABEL) as ErrorStatus[]).map((s) => (
          <span key={s} className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-medium', STATUS_CLASS[s])}>
            {STATUS_LABEL[s]} <span className="tabular-nums">{byStatus[s] ?? 0}</span>
          </span>
        ))}
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Category
          <select
            className={SELECT}
            value={filter.category}
            onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value as ErrorCategory | 'all' }))}
          >
            <option value="all">All categories ({rows.length})</option>
            {(Object.keys(CATEGORY_LABEL) as ErrorCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]} ({byCategory[c] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Status
          <select
            className={SELECT}
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as ErrorStatus | 'all' }))}
          >
            <option value="all">Any status</option>
            {(Object.keys(STATUS_LABEL) as ErrorStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {shown.length} of {rows.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full min-w-[960px] text-sm">
          <caption className="sr-only">Canonical errors with the checks that raise them and their live status</caption>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Error</th>
              <th scope="col" className="px-3 py-2 font-medium">Category</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Fed</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">CA</th>
              <th scope="col" className="px-3 py-2 font-medium">Raised by</th>
              <th scope="col" className="px-3 py-2 font-medium">Live status</th>
              <th scope="col" className="px-3 py-2 font-medium">Claim</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <ErrorTableRow key={r.error.id} row={r} nameOf={nameOf} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ErrorTableRow({ row, nameOf }: { row: ErrorRow; nameOf: (id: string) => string }) {
  const { error, checks, findings, status, primary } = row
  return (
    <tr className="border-t align-top">
      <td className="min-w-80 px-3 py-2">
        <div className="flex gap-2">
          <span className="font-mono text-xs text-muted-foreground">{error.id}</span>
          <span className="flex flex-col gap-1">
            <span>{error.title}</span>
            <span className="text-xs text-muted-foreground">{error.howSurfaced}</span>
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {CATEGORY_LABEL[error.category]}
        <div className="text-muted-foreground">{error.severity}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <Money value={error.fed} signed />
      </td>
      <td className="px-3 py-2 text-right">
        <Money value={error.ca} signed />
      </td>
      <td className="max-w-56 px-3 py-2 text-xs">
        {checks.length === 0 && <span className="text-muted-foreground">No check: {error.uncaught ?? 'reviewer judgment'}</span>}
        <ul className="flex flex-col gap-0.5">
          {checks.map((c) => (
            <li key={c.id} title={c.name} className={cn('whitespace-nowrap', !c.implemented && 'text-muted-foreground')}>
              <span className="font-mono">{c.id}</span> {c.implemented ? '' : '(not in code)'}
            </li>
          ))}
        </ul>
      </td>
      <td className="min-w-64 px-3 py-2 text-xs">
        <span className={cn('inline-flex h-5 items-center rounded-full px-2 font-medium whitespace-nowrap', STATUS_CLASS[status])}>{STATUS_LABEL[status]}</span>
        {findings.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {byCheck(findings).map((c) => (
              <li key={c.check}>
                <span className="font-mono">{c.check}</span> <span className="text-muted-foreground">{c.signal}</span>
                {c.open.length > 0 && (
                  <>
                    {' · '}
                    <RefLink to={c.open[0]} className="text-red-700 dark:text-red-300">
                      {c.open.length} open
                    </RefLink>
                  </>
                )}
                {c.resolved.length > 0 && (
                  <>
                    {' · '}
                    {c.resolved.length} resolved by {[...new Set(c.resolved.map((r) => nameOf(r.actor)))].join(', ')} (
                    {c.resolved.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && ', '}
                        <RefLink to={`act:${r.seq}`}>
                          {r.how} #{r.seq}
                        </RefLink>
                      </span>
                    ))}
                    )
                  </>
                )}
                {c.hidden.length > 0 && <span className="text-muted-foreground"> · {c.hidden.length} not yet in file</span>}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">{primary ? <RefLink to={primary} /> : <span className="text-muted-foreground">—</span>}</td>
    </tr>
  )
}
