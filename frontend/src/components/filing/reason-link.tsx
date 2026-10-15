'use client'
import Link from 'next/link'
import { RefLink } from '@/components/atoms'
import type { Reason } from '@/lib/model/state'

/** A gate or step reason, linked to where it is fixed: a page ("/…") or a ref (/r/<ref>). */
export function ReasonLink({ reason }: { reason: Reason }) {
  if (!reason.ref) return <span>{reason.text}</span>
  if (reason.ref.startsWith('/')) {
    return (
      <Link href={reason.ref} className="text-primary underline-offset-2 hover:underline">
        {reason.text}
      </Link>
    )
  }
  return <RefLink to={reason.ref}>{reason.text}</RefLink>
}

/** Reasons as a list; past `max`, the rest fold into a disclosure. */
export function ReasonList({ reasons, max = Infinity }: { reasons: Reason[]; max?: number }) {
  if (!reasons.length) return null
  const item = (r: Reason, i: number) => (
    <li key={i}>
      <ReasonLink reason={r} />
    </li>
  )
  return (
    <div className="text-xs">
      <ul className="flex list-disc flex-col gap-0.5 pl-5">{reasons.slice(0, max).map(item)}</ul>
      {reasons.length > max && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground">{reasons.length - max} more</summary>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">{reasons.slice(max).map((r, i) => item(r, i + max))}</ul>
        </details>
      )}
    </div>
  )
}
