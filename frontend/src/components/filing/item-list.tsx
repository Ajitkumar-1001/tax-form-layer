'use client'
// The links of the filing checklist and the items behind one reason (spec 3 §4.3): every item one click away, shown by
// its label, never by its raw id. Also used by Sign-offs (changed claims) and the partner desk (evidence).
import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'
import { useWorkspace } from '@/components/workspace/context'
import { plainMasked } from '@/lib/model/mask-token'
import { cn } from '@/lib/utils'
import { itemHref, labelOf } from './filing-status'

/** A link: an in-page `#…` target is a plain <a>, any other page goes through next/link. */
export function A({ href, className, title, children }: { href: string; className?: string; title?: string; children: ReactNode }): ReactElement {
  const cls = cn('text-primary underline-offset-2 hover:underline', className)
  return href.startsWith('#') ? (
    <a href={href} className={cls} title={title}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls} title={title}>
      {children}
    </Link>
  )
}

/**
 * The items behind one reason. Labels go through plainMasked, since a link holds no Reveal button. The root is a <div>
 * or a <details>, never a <p>, so it may sit in any block container. Long labels are clamped to two lines by CSS, with
 * the full label in `title`; nothing is cut in the model.
 */
export function ItemList({ what, refs, step }: { what: string; refs: string[]; step: number | null }): ReactElement {
  const { model } = useWorkspace()
  const label = (ref: string) => plainMasked(labelOf(model, ref))
  if (refs.length === 0) return <div>{what}</div>
  // "No valid partner sign-off on the return" links to the Whole return row; "Client approval not requested" to #approval.
  if (refs.length === 1 && refs[0] === 'return') {
    return (
      <div>
        <A href={itemHref(step, 'return')}>{what}</A>
      </div>
    )
  }
  if (refs.length === 1) {
    return (
      <div className="wrap-anywhere">
        {`${what}: `}
        <A href={itemHref(step, refs[0])}>{label(refs[0])}</A>
      </div>
    )
  }
  return (
    <details>
      <summary className="cursor-pointer">{`${what}: ${refs.length} items`}</summary>
      <ul className="mt-1 flex flex-col gap-1 pl-4">
        {refs.map((ref, i) => {
          const l = label(ref)
          return (
            <li key={`${i}:${ref}`}>
              <A href={itemHref(step, ref)} title={l} className="line-clamp-2 wrap-anywhere">
                {l}
              </A>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
