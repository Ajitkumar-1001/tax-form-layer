'use client'
// Packet facts about the extension and the rest of the season. Shown as the packet's record, never as our acts.
import Link from 'next/link'
import { MaskedText, Money, RefLink } from '@/components/atoms'
import { useWorkspace } from '@/components/workspace/context'
import { extensionTranscript, seasonRecord } from './filing-logic'

const EXT_EVENT = 'extension-2026-04-14'
const asMoney = (v: unknown) => (typeof v === 'number' ? <Money value={v} /> : <span>{String(v ?? '—')}</span>)

export function ExtensionPanel() {
  const { model, state, identities } = useWorkspace()
  const p = model.packet
  const ev = p.timeline.find((t) => t.id === EXT_EVENT)
  const ext = p.what_if.extension
  const transcript = extensionTranscript(p, state.clock)
  const chk60 = model.findings.filter((f) => f.check === 'CHK-60' && state.findings[f.id]?.visible)
  const actor = ev?.actor ? (identities.find((v) => v.id === ev.actor)?.name ?? ev.actor) : null
  return (
    <div className="flex flex-col gap-4 text-sm">
      {ev && (
        <p>
          <RefLink to={`timeline:${ev.id}`}>{ev.at.slice(0, 10)}</RefLink>: extension filed with payment by {actor} ({ev.actor}).{' '}
          {ev.detail && <MaskedText text={ev.detail} context={`timeline:${ev.id}`} />}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {(['federal', 'california'] as const).map((j) => (
          <section key={j} className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground uppercase">
              {j} · what_if.extension (from {ext.based_on_version})
            </h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-xs">
              {Object.entries(ext[j]).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k.replaceAll('_', ' ')}</dt>
                  <dd className="text-right">{asMoney(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-medium text-muted-foreground uppercase">
          IRS account transcript, codes 460 and 670 {transcript.asOf && <>(as of {transcript.asOf})</>}
        </h4>
        {transcript.rows.length ? (
          <table className="w-full max-w-xl text-xs">
            <tbody>
              {transcript.rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2 tabular-nums">{r.date}</td>
                  <td className="py-1 pr-2 font-mono">{r.code}</td>
                  <td className="py-1 pr-2">{r.description}</td>
                  <td className="py-1 text-right">{asMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted-foreground">No transcript in the file yet.</p>
        )}
        {transcript.later && (
          <p className="text-xs text-muted-foreground">A later transcript (as of {transcript.later}) arrives when the season clock reaches it.</p>
        )}
      </section>
      {chk60.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {chk60.map((f) => (
            <li key={f.id}>
              <RefLink to={f.id}>{f.title}</RefLink>
              {state.findings[f.id]?.status === 'resolved' && <span className="text-muted-foreground"> (resolved)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SeasonRecord() {
  const { model, state } = useWorkspace()
  const { passed, upcoming } = seasonRecord(model.packet, state.clock)
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">
        What the packet says happened after v3 was computed. These are packet facts shown as the season clock passes them; they are not
        acts in this workpaper and do not change its state.
      </p>
      {passed.length === 0 && <p className="text-xs text-muted-foreground">The season clock has not passed any of them yet.</p>}
      <ol className="flex flex-col gap-2 border-l pl-4">
        {passed.map((e) => (
          <li key={e.id} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">{e.at.slice(0, 16).replace('T', ' ')}</span>
              <span className="font-medium">{e.event}</span>
              <RefLink to={`timeline:${e.id}`} />
              {e.event === 'notice received' && (
                <Link href="/notice" className="text-xs text-primary underline-offset-2 hover:underline">
                  Open the notice room
                </Link>
              )}
            </span>
            {e.detail && (
              <span className="text-xs text-muted-foreground">
                <MaskedText text={e.detail} context={`timeline:${e.id}`} />
              </span>
            )}
            {e.efile.map((x) => (
              <span key={x.submission_id} className="text-xs">
                {x.jurisdiction}: <span className="font-medium">{x.status.replaceAll('_', ' ')}</span>
                {x.errors.map((er) => (
                  <span key={er.code}>
                    {' '}
                    · <span className="font-mono">{er.code}</span> {er.message}
                  </span>
                ))}
              </span>
            ))}
            {e.refs.length > 0 && (
              <span className="flex flex-wrap gap-x-2 text-xs">
                {e.refs.map((r) => (
                  <RefLink key={r} to={r} />
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
      {upcoming.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {upcoming.length} more packet {upcoming.length === 1 ? 'event' : 'events'} ahead; next {upcoming[0].event} on {upcoming[0].at.slice(0, 10)}.
        </p>
      )}
    </div>
  )
}
