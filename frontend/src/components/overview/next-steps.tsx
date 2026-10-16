'use client'
// Your next steps (spec §4.4): the viewer's one most valuable action, then up to five items for their role. Acts open the
// same pre-filled dialog as everywhere else, through OvAct, so a refusal reads the same way on the whole page.
import { useId } from 'react'
import Link from 'next/link'
import { refHref } from '@/components/atoms'
import { buttonVariants } from '@/components/ui/button'
import type { NextItem, NextKind, NextSteps } from './overview-model'
import { OvAct, OvMasked } from './replay-safe'

// The verb on an item's act button; the item's own text names what it acts on.
const ACT_LABEL: Partial<Record<NextKind, string>> = {
  signoff_owed: 'Sign off',
  request_approval: 'Request',
  return_signoff: 'Sign off',
  reassign: 'Reassign',
}

export function NextStepsSection({ next }: { next: NextSteps }) {
  const { top, items, total } = next
  return (
    <section aria-labelledby="ov-next" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="ov-next" className="text-base font-semibold">
          Your next steps
        </h2>
        {/* The list stops at five (spec §4.3); say how many more there are, so a cut is never silent. Only a preparer's
            checklist has a longer home to link to: the queue. In the heading's row, as the blockers' count is, so
            "Money at stake" starts in a 1440x900 first screen (spec §8). */}
        {total > items.length && (
          <p className="ml-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{`Showing ${items.length} of ${total}`}</span>
            {items.some((i) => i.kind === 'checklist') && (
              <Link href="/queue" className="text-primary underline-offset-2 hover:underline">
                See all in the queue
              </Link>
            )}
          </p>
        )}
      </div>
      {top && <TopStep top={top} />}
      {items.length > 0 && (
        <ul className="flex flex-col divide-y">
          {items.map((item, i) => (
            <Item key={`${item.kind}-${i}`} item={item} />
          ))}
        </ul>
      )}
      {!top && !items.length && <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>}
    </section>
  )
}

/**
 * The one control is the act itself when there is one (the page's only primary button), else a link to the claim. From
 * `sm` it sits beside the text, not under it, so "Money at stake" starts in a 1440x900 first screen (spec §8); a refusal's
 * reason wraps under the button within its column. Like an Item row, it is a group named by its "what", so the page's
 * primary action is never heard as a bare "Start, button".
 */
function TopStep({ top }: { top: NonNullable<NextSteps['top']> }) {
  const id = useId()
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-lg bg-primary/5 p-3 text-sm ring-1 ring-primary/15 ring-inset sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p id={id} className="font-medium wrap-break-word">
          <OvMasked text={top.what} context={top.ref} />
        </p>
        <p className="text-muted-foreground wrap-break-word">
          <OvMasked text={top.why} context={top.ref} />
        </p>
        <p className="wrap-break-word">
          <span className="font-medium">Done when:</span> <OvMasked text={top.doneWhen} context={top.ref} />
        </p>
      </div>
      <div className="flex shrink-0 sm:max-w-56">
        {top.request ? (
          <OvAct request={top.request} whenRefused="explain">
            Start
          </OvAct>
        ) : (
          <Link href={refHref(top.ref)} className={buttonVariants()}>
            Open
          </Link>
        )}
      </div>
    </div>
  )
}

function Item({ item }: { item: NextItem }) {
  const id = useId()
  const control = item.request ? (
    <OvAct request={item.request} whenRefused="explain" size="sm" variant="outline">
      {ACT_LABEL[item.kind] ?? 'Start'}
    </OvAct>
  ) : item.href ? (
    <Link href={item.href} className="text-primary underline-offset-2 hover:underline">
      Open
    </Link>
  ) : null
  return (
    <li>
      {/* A row with a control is a group named by its text, so "Sign off" or "Open" is never heard without its subject. */}
      <div role={control ? 'group' : undefined} aria-labelledby={control ? id : undefined} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm">
        <span id={id} className="min-w-0 flex-1 wrap-break-word">
          <OvMasked text={item.text} context={item.context} />
        </span>
        {control}
      </div>
    </li>
  )
}
