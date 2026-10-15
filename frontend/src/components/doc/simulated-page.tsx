'use client'
// SimulatedPage: printed_content drawn as paper, each read <mark>ed where it was found. The packet has no
// page images, so a read with no text match is drawn at its position (fractions of the page) instead.
import Link from 'next/link'
import { MaskedText } from '@/components/atoms/masked-text'
import { refHref } from '@/components/atoms/format'
import { isMasked } from '@/lib/model/mask-token'
import { cn } from '@/lib/utils'
import { segmentText } from './locate'
import { type Anchor, type DocumentSource, formatRead, type PageRenderer, plainMasked, readTitle } from './source'

interface SimulatedPageProps {
  source: DocumentSource
  page: number
  anchors: Anchor[]
  /** Reads drawn strongly (the value being traced); every other read on the page is a faint outline. */
  focus?: string | readonly string[]
  className?: string
}

const asSet = (focus: SimulatedPageProps['focus']): ReadonlySet<string> =>
  new Set(focus === undefined ? [] : typeof focus === 'string' ? [focus] : focus)

export function SimulatedPage({ source, page, anchors, focus, className }: SimulatedPageProps) {
  const pg = source.pages.find((p) => p.page === page)
  const focused = asSet(focus)
  const byEv = new Map(anchors.map((a) => [a.ev, a]))
  const text = pg?.kind === 'text' ? pg.text : ''
  const segments = segmentText(text, anchors.flatMap((a) => (a.textRange ? [{ ev: a.ev, range: a.textRange }] : [])), focused)
  // Unplaced reads are drawn by position when traced. With nothing traced, empty reads are drawn too:
  // "nothing printed, read as 0" is itself evidence. (Positions are synthetic, so they may sit on text.)
  const boxes = anchors.filter((a) => !a.textRange && (focused.has(a.ev) || (focused.size === 0 && a.match === 'empty')))
  const unplacedOther = anchors.filter((a) => a.match === 'missing' && !focused.has(a.ev)).length

  return (
    <figure className={cn('flex min-w-0 flex-col overflow-hidden rounded-md border bg-muted/40', className)} aria-label={`${source.id} page ${page} of ${source.pageCount}`}>
      <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-3 py-1.5 text-xs">
        <Link href={refHref(source.id)} className="font-mono font-medium text-primary hover:underline">{source.id}</Link>
        <span className="min-w-0 flex-1 truncate" title={source.title}>{source.title}</span>
        <Link href={refHref(`doc:${source.id}#page${page}`)} className="whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">
          page {page} of {source.pageCount}
        </Link>
      </figcaption>
      <div className="p-3">
        {!pg ? (
          <p className="text-sm text-muted-foreground">Page {page} is not in this document.</p>
        ) : pg.kind === 'image' ? (
          <p className="text-sm text-muted-foreground">Scanned page images are not rendered in this prototype.</p>
        ) : (
          <div className="relative mx-auto aspect-[8.5/11] w-full max-w-2xl bg-white text-zinc-900 shadow-sm ring-1 ring-black/10 dark:bg-zinc-100">
            <div className="px-[7%] pt-[6%] pb-3 font-mono text-[11.5px] leading-relaxed">
              <p className="mb-3 border-b border-zinc-300 pb-1 text-[10px] tracking-wide text-zinc-900 uppercase">{source.issuer}</p>
              <p className="break-words whitespace-pre-wrap">
                {segments.map((s, i) => {
                  const a = s.ev ? byEv.get(s.ev) : undefined
                  return a ? <ReadMark key={i} anchor={a} text={s.text} strong={focused.has(a.ev)} /> : <MaskedText key={i} text={s.text} context={source.id} />
                })}
              </p>
            </div>
            {boxes.map((a) => <PositionBox key={a.ev} anchor={a} strong={focused.has(a.ev)} />)}
          </div>
        )}
        {unplacedOther > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {unplacedOther} other {unplacedOther === 1 ? 'read' : 'reads'} on this page not found in the printed text.
          </p>
        )}
      </div>
    </figure>
  )
}

function ReadMark({ anchor: a, text, strong }: { anchor: Anchor; text: string; strong: boolean }) {
  const mark = (
    <mark
      title={readTitle(a, text)}
      className={cn(
        'rounded-sm px-0.5 text-inherit',
        strong ? 'bg-yellow-300/80 ring-1 ring-yellow-600' : 'bg-transparent outline-1 -outline-offset-1 outline-sky-500/40 hover:bg-sky-100',
        a.match === 'equivalent' && 'underline decoration-dotted underline-offset-2',
      )}
    >
      <MaskedText text={text} context={a.ev} />
    </mark>
  )
  // A masked read carries a Reveal button, which may not sit inside a link: link beside it instead.
  if (isMasked(text)) {
    return (
      <>
        {mark}
        <Link href={refHref(a.ev)} className="ml-0.5 text-[9px] text-sky-700 hover:underline">{a.ev}</Link>
      </>
    )
  }
  return (
    <Link href={refHref(a.ev)} className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {mark}
    </Link>
  )
}

function PositionBox({ anchor: a, strong }: { anchor: Anchor; strong: boolean }) {
  const { x0, y0, x1, y1 } = a.bbox
  const empty = a.match === 'empty'
  return (
    <div
      style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, minHeight: `${(y1 - y0) * 100}%` }}
      className={cn(
        'absolute rounded-sm border-2 border-dashed px-1 font-sans text-[10px] leading-tight',
        empty ? 'border-amber-600 bg-amber-100/80 text-amber-950' : 'border-red-600 bg-red-100/85 text-red-950',
        !strong && 'opacity-60',
      )}
    >
      <Link href={refHref(a.ev)} title={readTitle(a)} className="hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {empty ? `nothing printed here (read as ${plainMasked(formatRead(a))})` : 'read not found on page'}
      </Link>
      {!empty && (
        <span className="block font-mono">
          read: <MaskedText text={a.text_as_read} context={a.ev} />
        </span>
      )}
    </div>
  )
}

/** The simulated renderer behind the §2.11 interface; an image renderer would implement the same. */
export const simulatedRenderer: PageRenderer = {
  render: (src, page, anchors, focus) => <SimulatedPage source={src} page={page} anchors={anchors} focus={focus} />,
}
