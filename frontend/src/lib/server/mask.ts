// Masking before transport. Firm rule: "Staff without clearance see SSNs, bank and account numbers and IP PINs
// masked." There is one masked packet for every viewer; clear values stay in `secrets` (server memory) and
// come out only through POST /api/reveal, which logs first.
import 'server-only'
import { createHmac } from 'node:crypto'
import { type MaskKind, type MaskToken, makeToken, splitMasked } from '@/lib/model/mask-token'
import type { Packet } from '@/lib/model/packet-types'

export interface Secret {
  kind: MaskKind
  value: string
}
/** eq tag → clear value. */
export type Secrets = Map<string, Secret>
export type MaskText = (text: string, out: Secrets) => string

function maskSecret(): string {
  const s = process.env.MASK_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('MASK_SECRET must be set in production')
  return 'dev-only-mask-secret'
}

const normalize = (v: string) => v.replace(/[^0-9A-Za-z]/g, '').toUpperCase()

/** Equal normalised values (666-74-3390, 666743390) get equal tags; the tag reveals nothing else. */
export const eqOf = (value: string) =>
  createHmac('sha256', maskSecret()).update(normalize(value)).digest('base64url').slice(0, 10)

/** The tail a token shows: the last 4 tell SSNs and accounts apart; a PIN is 5-6 digits, so it shows none. */
const shownTail = (kind: MaskKind, value: string) => (kind === 'pin' || kind === 'ip_pin' ? '' : normalize(value).slice(-4))

/** The token for one clear value. Records the value in `out` so the server can reveal it later. */
export function tokenize(kind: MaskKind, value: string, out: Secrets): string {
  const eq = eqOf(value)
  if (!out.has(eq)) out.set(eq, { kind, value })
  return makeToken(kind, shownTail(kind, value), eq)
}

/** Every sensitive string, from where the packet keeps it. EINs stay clear: they are not covered and checks read them. */
function collect(p: Packet): Map<string, MaskKind> {
  const found = new Map<string, MaskKind>()
  const add = (kind: MaskKind, v: unknown) => {
    if (typeof v === 'string' && v.trim() && !found.has(v)) found.set(v, kind)
  }
  for (const person of p.household.people) {
    add('ssn', person.ssn)
    add('ip_pin', person.ip_pin)
  }
  const bank = p.household.bank_account_for_refund_or_payment
  add('routing', bank.routing)
  add('account', bank.account)
  for (const d of p.prior_years.return_2024.dependents) add('ssn', d.ssn)
  for (const e of p.extracted_values) {
    // ev-0005 (Ngozi's IP PIN) is value_type 'code', so the field name matters too.
    const kind: MaskKind | null =
      e.value_type === 'ssn' ? 'ssn' : e.value_type === 'account_number' ? 'account' : /ip_pin/.test(e.field) ? 'ip_pin' : null
    if (kind) {
      add(kind, e.value)
      add(kind, e.text_as_read)
    }
  }
  add('pin', p.firm.firm_identity.ero_pin)
  add('pin', p.firm.firm_identity.efin)
  for (const t of p.timeline) for (const m of (t.detail ?? '').matchAll(/\bPIN:?\s*(\d{4,6})\b/g)) add('pin', m[1])
  return found
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A token counts as masked only if the server issued it: its tag is one `issued` knows and its last 4 are that
 * value's. A made-up token («ip_pin·5790·eq:135790») can carry a clear value in either part.
 */
export function issuedToken(t: MaskToken, issued: Secrets): boolean {
  const s = issued.get(t.eq)
  return !!s && makeToken(t.kind, shownTail(t.kind, s.value), t.eq) === t.raw
}

/**
 * Replaces every known sensitive string and every dashed SSN in free text; tokens the server issued (in `issued`
 * or in `out`) are left alone, any other token is masked as plain text.
 * Known values match with or without separators (666-74-3309, 666743309, 666 74 3309 are one value). The generic
 * pattern stays dashed-only: bare 9-digit runs include EINs and routing numbers the checks read.
 */
export function textMasker(known: Map<string, MaskKind>, issued: Secrets = new Map()): MaskText {
  const kindOf = new Map([...known].map(([v, kind]) => [normalize(v), kind] as const).filter(([n]) => n))
  const tolerant = [...kindOf.keys()].sort((a, b) => b.length - a.length).map((n) => [...n].map(escapeRe).join('[- ]?'))
  // A captured (^|non-alnum) prefix instead of a lookbehind: "482915" must not match inside a longer number.
  const re = new RegExp(`(^|[^0-9A-Za-z])(${[...tolerant, '\\d{3}-\\d{2}-\\d{4}'].join('|')})(?![0-9A-Za-z])`, 'gi')
  const plain = (text: string, out: Secrets) =>
    text.replace(re, (_m, pre: string, v: string) => pre + tokenize(kindOf.get(normalize(v)) ?? 'ssn', v, out))
  return (text, out) => {
    let done = ''
    let rest = ''
    for (const part of splitMasked(text)) {
      if (typeof part !== 'string' && (issuedToken(part, issued) || issuedToken(part, out))) {
        done += plain(rest, out) + part.raw
        rest = ''
      } else rest += typeof part === 'string' ? part : part.raw
    }
    return done + plain(rest, out)
  }
}

/** Map every string leaf of a JSON value (`key` is the nearest property name). */
export function mapStrings(v: unknown, f: (s: string, key: string) => string, key = ''): unknown {
  if (typeof v === 'string') return f(v, key)
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f, key))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f, k)]))
  return v
}

export interface MaskedPacket {
  masked: Packet
  secrets: Secrets
  maskText: MaskText
  /** The packet's sensitive strings, so act text can be masked with them plus values the acts introduce. */
  known: Map<string, MaskKind>
}

export function maskPacket(raw: Packet): MaskedPacket {
  const known = collect(raw)
  const secrets: Secrets = new Map()
  const maskText = textMasker(known, secrets)
  const masked = mapStrings(raw, (s) => maskText(s, secrets)) as Packet
  return { masked, secrets, maskText, known }
}

/** Tokenize a new value for a sensitive household fact (household:<id>#ssn | #ip_pin, household#bank_account). */
export function maskFact(ref: string, value: string, out: Secrets): string {
  const field = ref.slice(ref.indexOf('#') + 1)
  if (field === 'bank_account') {
    const parts = value.split('/').map((s) => s.trim())
    return parts.length === 2
      ? `${tokenize('routing', parts[0], out)} / ${tokenize('account', parts[1], out)}`
      : tokenize('account', value, out)
  }
  return tokenize(field === 'ip_pin' ? 'ip_pin' : 'ssn', value, out)
}
