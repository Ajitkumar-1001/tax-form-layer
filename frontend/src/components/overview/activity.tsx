'use client'
// Recent activity (spec §4.9): the latest changes by anyone, the ones new to this viewer marked, and what changed since
// they last looked. Hidden while the dashboard replays (spec §5.3): it describes the live log, and Mark all seen acts on it.
import { use } from 'react'
import Link from 'next/link'
import { formatMoney } from '@/components/atoms'
import { type SinceMe, sinceMe } from '@/components/records/compare'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { VERB, actorName, targetText } from '@/components/workspace/log'
import type { Act } from '@/lib/model/acts'
import { OvMasked, ReplayContext } from './replay-safe'

const SHOWN = 5
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const signed = (n: number) => formatMoney(Math.round(n), true)

/** Acts that share a batch_id read as one change, others stand alone; reveals are records, not changes. Oldest first. */
function batchesOf(acts: Act[]): Act[][] {
  const by = new Map<string, Act[]>()
  for (const a of acts) {
    if (a.type === 'view_sensitive') continue
    const k = a.batch_id ?? `act:${a.seq}`
    by.set(k, [...(by.get(k) ?? []), a])
  }
  return [...by.values()]
}

export function ActivitySection() {
  const replaying = use(ReplayContext)
  const { model, state, viewer, identities, lastSeenSeq, markSeen } = useWorkspace()
  if (replaying) return null
  const batches = batchesOf(state.acts)
  const byOthers = state.acts.filter((a) => a.seq > lastSeenSeq && a.actor !== viewer.id && a.type !== 'view_sensitive').length
  // sinceMe projects the log a second time, so it runs only when there is a log.
  const since = batches.length > 0 ? sinceLine(byOthers, sinceMe(model, state, viewer.id, lastSeenSeq)) : ''
  return (
    <section aria-labelledby="ov-activity" className="flex flex-col gap-3">
      <h2 id="ov-activity" className="text-base font-semibold">
        Recent activity
      </h2>
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-1.5 text-sm">
            {batches
              .slice(-SHOWN)
              .reverse()
              .map((batch) => {
                const a = batch[0]
                const verb = VERB[a.type]
                const what = targetText(a.target)
                const fresh = batch.some((x) => x.seq > lastSeenSeq && x.actor !== viewer.id)
                return (
                  <li key={a.seq} className="min-w-0 leading-snug">
                    {fresh && <span className="mr-1.5 rounded-sm bg-info-soft px-1 py-px text-[11px] font-medium text-info">New</span>}
                    <span className="font-medium">{actorName(identities, a.actor)}</span>
                    {` ${verb.charAt(0).toLowerCase()}${verb.slice(1)}`}
                    {/* The target in plain words ("change 12", an area's label); empty for the season clock. */}
                    {what && (
                      <>
                        {' '}
                        <OvMasked text={what} context={`act:${a.seq}`} />
                      </>
                    )}
                    {batch.length > 1 && ` (${batch.length} changes)`}
                    <span className="text-muted-foreground">{` · ${a.season_at.slice(0, 10)}`}</span>
                  </li>
                )
              })}
          </ol>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {since}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/compare?since=me" className="text-sm text-primary underline-offset-2 hover:underline">
              See all
            </Link>
            <Button type="button" size="sm" variant="outline" onClick={markSeen}>
              Mark all seen
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/** "Since you last looked: …" in plain words. `changes` leaves out reveals, which sinceMe keeps in its act list. */
function sinceLine(changes: number, s: SinceMe): string {
  const parts = [`${plural(changes, 'change', 'changes')} by others`]
  if (s.adjusts) parts.push(`${plural(s.adjusts, 'number', 'numbers')} changed (net Federal ${signed(s.net.fed)}, California ${signed(s.net.ca)})`)
  if (s.findings.length) parts.push(`${plural(s.findings.length, 'issue', 'issues')} newly visible`)
  if (s.reopened) parts.push(`${plural(s.reopened, 'sign-off', 'sign-offs')} changed after signing`)
  return `Since you last looked: ${parts.join(', ')}.`
}
