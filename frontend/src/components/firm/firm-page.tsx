'use client'
// /firm, the firm administrator's home (spec §3.9): view log, time against budget, standards, staff,
// engagements (fresh copy) and assignments.
import { type ReactNode, useEffect, useState } from 'react'
import { ShieldCheckIcon, ShieldOffIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms'
import { ActButton } from '@/components/acts/act-host'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { cn } from '@/lib/utils'
import { areaName, budgetOnly, hours, timeByPerson, viewLogRows } from './firm-logic'

// A link to /firm#<id> lands on the heading; its scroll margin keeps it clear of the sticky header (one 56 px row from
// lg, two rows below).
function Panel({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <header className="flex flex-col gap-0.5">
        <h2 id={id} className="scroll-mt-44 text-base font-semibold lg:scroll-mt-20">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

const TH = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground'
const TD = 'px-2 py-1.5 align-top'

export function FirmPage() {
  // The page renders only once the workspace has booted (its panels wait for it), after the browser's own jump to #time
  // (or #engagements) found nothing, so jump once here.
  useEffect(() => {
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
  }, [])
  return (
    <div className="flex flex-col gap-5 p-6">
      <h1 className="text-lg font-semibold">Firm</h1>
      <Panel id="viewlog" title="Sensitive-data view log" hint="Every reveal of a masked value, granted or denied. The server records it before it answers.">
        <ViewLog />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel id="time" title="Time against budget" hint="From time acts, against firm.budget_hours.">
          <TimeBudget />
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel id="engagements" title="Engagements">
            <Engagements />
          </Panel>
          <Panel id="assignments" title="Assignments" hint="Who prepares each area. Assigning is a reviewer, partner or administrator act.">
            <Assignments />
          </Panel>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel id="standards" title="Firm standards" hint="firm.starter_standards, as delivered in the packet.">
          <Standards />
        </Panel>
        <Panel id="staff" title="Staff and clearance" hint="Read-only, from firm.staff. Role, clearance and active date are re-resolved on the server for every request.">
          <Staff />
        </Panel>
      </div>
    </div>
  )
}

function ViewLog() {
  const { state, identities } = useWorkspace()
  const rows = viewLogRows(state)
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  if (!rows.length) return <p className="text-sm text-muted-foreground">No one has revealed a masked value in this engagement.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>Who</th>
            <th scope="col" className={TH}>Field</th>
            <th scope="col" className={TH}>Viewed from</th>
            <th scope="col" className={TH}>Result</th>
            <th scope="col" className={TH}>Wall time</th>
            <th scope="col" className={TH}>Season time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq} className="border-b last:border-0">
              <td className={TD}>
                {nameOf(r.actor)} <span className="text-xs text-muted-foreground">{r.actor}</span>
              </td>
              <td className={cn(TD, 'font-mono text-xs')}>{r.kind}</td>
              <td className={TD}>
                <RefLink to={r.context} />
              </td>
              <td className={TD}>
                {r.granted ? (
                  <span className="text-emerald-800 dark:text-emerald-300">granted</span>
                ) : (
                  <span className="text-red-800 dark:text-red-300" title={r.reason}>
                    denied{r.reason && `: ${r.reason}`}
                  </span>
                )}
              </td>
              <td className={cn(TD, 'text-xs tabular-nums whitespace-nowrap')}>{r.recorded_at.slice(0, 19).replace('T', ' ')}</td>
              <td className={cn(TD, 'text-xs tabular-nums whitespace-nowrap')}>{r.season_at.slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TimeBudget() {
  const { model, state, identities } = useWorkspace()
  const people = timeByPerson(state)
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>Area</th>
            <th scope="col" className={cn(TH, 'text-right')}>Logged</th>
            <th scope="col" className={cn(TH, 'text-right')}>Budget</th>
            <th scope="col" className={TH}>
              <span className="sr-only">Log time</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {state.areas.map((a) => {
            const over = a.budget !== null && a.hours > a.budget
            return (
              <tr key={a.key} className="border-b last:border-0">
                <td className={TD}>{a.label}</td>
                <td className={cn(TD, 'text-right tabular-nums', over && 'font-medium text-red-700 dark:text-red-300')}>{hours(a.hours)}</td>
                <td className={cn(TD, 'text-right tabular-nums text-muted-foreground')}>{a.budget ?? '—'}</td>
                <td className={cn(TD, 'text-right')}>
                  <ActButton type="time" target={`area:${a.key}`} size="xs" variant="outline">
                    Log time
                  </ActButton>
                </td>
              </tr>
            )
          })}
          {budgetOnly(model.packet.firm.budget_hours).map((b) => (
            <tr key={b.key} className="border-b last:border-0 text-muted-foreground">
              <td className={TD}>{b.label} (budget only)</td>
              <td className={cn(TD, 'text-right')}>—</td>
              <td className={cn(TD, 'text-right tabular-nums')}>{b.hours}</td>
              <td className={TD} />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">By person</h3>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {people.map((p) => (
              <li key={p.actor}>
                <span className="font-medium">{nameOf(p.actor)}</span> <span className="tabular-nums">{hours(p.total)} h</span>
                <span className="text-xs text-muted-foreground">
                  {' '}
                  ({Object.entries(p.hours).map(([k, h]) => `${areaName(k)} ${hours(h ?? 0)}`).join(', ')})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Engagements() {
  const { engagement, viewer } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const admin = viewer.role === 'firm_administrator'

  async function choose(body: { fresh: true } | { id: string }) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/engagement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok) throw new Error((json as { reason?: string } | null)?.reason ?? `${res.status} ${res.statusText}`)
      // The workspace bootstraps once per load; a reload picks up the new engagement cookie.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Current engagement: <span className="font-mono">{engagement}</span>
        {engagement === 'main' ? ' (the shared demo log)' : ' (a fresh copy)'}
      </p>
      <p className="text-xs text-muted-foreground">
        A fresh copy starts an empty act log on the same sealed packet: the return exactly as delivered, with no one&rsquo;s work in it. The
        shared log is untouched and you can switch back at any time.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {admin && (
          <Button size="sm" disabled={busy} onClick={() => void choose({ fresh: true })}>
            Fresh copy
          </Button>
        )}
        {engagement !== 'main' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void choose({ id: 'main' })}>
            Back to the shared engagement
          </Button>
        )}
      </div>
      {!admin && <p className="text-xs text-muted-foreground">Only the firm administrator (Jo Kimura, st-05) starts a fresh copy.</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function Assignments() {
  const { state, identities } = useWorkspace()
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  return (
    <table className="w-full text-sm">
      <tbody>
        {state.areas.map((a) => (
          <tr key={a.key} className="border-b last:border-0">
            <td className={TD}>{a.label}</td>
            <td className={TD}>{nameOf(state.assignments[a.key])}</td>
            <td className={cn(TD, 'text-right')}>
              <ActButton type="assign" target={`area:${a.key}`} size="xs" variant="outline">
                Assign
              </ActButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Standards() {
  const { model } = useWorkspace()
  const s = model.packet.firm.starter_standards
  const v = s.variance_review
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-muted-foreground">{s.note}</p>
      <List title="Verification types" items={s.verification_types.map((t) => t.replaceAll('_', ' '))} />
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">Variance review</h3>
        <p>
          Compare to {v.compare_to.replaceAll('_', ' ')}; flag a change over {v.flag_if_change_over_percent}% and over{' '}
          {v.and_over_amount.toLocaleString('en-US')}.
        </p>
      </section>
      <List title="Review levels" items={s.review_levels} />
      <List title="Rules" items={s.rules} />
      <List title="Required steps" items={s.required_steps} ordered />
    </div>
  )
}

function List({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">{title}</h3>
      <Tag className={cn('flex flex-col gap-0.5 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </Tag>
    </section>
  )
}

function Staff() {
  const { model, state } = useWorkspace()
  const today = state.clock.slice(0, 10)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>Name</th>
            <th scope="col" className={TH}>Role</th>
            <th scope="col" className={TH}>Clearance</th>
            <th scope="col" className={TH}>Active from</th>
          </tr>
        </thead>
        <tbody>
          {model.packet.firm.staff.map((s) => (
            <tr key={s.id} className="border-b last:border-0">
              <td className={TD}>
                {s.name}
                {s.credential && <span className="text-muted-foreground">, {s.credential}</span>}{' '}
                <span className="text-xs text-muted-foreground">{s.id}</span>
                {s.note && <div className="text-xs text-muted-foreground">{s.note}</div>}
              </td>
              <td className={cn(TD, 'capitalize')}>{s.role.replaceAll('_', ' ')}</td>
              <td className={TD}>
                {s.sensitive_data_clearance ? (
                  <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
                    <ShieldCheckIcon className="size-3.5" /> cleared
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-800 dark:text-red-300">
                    <ShieldOffIcon className="size-3.5" /> masked only
                  </span>
                )}
              </td>
              <td className={cn(TD, 'tabular-nums')}>
                {s.active_from}
                {s.active_from > today && <div className="text-xs text-muted-foreground">not yet active</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
