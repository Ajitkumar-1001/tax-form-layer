// The renderer contract (spec §2.11). Lines, acts and findings cite ev / D## / page ids, never text, so a
// real-scan DocumentSource (image pages) can replace the simulated one without touching anything above it.
import type { ReactNode } from 'react'
import { plainMasked } from '@/lib/model/mask-token'
import type { ExtractedValue, PacketDocument, Position } from '@/lib/model/packet-types'
import { locateReads, type MatchKind, type Range } from './locate'

export interface TextPage {
  page: number
  kind: 'text'
  text: string // printed_content (masked in the browser)
}
/** A real scan or PDF raster. Interface only: no ImagePage renderer is built. */
export interface ImagePage {
  page: number
  kind: 'image'
  url: string
  width: number
  height: number
}

export interface DocumentSource {
  id: string
  title: string
  issuer: string
  pageCount: number
  pages: (TextPage | ImagePage)[]
}

export interface Anchor {
  ev: string
  document_id: string
  page: number
  field: string
  label: string
  value: ExtractedValue['value']
  value_type: string
  text_as_read: string
  confidence: number
  match: MatchKind
  /** Text pages: offsets of text_as_read in the whitespace-normalised printed_content. */
  textRange?: Range
  /** extracted_values[].position, as fractions of the page. */
  bbox: Position
}

export interface PageRenderer {
  render(src: DocumentSource, page: number, anchors: Anchor[], focus?: string | readonly string[]): ReactNode
}

export function documentSource(doc: PacketDocument): DocumentSource {
  return {
    id: doc.id,
    title: doc.title,
    issuer: doc.issuer,
    pageCount: doc.page_count,
    pages: doc.pages.map((p) => ({ page: p.page, kind: 'text', text: p.printed_content })),
  }
}

const byId = (a: ExtractedValue, b: ExtractedValue) => a.id.localeCompare(b.id)

/** Anchors for every extracted value on one page, located in its printed text. */
export function anchorsFor(src: DocumentSource, evs: ExtractedValue[], page: number): Anchor[] {
  const onPage = evs.filter((e) => e.document_id === src.id && e.page === page).sort(byId)
  const pg = src.pages.find((p) => p.page === page)
  const located = pg?.kind === 'text' ? locateReads(pg.text, onPage) : new Map()
  return onPage.map((e) => {
    const loc = located.get(e.id) ?? { match: e.text_as_read.trim() ? 'missing' : 'empty' }
    return {
      ev: e.id, document_id: e.document_id, page: e.page, field: e.field, label: e.label, value: e.value,
      value_type: e.value_type, text_as_read: e.text_as_read, confidence: e.confidence, match: loc.match,
      ...(loc.range && { textRange: loc.range }), bbox: e.position,
    }
  })
}

/** How the extracted value reads in prose: money with cents, the rest as stored. */
export function formatRead(a: Pick<Anchor, 'value' | 'value_type'>): string {
  if (a.value === null) return 'null'
  if (a.value_type === 'money' && typeof a.value === 'number') {
    return a.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(a.value)
}

/** Reader warnings shown beside the printed text. */
export function anchorWarnings(a: Anchor): string[] {
  const out: string[] = []
  if (a.match === 'empty') out.push(`nothing printed, read as ${plainMasked(formatRead(a))}`)
  if (a.match === 'missing') out.push('read not found on page')
  if (a.confidence < 0.9) out.push(`confidence ${a.confidence.toFixed(2)}`)
  return out
}

// Re-exported so the renderer (simulated-page.tsx) takes it with the rest of this contract.
export { plainMasked }

/** Tooltip for a read: a mark over its printed text, or a box where nothing matched. Never carries a token. */
export function readTitle(a: Anchor, printed = ''): string {
  const detail = !a.textRange
    ? anchorWarnings(a).join('; ')
    : `${formatRead(a)}${a.match === 'equivalent' ? ` (read as "${a.text_as_read}", printed as "${printed}")` : ''} · confidence ${a.confidence}`
  return plainMasked(`${a.ev} · ${a.label}: ${detail}`)
}
