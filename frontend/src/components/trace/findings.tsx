'use client'
// Findings as what / why / expected vs actual / stake / evidence, with the next act to clear each.
import { FindingFixButton } from '@/components/acts/act-host'
import { RefLink } from '@/components/atoms/ref-link'
import { Stake } from '@/components/atoms/money'
import { useWorkspace } from '@/components/workspace/context'
import type { Finding, Severity, Signal } from '@/lib/model/checks/types'
import { cn } from '@/lib/utils'
import { Empty, Section, useWho, ValueText } from './parts'

const SEVERITY: Record<Severity, string> = {
  high: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-sky-400',
}
const SIGNAL: Record<Signal, { label: string; title: string }> = {
  computed: { label: 'computed', title: 'Derived from the packet by arithmetic or exact matching' },
  heuristic: { label: 'heuristic', title: 'A pattern that usually means a problem; confirm before acting' },
  prompt: { label: 'prompt', title: 'A question the file raises; a person must answer it' },
}

export function FindingCard({ finding: f, showClaims = false }: { finding: Finding; showClaims?: boolean }) {
  const { state } = useWorkspace()
  const who = useWho()
  const fs = state.findings[f.id]
  const open = fs?.status !== 'resolved'
  return (
    <article className={cn('flex flex-col gap-1.5 rounded-md border border-l-4 p-3 text-sm', SEVERITY[f.severity], !open && 'opacity-70')}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="min-w-0 flex-1 font-medium">{f.title}</h3>
        <span className="text-xs text-muted-foreground" title={SIGNAL[f.signal].title}>{f.severity} · {SIGNAL[f.signal].label} · {f.check}</span>
      </header>
      <p className="text-muted-foreground">{f.why}</p>
      {(f.expected !== undefined || f.actual !== undefined) && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <div className="flex gap-1"><dt className="text-muted-foreground">Expected</dt><dd className="font-mono"><ValueText value={f.expected} context={f.id} /></dd></div>
          <div className="flex gap-1"><dt className="text-muted-foreground">Actual</dt><dd className="font-mono"><ValueText value={f.actual} context={f.id} /></dd></div>
          {f.stake && <div className="flex gap-1"><dt className="text-muted-foreground">At stake</dt><dd><Stake fed={f.stake.fed} ca={f.stake.ca} /></dd></div>}
        </dl>
      )}
      {showClaims && (
        <p className="flex flex-wrap gap-x-2 text-xs"><span className="text-muted-foreground">On</span>{f.claims.map((c) => <RefLink key={c} to={c} />)}</p>
      )}
      {f.evidence.length > 0 && (
        <p className="flex flex-wrap gap-x-2 text-xs"><span className="text-muted-foreground">Evidence</span>{f.evidence.map((e) => <RefLink key={e} to={e} />)}</p>
      )}
      <footer className="flex flex-wrap items-center gap-2 pt-1">
        {open ? (
          <>
            <FindingFixButton finding={f} />
            <RefLink to={f.id} className="text-xs">open finding</RefLink>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            Resolved by {fs?.resolvedBy ? <>{who(fs.resolvedBy.actor)} via <RefLink to={`act:${fs.resolvedBy.seq}`}>{fs.resolvedBy.how} #{fs.resolvedBy.seq}</RefLink></> : 'an act'}
          </span>
        )}
      </footer>
    </article>
  )
}

/** Visible findings, open first; findings whose evidence arrives later in the season are only counted. */
export function FindingsList({ ids, title = 'Findings' }: { ids: string[]; title?: string }) {
  const { model, state } = useWorkspace()
  const all = ids.map((id) => model.findingsById[id]).filter(Boolean)
  const visible = all.filter((f) => state.findings[f.id]?.visible)
  const later = all.length - visible.length
  const open = visible.filter((f) => state.findings[f.id]?.status === 'open')
  const sorted = [...open, ...visible.filter((f) => !open.includes(f))]
  return (
    <Section title={title} aside={visible.length ? `${open.length} open of ${visible.length}` : undefined}>
      {sorted.length ? sorted.map((f) => <FindingCard key={f.id} finding={f} />) : <Empty>No findings.</Empty>}
      {later > 0 && <p className="text-xs text-muted-foreground">{later} more {later === 1 ? 'finding depends' : 'findings depend'} on items not yet in file.</p>}
    </Section>
  )
}
