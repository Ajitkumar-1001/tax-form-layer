'use client'
// Bulk acts on the picked rows: dispose all with one reason, or (reviewer / partner) accept.
import { useId, useState } from 'react'
import { DISPOSITION_LABEL, DISPOSITION_NEEDS_REF, type DispositionT } from '@/components/acts/draft'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CHOICES = (Object.keys(DISPOSITION_LABEL) as DispositionT[]).filter((d) => !DISPOSITION_NEEDS_REF.has(d))

export function BulkBar({ count, busy, acceptReason, onDispose, onAccept, onClear }: {
  count: number
  busy: boolean
  /** Why this viewer may not accept; null when they may. */
  acceptReason: string | null
  onDispose: (disposition: DispositionT, reason: string) => Promise<boolean>
  onAccept: () => void
  onClear: () => void
}) {
  const [disposition, setDisposition] = useState<DispositionT>('accepted_as_is')
  const [reason, setReason] = useState('')
  const acceptId = useId()
  const disposeId = useId()
  const short = reason.trim().length < 3
  const refused = acceptReason !== null
  return (
    <form
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault()
        // Enter in the reason field submits too, and a busy Dispose is not natively disabled to stop it: one post at a time.
        if (!short && !busy && (await onDispose(disposition, reason.trim()))) setReason('')
      }}
    >
      <span className="font-medium tabular-nums">{count} selected</span>
      <label className="sr-only" htmlFor="bulk-disposition">
        Disposition
      </label>
      <select
        id="bulk-disposition"
        value={disposition}
        onChange={(e) => setDisposition(e.target.value as DispositionT)}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {CHOICES.map((d) => (
          <option key={d} value={d}>
            {DISPOSITION_LABEL[d]}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="bulk-reason">
        Reason (applies to every selected row)
      </label>
      <Input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One reason for all" className="h-7 min-w-40 flex-1 text-xs" />
      {/* A refused or busy button stays focusable (aria-disabled), and a refused one says why in text: a title reaches no
          keyboard or touch user. data-disabled stands in for the native attribute's styles: faded, no hover fill or press nudge. */}
      <Button type="submit" size="sm" variant="outline" disabled={busy || short} focusableWhenDisabled={busy || short} aria-describedby={short ? disposeId : undefined} className="data-disabled:pointer-events-none data-disabled:opacity-50">
        Dispose
      </Button>
      {short && (
        <span id={disposeId} className="text-xs text-muted-foreground">
          Write a reason of at least 3 characters
        </span>
      )}
      <Button type="button" size="sm" variant="outline" disabled={busy || refused} focusableWhenDisabled={busy || refused} aria-describedby={refused ? acceptId : undefined} className="data-disabled:pointer-events-none data-disabled:opacity-50" onClick={onAccept}>
        Accept
      </Button>
      {refused && (
        <span id={acceptId} className="text-xs text-muted-foreground">
          {acceptReason}
        </span>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </form>
  )
}
