// Where an extracted value's text_as_read sits in a page's printed_content. Pure, so it is tested on the
// real packet. Pages are single paragraphs; ranges are offsets into the whitespace-normalised text.
import { MASK_RE } from '@/lib/model/mask-token'

/** exact: the read text is printed verbatim. equivalent: the same date or amount is printed in another
 *  format ("4,800.00" read, "$4,800" printed). empty: nothing was read. missing: not on the page. */
export type MatchKind = 'exact' | 'equivalent' | 'empty' | 'missing'
export type Range = [number, number]

export interface Read {
  id: string
  text_as_read: string
}
export interface Located {
  match: MatchKind
  range?: Range
}

export const normalizeText = (s: string): string => s.replace(/\s+/g, ' ').trim()

const ALNUM = /[0-9A-Za-z]/
const isAlnum = (c: string | undefined): boolean => !!c && ALNUM.test(c)

function tokenSpans(text: string): Range[] {
  return [...text.matchAll(new RegExp(MASK_RE.source, 'g'))].map((m) => [m.index!, m.index! + m[0].length])
}

/** A range may cover a masked token whole, never cut into one (that would show a raw token fragment). */
const cutsToken = (r: Range, tokens: Range[]): boolean =>
  tokens.some(([s, e]) => r[0] < e && s < r[1] && !(r[0] <= s && e <= r[1]))

function exactRanges(text: string, read: string): Range[] {
  const out: Range[] = []
  for (let i = text.indexOf(read); i >= 0; i = text.indexOf(read, i + 1)) {
    const end = i + read.length
    // "50" must not match inside "150 mi"; only checked where the read itself starts/ends with a letter or digit.
    if (isAlnum(read[0]) && isAlnum(text[i - 1])) continue
    if (isAlnum(read.at(-1)) && isAlnum(text[end])) continue
    out.push([i, end])
  }
  return out
}

// ── Equivalent formats: dates and amounts ────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/

function dateKey(s: string): string | null {
  const iso = ISO_DATE.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = US_DATE.exec(s)
  if (!us) return null
  const year = us[3].length === 2 ? `20${us[3]}` : us[3]
  return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
}

/** "(1,234.50)" → -1234.5, "$4,800" → 4800, "6.5%" → 6.5; null when it is not a plain amount. */
export function parseAmount(s: string): number | null {
  const t = s.trim()
  if (!/^\(?[-−]?\$?\d[\d,]*(\.\d+)?\)?%?$/.test(t)) return null
  const neg = (t.startsWith('(') && t.endsWith(')')) || /^\(?[-−]/.test(t)
  const n = Number(t.replace(/[()$,%−-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

const DATE_IN_TEXT = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/g
const AMOUNT_IN_TEXT = /\(?-?\$?\d[\d,]*(?:\.\d+)?\)?%?/g

function scan(text: string, re: RegExp, same: (s: string) => boolean): Range[] {
  const out: Range[] = []
  for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
    const s = m[0].replace(/,+$/, '') // "6,600, basis": the trailing comma is punctuation
    const start = m.index!
    const end = start + s.length
    if (isAlnum(text[start - 1]) || text[start - 1] === '.' || isAlnum(text[end])) continue
    if (same(s)) out.push([start, end])
  }
  return out
}

function equivalentRanges(text: string, read: string): Range[] {
  const date = dateKey(read)
  if (date) return scan(text, DATE_IN_TEXT, (s) => dateKey(s) === date)
  const amount = parseAmount(read)
  if (amount === null) return []
  return scan(text, AMOUNT_IN_TEXT, (s) => {
    const n = parseAmount(s)
    if (n === null) return false
    // A rate read as a fraction (0.22) is printed as a percent (22%).
    return Math.abs(n - amount) < 0.005 || (s.endsWith('%') && Math.abs(n / 100 - amount) < 0.00005)
  })
}

/**
 * Locate every read on one page. Reads are placed in the order given (ev id order), each taking the first
 * occurrence no earlier read has claimed, so two values read as the same text get different spans.
 * The result does not depend on which value is in focus.
 */
export function locateReads(pageText: string, reads: Read[]): Map<string, Located> {
  const text = normalizeText(pageText)
  const tokens = tokenSpans(text)
  const taken: Range[] = []
  const overlaps = (r: Range) => taken.some(([s, e]) => r[0] < e && s < r[1])
  const out = new Map<string, Located>()
  for (const r of reads) {
    const read = normalizeText(r.text_as_read)
    if (!read) {
      out.set(r.id, { match: 'empty' })
      continue
    }
    let match: MatchKind = 'exact'
    let found = exactRanges(text, read).filter((x) => !cutsToken(x, tokens))
    if (!found.length) {
      match = 'equivalent'
      found = equivalentRanges(text, read).filter((x) => !cutsToken(x, tokens))
    }
    if (!found.length) {
      out.set(r.id, { match: 'missing' })
      continue
    }
    const range = found.find((x) => !overlaps(x)) ?? found[0]
    taken.push(range)
    out.set(r.id, { match, range })
  }
  return out
}

// ── Segments for rendering ───────────────────────────────────────────────────────────────

export interface Segment {
  text: string
  ev?: string
}

/**
 * Split the page text into plain runs and marked runs. Overlapping marks cannot nest, so focused reads
 * win, then earlier ones; a read that loses keeps its location but is not drawn on the text.
 */
export function segmentText(pageText: string, placed: { ev: string; range: Range }[], focus: ReadonlySet<string>): Segment[] {
  const text = normalizeText(pageText)
  const order = [...placed].sort((a, b) => Number(focus.has(b.ev)) - Number(focus.has(a.ev)) || a.range[0] - b.range[0])
  const kept: { ev: string; range: Range }[] = []
  for (const p of order) if (!kept.some((k) => p.range[0] < k.range[1] && k.range[0] < p.range[1])) kept.push(p)
  kept.sort((a, b) => a.range[0] - b.range[0])
  const out: Segment[] = []
  let at = 0
  for (const k of kept) {
    if (k.range[0] > at) out.push({ text: text.slice(at, k.range[0]) })
    out.push({ text: text.slice(k.range[0], k.range[1]), ev: k.ev })
    at = k.range[1]
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
