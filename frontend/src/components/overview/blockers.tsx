'use client'
// What blocks filing (spec §4.5): the submit gate's reasons one for one, in step order, each saying who acts and linking
// to where it is fixed. Three show here; the Filing page lists every one.
import Link from 'next/link'
import { CircleCheckIcon, OctagonAlertIcon } from 'lucide-react'
import type { Blockers } from './overview-model'
import { OvMasked } from './replay-safe'

// Three, not the five of spec §4.3: with five, "Money at stake" started below a 1440x900 first screen (spec §8).
const SHOWN = 3

export function BlockersSection({ blockers }: { blockers: Blockers }) {
  const { ok, total, items, beforeApproval } = blockers
  return (
    <section aria-labelledby="ov-blockers" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="ov-blockers" className="text-base font-semibold">
          What blocks filing
        </h2>
        {!ok && <span className="text-sm font-medium text-danger">{`${total} ${total === 1 ? 'reason' : 'reasons'}`}</span>}
        {/* In the heading's row, not under the list: a line less above Money at stake (spec §8). */}
        {!ok && total > SHOWN && (
          <Link href="/filing#steps" className="ml-auto text-sm text-primary underline-offset-2 hover:underline">
            {`See all ${total}`}
          </Link>
        )}
      </div>
      {ok ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
          <span className="font-medium text-success">Every filing gate passes</span>
          <Link href="/filing" className="text-primary underline-offset-2 hover:underline">
            Go to Filing
          </Link>
        </p>
      ) : (
        <ol className="flex flex-col divide-y">
          {items.slice(0, SHOWN).map((b) => (
            <li key={b.step === null ? b.context : `step:${b.step}`} className="flex gap-3 py-2 text-sm">
              <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" />
              <div className="flex min-w-0 flex-col gap-0.5">
                {/* Who acts shares the title's line: one line less per blocker keeps Money at stake in the first screen. */}
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <Link href={b.href} className="font-medium underline-offset-2 hover:underline">
                    {b.step === null ? b.label : `Step ${b.step}: ${b.label}`}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    Who acts: <span className="text-foreground">{b.who}</span>
                  </span>
                </p>
                <p className="text-muted-foreground wrap-anywhere">
                  <OvMasked text={b.text} context={b.context} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {beforeApproval && (
        <p className="flex gap-2 text-sm">
          <OctagonAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>{beforeApproval}</span>
        </p>
      )}
    </section>
  )
}
