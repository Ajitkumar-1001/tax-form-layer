// Pure formatting helpers shared by the atoms (and usable anywhere, server or browser).
import type { Model } from '@/lib/model/build'
import { parsePageRef } from '@/lib/model/ids'

/** URL of any claim, document, act or finding: `/r/<URI-encoded ref>`. */
export const refHref = (ref: string): string => `/r/${encodeURIComponent(ref)}`

/** Human label for a ref, for link titles: claim, finding, extracted value or document page. */
export function refLabel(model: Model, ref: string): string | undefined {
  const page = parsePageRef(ref)
  if (page) return `${model.docs[page.doc]?.title ?? page.doc}, page ${page.page}`
  return model.claims[ref]?.label ?? model.findingsById[ref]?.title ?? model.ev[ref]?.label
}

const dollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1234 → "1,234", 1234.5 → "1,234.50"; negatives use a true minus; `signed` adds "+" to positives; null → "—". */
export function formatMoney(value: number | null | undefined, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const r = Math.round(value * 100) / 100
  if (r === 0) return '0'
  const abs = Number.isInteger(r) ? dollars.format(Math.abs(r)) : cents.format(Math.abs(r))
  if (r < 0) return `−${abs}`
  return signed ? `+${abs}` : abs
}

/** "Ama Okafor-Lindqvist" → "AO": the first letters of the first two words, for avatars. */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

/** "2026-06-23T06:05:00Z" → "2026-06-23 06:05" (packet and season times are UTC). */
export const formatClock = (iso: string): string => iso.slice(0, 16).replace('T', ' ')

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity],
]

/** Relative time of `iso` seen from `nowMs`: "3 minutes ago", "in 2 days", "just now". */
export function relativeTime(iso: string, nowMs: number): string {
  let n = (Date.parse(iso) - nowMs) / 1000
  if (Number.isNaN(n)) return iso
  if (Math.abs(n) < 45) return 'just now'
  for (const [unit, size] of STEPS) {
    if (Math.abs(n) < size) return rtf.format(Math.round(n), unit)
    n /= size
  }
  return iso
}
