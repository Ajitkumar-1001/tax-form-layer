'use client'
// /compare?a=&b= (spec §3.5): claim-level diff between versions, 2024, now and what-ifs; ?since=me shows what changed
// since this viewer last marked the log seen.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Ago, MaskedText, Money, RefLink } from '@/components/atoms'
import { ActButton } from '@/components/acts/act-host'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { type DiffRow, diffSides, sideOptions, sinceMe } from './compare'

const FIELD = 'h-8 rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring'
const PAGE = 60

export function CompareView() {
  const params = useSearchParams()
  const { state } = useWorkspace()
  if (params.get('since') === 'me') return <SinceMeView />
  // v3 → now is empty until someone adjusts, so open on the engine's last change instead.
  const adjusted = state.adjusts.some((v) => !v.reverted)
  return <VersionsView a={params.get('a') ?? (adjusted ? 'v3' : 'v2')} b={params.get('b') ?? (adjusted ? 'now' : 'v3')} />
}

function useNameOf(): (id: string) => string {
  const { identities } = useWorkspace()
  return (id: string) => identities.find((v) => v.id === id)?.name ?? id
}

function VersionsView({ a, b }: { a: string; b: string }) {
  const { model, state } = useWorkspace()
  const router = useRouter()
  const nameOf = useNameOf()
  const [all, setAll] = useState(false)
  const options = sideOptions(model)
  const rows = diffSides(model, state, a, b, nameOf)
  const go = (na: string, nb: string) => router.replace(`/compare?a=${encodeURIComponent(na)}&b=${encodeURIComponent(nb)}`)
  const shown = rows ? (all ? rows : rows.slice(0, PAGE)) : []
  const totalTax = (k: string) => rows?.find((r) => r.key === k)

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 print:p-0">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-lg font-semibold">Compare</h1>
          <p className="text-sm text-muted-foreground">
            Line-level differences, each attributed to an engine version (system) or one of our adjustments by name.{' '}
            <Link href="/compare?since=me" className="text-primary underline-offset-2 hover:underline">
              What changed since I last looked
            </Link>
          </p>
        </div>
        <label className="flex flex-col gap-0.5 text-xs">
          From (a)
          <select value={a} onChange={(e) => go(e.target.value, b)} className={FIELD}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          To (b)
          <select value={b} onChange={(e) => go(a, e.target.value)} className={FIELD}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={() => go(b, a)} className="print:hidden">
          Swap
        </Button>
      </header>

      {[a, b].filter((s) => s.startsWith('whatif:')).map((s) => (
        <WhatIfPanel key={s} id={s.slice('whatif:'.length)} />
      ))}

      {!rows ? (
        <p className="text-sm text-destructive">Unknown side. Pick v1, v2, v3, 2024, now or a what-if.</p>
      ) : (
        <>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {rows.length} line{rows.length === 1 ? '' : 's'} differ between <b>{a}</b> and <b>{b}</b>.
            {(['F1040.24', 'F540NR.64'] as const).map((k) => {
              const r = totalTax(k)
              return r ? (
                <span key={k}>
                  {' '}
                  {k === 'F1040.24' ? 'Federal' : 'California'} total tax <Money value={typeof r.a === 'number' ? r.a : null} /> → <Money value={typeof r.b === 'number' ? r.b : null} /> (
                  <Money value={r.delta} signed />
                  ).
                </span>
              ) : null
            })}
          </p>
          <DiffTable rows={shown} />
          {rows.length > PAGE && (
            <Button size="sm" variant="outline" onClick={() => setAll(!all)} className="self-start print:hidden">
              {all ? `Show the largest ${PAGE}` : `Show all ${rows.length}`}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function DiffTable({ rows }: { rows: DiffRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No differences.</p>
  return (
    <div className="overflow-x-auto rounded-md border print:overflow-visible">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">Line</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Description</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">a</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">b</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Δ</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Attribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t align-top">
              <td className="px-2 py-1 whitespace-nowrap">
                {r.ref ? <RefLink to={r.ref} /> : <span className="font-mono text-[0.9em]">{r.key}</span>}
              </td>
              <td className="min-w-48 px-2 py-1">{r.label}</td>
              <ValueCell v={r.a} context={r.key} />
              <ValueCell v={r.b} context={r.key} />
              <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums">
                {r.delta === null ? '' : <Money value={r.delta} signed />}
              </td>
              <td className="min-w-40 px-2 py-1">
                {r.by.map((x, i) => (
                  <div key={i}>
                    {x.ref ? <RefLink to={x.ref}>{x.text}</RefLink> : x.text}
                    {x.detail && (
                      <>
                        : <MaskedText text={x.detail} context={x.ref ?? r.key} />
                      </>
                    )}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ValueCell({ v, context }: { v: DiffRow['a']; context: string }) {
  return (
    <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums">
      {typeof v === 'number' ? <Money value={v} /> : v === null ? <span className="text-muted-foreground/50">—</span> : <MaskedText text={v} context={context} />}
    </td>
  )
}

/** The packet's alternative as computed by the engine, and "Adopt…" (a decide{election, what_if} act). */
function WhatIfPanel({ id }: { id: string }) {
  const { model, state } = useWorkspace()
  const nameOf = useNameOf()
  const alt = model.packet.what_if.alternatives.find((x) => x.id === id)
  if (!alt) return null
  const decision = state.claims[`whatif:${id}`]?.decision
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-l-4 border-l-sky-500 p-3 text-sm" aria-label={`What-if ${id}`}>
      <div className="flex min-w-64 flex-1 flex-col gap-0.5">
        <span className="font-medium">
          <RefLink to={`whatif:${id}`}>What-if: {alt.description}</RefLink>
        </span>
        <span className="text-xs text-muted-foreground">
          Engine alternative on {alt.base_version}: federal total tax <Money value={alt.federal.total_tax_change} signed />, penalty{' '}
          <Money value={alt.federal.penalty_change} signed />, California total tax <Money value={alt.california.total_tax_change} signed /> ·{' '}
          {alt.changed_lines.length} line{alt.changed_lines.length === 1 ? '' : 's'} change.
        </span>
        {decision && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            Decided by {nameOf(decision.actor)}: <MaskedText text={decision.choice} context={`whatif:${id}`} />
          </span>
        )}
      </div>
      <ActButton type="decide" target={`whatif:${id}`} prefill={{ kind: 'election', what_if: id }} size="sm" className="print:hidden">
        Adopt…
      </ActButton>
    </section>
  )
}

function SinceMeView() {
  const ws = useWorkspace()
  const { model, state, lastSeenSeq, markSeen, viewer } = ws
  const nameOf = useNameOf()
  const s = sinceMe(model, state, viewer.id, lastSeenSeq)
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 print:p-0">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-lg font-semibold">Since I last looked</h1>
          <p className="text-sm text-muted-foreground">
            Acts by others after #{lastSeenSeq} and findings that became visible as the season clock moved.{' '}
            <Link href="/compare" className="text-primary underline-offset-2 hover:underline">
              Compare versions
            </Link>
          </p>
        </div>
        <Button size="sm" onClick={markSeen} disabled={state.head <= lastSeenSeq} className="print:hidden">
          Mark seen (#{state.head})
        </Button>
      </header>
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status">
        {s.summary}
      </p>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Acts by others ({s.acts.length})</h2>
        {s.acts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing new from others.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {['Act', 'When', 'By', 'What', 'Target', 'Detail'].map((h) => (
                    <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...s.acts].reverse().map((a) => (
                  <tr key={a.seq} className="border-t align-top">
                    <td className="px-2 py-1">
                      <RefLink to={`act:${a.seq}`}>#{a.seq}</RefLink>
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <Ago iso={a.recorded_at} />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{nameOf(a.actor)}</td>
                    <td className="px-2 py-1">{a.type.replaceAll('_', ' ')}</td>
                    <td className="px-2 py-1">
                      <RefLink to={a.target} />
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      <div className="line-clamp-2 max-w-md">
                        <MaskedText text={actDetail(a.body)} context={a.target} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Findings newly visible ({s.findings.length})</h2>
        {s.findings.length === 0 ? (
          <p className="text-xs text-muted-foreground">No findings became visible since then.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {s.findings.map((f) => (
              <li key={f.id}>
                <RefLink to={f.id}>{f.title}</RefLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The headline field of an act body: reason, text, choice or disposition. Clipped by CSS, never mid-token. */
function actDetail(body: Record<string, unknown>): string {
  for (const k of ['reason', 'text', 'choice', 'disposition', 'resolution', 'level']) {
    const v = body[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}
