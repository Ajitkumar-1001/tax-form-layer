'use client'
// /filing, the partner's home (spec §3.6): required steps, sign-offs, partner desk, approval, submit,
// filings and agency results, freeze and amendment, the extension and the packet's season record.
import { type ReactNode, useEffect, useState } from 'react'
import { CircleCheckIcon, CircleXIcon, FileTextIcon, LockIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms'
import { ActButton } from '@/components/acts/act-host'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { FilingView } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { ClientCopy } from './client-copy'
import { filingResults, spouseStatus, type SpouseStatus } from './filing-logic'
import { PartnerDesk } from './partner-desk'
import { PrintSheet } from './print-sheet'
import { ReasonList } from './reason-link'
import { ExtensionPanel, SeasonRecord } from './season-panels'
import { SignoffMatrix } from './signoff-matrix'

// A link to /filing#<id> lands on the heading; its scroll margin keeps it clear of the sticky header (one 56 px row from
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

export function FilingPage() {
  const { state } = useWorkspace()
  const [copy, setCopy] = useState(false)
  // The page renders only once the workspace has booted, after the browser's own jump to #steps (or #matrix) found
  // nothing, so jump once here.
  useEffect(() => {
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
  }, [])
  const done = state.steps.filter((s) => s.ok).length
  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Filing desk</h1>
        <span className="text-sm text-muted-foreground">
          {done} of {state.steps.length} required steps met
        </span>
        <Frozen />
      </header>
      {copy && (
        <PrintSheet title="Client copy" onClose={() => setCopy(false)}>
          <ClientCopy />
        </PrintSheet>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel id="steps" title="Required steps" hint="Derived from the work; each red step says what turns it green.">
          <Steps />
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel id="approval" title="Client approval" hint="The clients approve exact amounts; any amount change reopens the approval.">
            <Approval />
          </Panel>
          <Panel id="submit" title="Submit" hint="Partner only. Needs all 12 steps and no open blocking review notes.">
            <Submit />
          </Panel>
        </div>
      </div>

      <Panel id="matrix" title="Sign-offs" hint="Each sign-off fingerprints its scope and reopens itself when a value or its evidence changes.">
        <SignoffMatrix />
      </Panel>

      <Panel id="desk" title="Partner desk" hint="Adjustments over 1,000 and process findings whose money needs the partner. Select, then sign partner level over their areas.">
        <PartnerDesk />
      </Panel>

      <Panel id="filings" title="Filings and agency results" hint="Agency responses are simulated by one disclosed rule (see About).">
        <div className="flex flex-wrap items-center gap-2">
          <Frozen />
          <Button size="sm" variant="outline" onClick={() => setCopy(true)}>
            <FileTextIcon /> Client copy
          </Button>
          <ActButton type="amend_open" target="return" size="sm" variant="outline">
            Open amendment
          </ActButton>
        </div>
        <Filings />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel id="extension" title="Extension (packet facts)">
          <ExtensionPanel />
        </Panel>
        <Panel id="season" title="Season record (packet)">
          <SeasonRecord />
        </Panel>
      </div>
    </div>
  )
}

function Frozen() {
  const { state } = useWorkspace()
  const js = (['federal', 'california'] as const).filter((j) => state.frozen[j])
  if (!js.length) return state.amendment ? <span className="rounded-full bg-orange-100 px-2 text-xs text-orange-900 dark:bg-orange-950 dark:text-orange-200">Amendment {state.amendment} open</span> : null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
      <LockIcon className="size-3" /> Frozen: {js.join(' and ')} filed and accepted
    </span>
  )
}

function Steps() {
  const { state } = useWorkspace()
  return (
    <ol className="flex flex-col gap-2">
      {state.steps.map((s) => (
        <li key={s.n} className="flex gap-2 text-sm">
          {s.ok ? (
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="met" />
          ) : (
            <CircleXIcon className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="not met" />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <RefLink to={`step:${s.n}`} className="text-foreground">
              {s.n}. {s.label}
            </RefLink>
            <ReasonList reasons={s.reasons} />
          </div>
        </li>
      ))}
    </ol>
  )
}

const SPOUSE: Record<SpouseStatus, { label: string; className: string }> = {
  not_requested: { label: 'Not requested', className: 'text-muted-foreground' },
  pending: { label: 'Pending', className: 'text-amber-800 dark:text-amber-300' },
  approved: { label: 'Approved', className: 'text-emerald-800 dark:text-emerald-300' },
  reopened: { label: 'Reopened: amounts changed', className: 'text-orange-800 dark:text-orange-300' },
}

function Approval() {
  const { model, state, identities } = useWorkspace()
  const ap = state.approval
  const gate = state.gates.request_approval
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ActButton type="request_approval" target="return" size="sm">
          {ap ? 'Request approval again' : 'Request approval'}
        </ActButton>
        {ap && (
          <span className="text-xs text-muted-foreground">
            Requested by {nameOf(ap.requested_by)} (<RefLink to={`act:${ap.request_seq}`}>#{ap.request_seq}</RefLink>) ·{' '}
            {ap.current ? 'amounts unchanged since' : 'amounts changed since: a new request is needed'}
          </span>
        )}
      </div>
      {!gate.ok && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Cannot request approval yet:</p>
          <ReasonList reasons={gate.reasons} max={3} />
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {model.packet.firm.client_users.map((u) => {
          const s = SPOUSE[spouseStatus(state, u.id)]
          return (
            <li key={u.id} className="flex items-center gap-2">
              <span className="w-36">{u.name}</span>
              <span className={cn('text-xs font-medium', s.className)}>{s.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Submit() {
  const { state } = useWorkspace()
  const gate = state.gates.submit
  const open = (['federal', 'california'] as const).filter((j) => !state.frozen[j])
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ActButton type="file" target="return" prefill={{ kind: 'submit', jurisdictions: open.length ? open : ['federal', 'california'] }} size="sm">
          Submit {open.length === 1 ? open[0] : 'federal and California'}
        </ActButton>
      </div>
      {gate.ok ? (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">Every filing gate passes.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Filing blocked:</p>
          <ReasonList reasons={gate.reasons} max={3} />
        </div>
      )}
    </div>
  )
}

const RESULT_CLASS = {
  accepted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  held: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
} as const

function Filings() {
  const { state } = useWorkspace()
  if (!state.filings.length) return <p className="text-sm text-muted-foreground">Nothing has been filed in this engagement.</p>
  return (
    <ol className="flex flex-col gap-3">
      {[...state.filings].reverse().map((f) => (
        <FilingItem key={f.seq} filing={f} />
      ))}
    </ol>
  )
}

function FilingItem({ filing: f }: { filing: FilingView }) {
  const { state, identities } = useWorkspace()
  const results = filingResults(state, f)
  const rule = results.find((r) => r.rule)?.rule
  return (
    <li className="flex flex-col gap-1.5 rounded-lg p-3 ring-1 ring-foreground/10 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{f.kind === 'submit' ? 'E-file' : 'Extension'}</span>
        <span>{f.jurisdictions.join(' and ')}</span>
        <span className="text-xs text-muted-foreground">
          by {identities.find((v) => v.id === f.actor)?.name ?? f.actor} · <RefLink to={`act:${f.seq}`}>#{f.seq}</RefLink> ·{' '}
          {f.recorded_at.slice(0, 16).replace('T', ' ')}
        </span>
      </div>
      {results.length === 0 && <p className="text-xs text-muted-foreground">No agency result recorded.</p>}
      <ul className="flex flex-col gap-1">
        {results.map((r) => (
          <li key={r.seq} className="flex flex-col gap-0.5 text-xs">
            <span className="flex flex-wrap items-center gap-2">
              <span className="w-20 capitalize">{r.jurisdiction}</span>
              <span className={cn('rounded-full px-2 font-medium', RESULT_CLASS[r.status])}>{r.status}</span>
              {r.season_at && <span className="text-muted-foreground">season {r.season_at.slice(0, 10)}</span>}
              {r.retainUntil && <span className="text-muted-foreground">retain until {r.retainUntil.slice(0, 10)} (destruction not implemented)</span>}
            </span>
            {r.errors.map((e) => (
              <span key={e.code} className="pl-22 text-red-800 dark:text-red-300">
                <span className="font-mono">{e.code}</span> {e.message}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {rule && <p className="text-xs text-muted-foreground">Simulation rule: {rule}</p>}
    </li>
  )
}
