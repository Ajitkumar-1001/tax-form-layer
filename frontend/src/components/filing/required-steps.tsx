'use client'
// Required steps on the filing checklist (spec 3 §4): the 12 derived steps, each red one saying who acts, where it is
// fixed and every item behind it, then the open blocking review notes, so the rows match the submit gate's reasons one
// for one. The tour's `rules` stop rings this section: its <section> and <h2> stay literal here, never an id pass-through.
import { ArrowDownIcon, ArrowRightIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import { MaskedText, refHref } from '@/components/atoms'
import { blockersOf } from '@/components/overview/overview-model'
import { useWorkspace } from '@/components/workspace/context'
import { plainMasked } from '@/lib/model/mask-token'
import type { NoteView, Reason, StepView } from '@/lib/model/state'
import { blockingNotes, labelOf, nameOf, plainWhat, stepFix } from './filing-status'
import { A, ItemList } from './item-list'

export function RequiredSteps(): ReactElement {
  const { model, state } = useWorkspace()
  // Who acts, as on the Overview's blockers: the item for step N, or act:<seq> for a note.
  const blockers = blockersOf(model, state).items
  const notes = blockingNotes(state)
  const done = state.steps.filter((s) => s.ok).length
  return (
    <section aria-labelledby="steps" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="steps" className="scroll-mt-44 text-base font-semibold lg:scroll-mt-20">
          Required steps
        </h2>
        <span className="text-sm text-muted-foreground">{`${done} of ${state.steps.length} done`}</span>
      </div>
      <p className="max-w-prose text-xs text-muted-foreground">Derived from the work, never ticked by hand.</p>
      <ol className="flex flex-col divide-y">
        {state.steps.map((s) => (
          <StepRow key={s.n} step={s} who={blockers.find((b) => b.step === s.n)?.who ?? ''} />
        ))}
      </ol>
      {notes.length > 0 && (
        <>
          <h3 className="text-sm font-semibold">Blocking review notes</h3>
          <ul className="flex flex-col divide-y">
            {notes.map((n) => (
              <NoteRow key={n.seq} note={n} who={blockers.find((b) => b.context === `act:${n.seq}`)?.who ?? ''} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function StepRow({ step: s, who }: { step: StepView; who: string }) {
  return (
    <li id={`step-${s.n}`} className="flex scroll-mt-44 gap-3 py-2 text-sm lg:scroll-mt-20">
      {s.ok ? (
        <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleXIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The label is text: /r/step:N shows the same reasons and nothing more. */}
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-medium">
            {s.n}. {s.label}
          </span>
          {s.ok ? <span className="text-success">Done</span> : <span className="sr-only">Not done</span>}
          {!s.ok && (
            <span className="text-xs text-muted-foreground">
              Who acts: <span className="text-foreground">{who}</span>
            </span>
          )}
          {!s.ok && <FixLink href={stepFix(s).href} srLabel={`step ${s.n}`} />}
        </p>
        {s.reasons.map((r, i) => (
          <ReasonLine key={i} step={s.n} reason={r} />
        ))}
      </div>
    </li>
  )
}

/** An open blocking review note: the step row's markup, with the note's full text (never the gate's clipped copy). */
function NoteRow({ note: n, who }: { note: NoteView; who: string }) {
  const { model } = useWorkspace()
  const by = nameOf(model, n.actor)
  return (
    <li className="flex gap-3 py-2 text-sm">
      <CircleXIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-medium">{`Blocking review note by ${by} on ${plainMasked(labelOf(model, n.target))}`}</span>
          <span className="text-xs text-muted-foreground">
            Who acts: <span className="text-foreground">{who}</span>
          </span>
          <FixLink href={refHref(`act:${n.seq}`)} srLabel={`note by ${by}`} />
        </p>
        <div className="text-muted-foreground wrap-anywhere">
          <MaskedText text={n.text} context={`act:${n.seq}`} />
        </div>
      </div>
    </li>
  )
}

/** "Fix this": an arrow down for a target on this page, right for another page. inline-flex keeps the icon on the
 * text's line (Tailwind's base styles make an <svg> a block). */
function FixLink({ href, srLabel }: { href: string; srLabel: string }) {
  return (
    <A href={href} className="ml-auto inline-flex items-center gap-0.5">
      Fix this<span className="sr-only">: {srLabel}</span>
      {href.startsWith('#') ? <ArrowDownIcon aria-hidden className="size-3.5" /> : <ArrowRightIcon aria-hidden className="size-3.5" />}
    </A>
  )
}

/** One reason under a step: its items through ItemList (every step reason carries refs), else its text, masked. */
function ReasonLine({ step, reason: r }: { step: number; reason: Reason }) {
  return (
    <div className="text-muted-foreground">
      {r.refs ? <ItemList what={plainWhat(r.what ?? r.text)} refs={r.refs} step={step} /> : <MaskedText text={r.text} context={r.ref ?? `step:${step}`} />}
    </div>
  )
}
