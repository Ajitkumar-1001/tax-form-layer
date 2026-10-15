'use client'
// /notice: the IRS Letter 566 room (spec §3.7). Map items to claims, check preconditions, print a response bundle.
import { useState } from 'react'
import { CircleCheckIcon, FileTextIcon, TriangleAlertIcon } from 'lucide-react'
import { MaskedText, Money, RefLink, StatusPill } from '@/components/atoms'
import { ActButton } from '@/components/acts/act-host'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { Val } from '@/lib/model/claims'
import { cn } from '@/lib/utils'
import { actSummary, claimRecord, earlierNotices, findNotice, mapItems, type NoticeRef, preconditions } from './notice-logic'
import { PrintSheet } from './print-sheet'

const value = (v: Val) => (typeof v === 'number' ? <Money value={v} /> : <span>{String(v ?? '—')}</span>)

export function NoticePage() {
  const { model, state } = useWorkspace()
  const [bundle, setBundle] = useState(false)
  const found = findNotice(model, state.clock)
  if (!found) return <p className="p-6 text-sm text-muted-foreground">The packet holds no examination notice.</p>
  const n = found.notice
  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold">
            {n.agency} {n.type}
          </h1>
          <p className="text-sm text-muted-foreground">
            Tax year {n.tax_year}
            {found.received && (
              <>
                {' '}
                · dated {n.dated} · <RefLink to={found.ref} /> · <RefLink to={n.document} />
              </>
            )}
          </p>
        </div>
        {found.received && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setBundle(true)}>
            <FileTextIcon /> Response bundle
          </Button>
        )}
      </header>
      {found.received ? <Received found={found} /> : <NotYet found={found} />}
      {bundle && (
        <PrintSheet title="Notice response bundle" onClose={() => setBundle(false)}>
          <Bundle found={found} />
        </PrintSheet>
      )}
    </div>
  )
}

function NotYet({ found }: { found: NoticeRef }) {
  const { state } = useWorkspace()
  return (
    <div role="status" className="flex max-w-2xl flex-col gap-2 rounded-xl p-4 text-sm ring-1 ring-foreground/10">
      <p className="font-medium">Not yet received.</p>
      <p className="text-muted-foreground">
        The notice arrives {found.knownAt.slice(0, 10)}; the season clock is {state.clock.slice(0, 10)}. The partner or the firm administrator can
        advance the clock to that event to open the notice room.
      </p>
    </div>
  )
}

