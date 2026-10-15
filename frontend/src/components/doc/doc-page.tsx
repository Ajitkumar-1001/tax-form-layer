'use client'
// One document page from the workspace packet, drawn by SimulatedPage, with the traced reads listed under it.
// Key it by doc + page at the call site: the pager keeps its own page.
import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { refHref } from '@/components/atoms/format'
import { MaskedText } from '@/components/atoms/masked-text'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { cn } from '@/lib/utils'
import { simulatedRenderer } from './simulated-page'
import { type Anchor, anchorsFor, anchorWarnings, documentSource, formatRead } from './source'

interface DocPageProps {
  doc: string
  page?: number
  /** Reads to highlight strongly and list under the page. */
  focus?: string[]
  /** Show prev/next for multi-page documents. */
  pager?: boolean
  className?: string
}

export function DocPage({ doc, page, focus = [], pager = false, className }: DocPageProps) {
  const { model, state } = useWorkspace()
  const d = model.docs[doc]
  const [current, setCurrent] = useState(page ?? d?.pages[0]?.page ?? 1)
  if (!d) return <p className="text-sm text-muted-foreground">Document {doc} is not in the packet.</p>
  const source = documentSource(d)
  const anchors = anchorsFor(source, model.evByDoc[doc] ?? [], current)
  const traced = anchors.filter((a) => focus.includes(a.ev))
  const arrives = model.knownAt(doc)
  const later = arrives > state.clock
  const pages = d.pages.map((p) => p.page)
  const at = pages.indexOf(current)

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {later && (
        <p className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
          Not yet in file: {doc} arrives {arrives.slice(0, 10)}, after the season clock.
        </p>
      )}
      <div className={cn(later && 'opacity-50 grayscale')}>
        {simulatedRenderer.render(source, current, anchors, focus)}
      </div>
      {pager && pages.length > 1 && (
        <nav className="flex items-center justify-center gap-2 text-xs" aria-label={`${doc} pages`}>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Previous page" disabled={at <= 0} onClick={() => setCurrent(pages[at - 1])}>
            <ChevronLeftIcon />
          </Button>
          <span className="tabular-nums">page {current} of {d.page_count}</span>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Next page" disabled={at >= pages.length - 1} onClick={() => setCurrent(pages[at + 1])}>
            <ChevronRightIcon />
          </Button>
        </nav>
      )}
      {traced.length > 0 && <ReadList anchors={traced} />}
    </div>
  )
}

/** The extracted value beside what the page prints, with the reader's warnings. */
export function ReadList({ anchors }: { anchors: Anchor[] }) {
  return (
    <ul className="grid gap-1 text-xs">
      {anchors.map((a) => {
        const warnings = anchorWarnings(a)
        return (
          <li key={a.ev} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-muted/60 px-2 py-1">
            <Link href={refHref(a.ev)} className="font-mono text-primary hover:underline">{a.ev}</Link>
            <span className="text-muted-foreground">{a.label}</span>
            <span>
              stored <span className="font-mono tabular-nums"><MaskedText text={formatRead(a)} context={a.ev} /></span>
            </span>
            <span>
              read <span className="font-mono">{a.text_as_read ? <MaskedText text={a.text_as_read} context={a.ev} /> : '(nothing)'}</span>
            </span>
            {a.match === 'equivalent' && <span className="text-muted-foreground">printed in another format</span>}
            <span className="text-muted-foreground tabular-nums">conf {a.confidence.toFixed(2)}</span>
            {warnings.map((w) => (
              <span key={w} className="rounded bg-amber-100 px-1 text-amber-950 dark:bg-amber-950 dark:text-amber-100">{w}</span>
            ))}
          </li>
        )
      })}
    </ul>
  )
}
