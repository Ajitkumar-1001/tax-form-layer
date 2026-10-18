'use client'
// Sign-offs (spec 3 §6), body only: the section shell, heading and hint are filing-page.tsx's. One row per area plus the
// whole return, three levels each. signoffView judges every cell for this viewer with the workspace's own can().
import type { ReactElement } from 'react'
import { CircleCheckIcon, RotateCcwIcon } from 'lucide-react'
import { ActButton } from '@/components/acts/act-host'
import { MaskedText } from '@/components/atoms'
import { useWorkspace } from '@/components/workspace/context'
import { cap, type SignoffCellView, type SignoffRowView, signoffView } from './filing-status'
import { A, ItemList } from './item-list'

export function SignoffMatrix(): ReactElement {
  const { model, state, viewer, can } = useWorkspace()
  const { rows, note } = signoffView(model, state, viewer, can)
  return (
    <div className="flex flex-col gap-2">
      {note && <p data-refusal className="text-xs text-muted-foreground">You cannot sign off here: <MaskedText text={note} context="return" /></p>}
      <div>
        <div aria-hidden className="hidden gap-x-4 text-xs text-muted-foreground md:grid md:grid-cols-[11rem_1fr_1fr_1fr]">
          <span>Area</span>
          <span>Preparer</span>
          <span>Reviewer</span>
          <span>Partner</span>
        </div>
        <ul className="flex flex-col divide-y">
          {rows.map((r) => (
            <SignoffRow key={r.target} row={r} />
          ))}
        </ul>
      </div>
    </div>
  )
}

/** One row, a focus return (`data-focus-return`): when the viewer's own Sign or Re-sign here is recorded, its button
 * unmounts and the closing act dialog focuses the row instead (act-host.tsx, returnFocusTo). */
function SignoffRow({ row }: { row: SignoffRowView }) {
  return (
    <li
      id={row.anchor}
      data-focus-return
      tabIndex={-1}
      className="grid scroll-mt-44 gap-x-4 gap-y-1 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[11rem_1fr_1fr_1fr] lg:scroll-mt-20"
    >
      <div className="font-medium">{row.href ? <A href={row.href}>{row.label}</A> : row.label}</div>
      {row.cells.map((c) => (
        <SignoffCell key={c.level} cell={c} rowLabel={row.label} />
      ))}
    </li>
  )
}

function SignoffCell({ cell: c, rowLabel }: { cell: SignoffCellView; rowLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs text-muted-foreground md:sr-only">{cap(c.level)}</span>
      {c.state === 'empty' && <span className="text-muted-foreground">{c.whoSigns ? `Not signed; ${c.whoSigns}` : 'Not signed'}</span>}
      {c.state === 'valid' && (
        <span className="inline-flex items-center gap-1 text-success">
          <CircleCheckIcon aria-hidden className="size-3.5 shrink-0" />
          {`Signed by ${c.by}`}
        </span>
      )}
      {c.state === 'reopened' && (
        <>
          <span className="inline-flex items-center gap-1 text-warning">
            <RotateCcwIcon aria-hidden className="size-3.5 shrink-0" />
            {`Changed after ${c.by} signed`}
          </span>
          <ItemList what="Changed" refs={c.changed} step={null} />
          {c.since.length > 0 && <span className="text-xs text-muted-foreground">{`Since then: ${c.since.join('; ')}`}</span>}
        </>
      )}
      {c.action ? (
        <ActButton type="signoff" target={c.target} prefill={{ level: c.level }} size="xs" variant="outline">
          {c.action}
          <span className="sr-only">{` ${rowLabel}, ${c.level}`}</span>
        </ActButton>
      ) : (
        c.refusal && <span data-refusal className="text-xs text-muted-foreground"><MaskedText text={c.refusal} context={c.target} /></span>
      )}
    </div>
  )
}