function Received({ found }: { found: NoticeRef }) {
  const { model, state } = useWorkspace()
  const n = found.notice
  const items = mapItems(model, n)
  const pre = preconditions(model, state.clock, n)
  const earlier = earlierNotices(model, state.clock, found.ref)
  return (
    <>
      <ol className="flex max-w-3xl list-decimal flex-col gap-1 pl-5 text-sm" aria-label="Steps">
        <li>Map each item to the claims and evidence it needs.</li>
        <li>Resolve the preconditions below before answering.</li>
        <li>Print the response bundle.</li>
      </ol>
      <p className="text-sm">
        Response due <span className="font-medium">{n.response_due ?? 'not stated'}</span>.
      </p>

      <section aria-labelledby="pre" className="flex flex-col gap-2">
        <h2 id="pre" className="text-base font-semibold">
          Preconditions
        </h2>
        <ul className="flex flex-col gap-2">
          {pre.map((p) => (
            <li
              key={p.key}
              className={cn(
                'flex gap-2 rounded-lg p-3 text-sm ring-1',
                p.ok ? 'ring-foreground/10' : 'bg-amber-50 ring-amber-300 dark:bg-amber-950 dark:ring-amber-800',
              )}
            >
              {p.ok ? <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />}
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{p.title}</span>
                <span className="text-xs">{p.detail}</span>
                {p.refs.length > 0 && (
                  <span className="flex gap-2 text-xs">
                    {p.refs.map((r) => (
                      <RefLink key={r} to={r} />
                    ))}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="items" className="flex flex-col gap-3">
        <h2 id="items" className="text-base font-semibold">
          Items under examination
        </h2>
        {items.map((it) => (
          <article key={it.n} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
            <header className="flex flex-wrap items-start gap-2">
              <p className="flex-1 text-sm">
                <span className="font-medium">Item {it.n}.</span> {it.text}
              </p>
              {it.claims[0] && (
                <ActButton type="decide" target={it.claims[0]} prefill={{ kind: 'notice_response', question: `Letter 566 item ${it.n}: ${it.text}` }} size="sm" variant="outline">
                  Record response
                </ActButton>
              )}
            </header>
            {it.claims.length === 0 && <p className="text-xs text-muted-foreground">No return line matches this item; map it by hand with a note.</p>}
            <ul className="flex flex-col divide-y">
              {it.claims.map((id) => (
                <ClaimRow key={id} id={id} />
              ))}
            </ul>
          </article>
        ))}
      </section>

      {earlier.length > 0 && (
        <section aria-labelledby="earlier" className="flex flex-col gap-1 text-sm">
          <h2 id="earlier" className="text-base font-semibold">
            Earlier notices in the file
          </h2>
          <ul className="flex flex-col gap-1">
            {earlier.map((e) => (
              <li key={e.ref}>
                <RefLink to={e.ref}>{e.notice.id}</RefLink> ({e.notice.type}, tax year {e.notice.tax_year}): {e.notice.summary}{' '}
                <span className="text-muted-foreground">{e.notice.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ClaimRow({ id }: { id: string }) {
  const { model, state, identities } = useWorkspace()
  const r = claimRecord(model, state, id)
  const nameOf = (a: string) => identities.find((v) => v.id === a)?.name ?? a
  const findings = r.findings.filter((f) => f.visible)
  return (
    <li className="flex flex-col gap-1.5 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <RefLink to={id} />
        <span className="flex-1">{r.label}</span>
        <StatusPill status={r.status} />
        <span className="w-24 text-right">{value(r.effective)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>Evidence:</span>
        {r.sources.length ? r.sources.slice(0, 8).map((s) => <RefLink key={s} to={s} />) : <span>none cited</span>}
        {r.sources.length > 8 && <span>+{r.sources.length - 8}</span>}
      </div>
      {findings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {findings.map((f) => (
            <li key={f.id}>
              <RefLink to={f.id}>{f.title}</RefLink> <span className="text-muted-foreground">({f.status})</span>
            </li>
          ))}
        </ul>
      )}
      {r.acts.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {r.acts.map((a) => (
            <li key={a.seq}>
              <RefLink to={`act:${a.seq}`}>#{a.seq}</RefLink> {nameOf(a.actor)} · {a.season_at.slice(0, 10)} · <MaskedText text={actSummary(a)} context={`act:${a.seq}`} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Self-contained, print-friendly record of the response: values, how built, findings, acts, preconditions, hashes. */
function Bundle({ found }: { found: NoticeRef }) {
  const { model, state, packetSha, engagement, identities } = useWorkspace()
  const n = found.notice
  const nameOf = (a: string) => identities.find((v) => v.id === a)?.name ?? a
  const head = state.acts.at(-1)
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 border-b pb-3">
        <p className="text-xs text-muted-foreground">{model.packet.firm.name} · notice response bundle</p>
        <h2 className="text-lg font-semibold">
          {n.agency} {n.type}, tax year {n.tax_year}
        </h2>
        <p className="text-xs">
          Dated {n.dated} · response due {n.response_due ?? 'not stated'} · prepared {state.clock.slice(0, 10)} (season clock)
        </p>
      </header>
      <section className="flex flex-col gap-1">
        <h3 className="font-medium">Preconditions</h3>
        <ul className="list-disc pl-5 text-xs">
          {preconditions(model, state.clock, n).map((p) => (
            <li key={p.key}>
              {p.ok ? 'OK' : 'OPEN'}: {p.title}. {p.detail}
            </li>
          ))}
        </ul>
      </section>
      {mapItems(model, n).map((it) => (
        <section key={it.n} className="flex flex-col gap-2">
          <h3 className="font-medium">
            Item {it.n}. {it.text}
          </h3>
          {it.claims.map((id) => {
            const r = claimRecord(model, state, id)
            return (
              <div key={id} className="flex flex-col gap-0.5 border-l-2 pl-3 text-xs">
                <p>
                  <span className="font-mono">{id}</span> {r.label}: as filed {typeof r.effective === 'number' ? r.effective.toLocaleString('en-US') : String(r.effective)}
                  {r.effective !== r.original && <> (engine value {String(r.original)})</>} · {r.status}
                </p>
                <p>Built from: {r.sources.join(', ') || 'no sources cited'}</p>
                {r.findings.filter((f) => f.visible).map((f) => (
                  <p key={f.id}>
                    Check {f.id}: {f.title} ({f.status})
                  </p>
                ))}
                {r.acts.map((a) => (
                  <p key={a.seq}>
                    Act #{a.seq} {a.season_at.slice(0, 10)} {nameOf(a.actor)} ({a.actor_role}): <MaskedText text={actSummary(a)} context={`act:${a.seq}`} />
                  </p>
                ))}
              </div>
            )
          })}
        </section>
      ))}
      <footer className="flex flex-col gap-0.5 border-t pt-3 font-mono text-[11px] text-muted-foreground">
        <span>packet sha-256 {packetSha}</span>
        <span>
          engagement {engagement} · act chain head #{head?.seq ?? 0} {head?.hash ?? '(empty log)'}
        </span>
        <span>To verify: hash the delivered packet file and compare; replay the act log and compare the chain head.</span>
      </footer>
    </article>
  )
}
