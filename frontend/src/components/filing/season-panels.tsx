'use client'
// Packet facts about the extension and the rest of the season (spec 3 §8.2, §8.3). Shown as the packet's record, never as
// our acts. Body only: filing-page.tsx writes each section, its heading and its hint.
import { formatClock, MaskedText, Money, refHref } from '@/components/atoms'
import { useWorkspace } from '@/components/workspace/context'
import { plainMasked } from '@/lib/model/mask-token'
import { extensionTranscript, seasonRecord } from './filing-logic'
import { amount, cap, JUR, JURS, labelOf, nameOf, plainKey } from './filing-status'
import { A } from './item-list'

const EXT_EVENT = 'extension-2026-04-14'

/** A packet figure: a number as money, packet text through MaskedText. */
function Figure({ value }: { value: number | string }) {
  return typeof value === 'number' ? <Money value={value} /> : <MaskedText text={value} context="return" />
}

/** Packet e-file records name their jurisdiction as a plain string. */
const jurWord = (j: string): string => cap(j === 'federal' || j === 'california' ? JUR[j] : j)

export function ExtensionPanel() {
  const { model, state } = useWorkspace()
  const p = model.packet
  const ev = p.timeline.find((t) => t.id === EXT_EVENT)
  const ext = p.what_if.extension
  const transcript = extensionTranscript(p, state.clock)
  const chk60 = model.findings.filter((f) => f.check === 'CHK-60' && state.findings[f.id]?.visible)
  return (
    <div className="flex flex-col gap-4 text-sm">
      {ev?.actor && (
        <p className="max-w-prose">
          <MaskedText
            text={`${nameOf(model, ev.actor)} filed the extension on ${ev.at.slice(0, 10)}: Form 4868 with ${amount(ext.federal.paid_with_form_4868)} (federal) and FTB 3519 with ${amount(ext.california.paid_with_ftb_3519)} (California), sized from return version ${ext.based_on_version.replace(/^v/, '')}.`}
            context="return"
          />
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {JURS.map((j) => (
          <div key={j} className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">{`${cap(JUR[j])} estimate`}</h4>
            {/* The paid_with_* rows are left out: the sentence above states them. */}
            <dl className="flex flex-col gap-0.5 text-xs">
              {Object.entries(ext[j])
                .filter(([k]) => !k.startsWith('paid_with_'))
                .map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">{plainKey(k)}</dt>
                    <dd className="min-w-0 text-right">
                      <Figure value={v} />
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-medium text-muted-foreground">
          {transcript.asOf ? `IRS account transcript (as of ${transcript.asOf})` : 'IRS account transcript'}
        </h4>
        {transcript.rows.length ? (
          <>
            <p className="text-xs text-muted-foreground">Code 460 is an extension payment; code 670 is an estimated tax payment.</p>
            <table className="w-full max-w-xl text-xs">
              <tbody>
                {transcript.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2 tabular-nums">{r.date}</td>
                    <td className="py-1 pr-2 font-mono">{r.code}</td>
                    <td className="py-1 pr-2">
                      <MaskedText text={r.description} context="return" />
                    </td>
                    <td className="py-1 text-right">
                      <Figure value={r.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No transcript in the file yet.</p>
        )}
        {transcript.later && (
          <p className="text-xs text-muted-foreground">A later transcript (as of {transcript.later}) arrives when the season clock reaches it.</p>
        )}
      </div>
      {chk60.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {chk60.map((f) => (
            <li key={f.id}>
              <A href={refHref(f.id)}>{plainMasked(f.title)}</A>
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
  const n = upcoming.length
  return (
    <div className="flex flex-col gap-3 text-sm">
      {passed.length === 0 ? (
        <p className="text-xs text-muted-foreground">The season clock has not passed any of them yet.</p>
      ) : (
        <ol className="flex flex-col divide-y">
          {passed.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 py-2">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs tabular-nums text-muted-foreground">{formatClock(e.at)}</span>
                <span className="font-medium">{e.event}</span>
                {e.event === 'notice received' && (
                  <A href="/notice" className="text-xs">
                    Open the notice room
                  </A>
                )}
              </span>
              {e.detail && (
                <span className="text-xs text-muted-foreground">
                  <MaskedText text={e.detail} context={`timeline:${e.id}`} />
                </span>
              )}
              {e.efile.map((x) => (
                <span key={x.submission_id} className="text-xs">
                  {`${jurWord(x.jurisdiction)}: `}
                  <span className="font-medium">{x.status.replaceAll('_', ' ')}</span>
                  {x.errors.map((er) => (
                    <span key={er.code}>
                      {' · '}
                      <span className="font-mono">{er.code}</span> <MaskedText text={er.message} context={`timeline:${e.id}`} />
                    </span>
                  ))}
                </span>
              ))}
              {e.refs.length > 0 && (
                <span className="flex flex-wrap gap-x-3 text-xs">
                  {e.refs.map((r) => (
                    <A key={r} href={refHref(r)}>
                      {plainMasked(labelOf(model, r))}
                    </A>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {n > 0 && <p className="text-xs text-muted-foreground">{`${n} more packet ${n === 1 ? 'event' : 'events'} later in the season.`}</p>}
    </div>
  )
}
