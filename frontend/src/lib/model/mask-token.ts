// Sensitive values never leave the server in clear. The server replaces each one with a token:
//   «ssn·3309·eq:Kq7xT2»   kind · last 4 · equality tag (HMAC of the normalised value)
// Equal tags mean equal values, so checks and uncleared staff can see "•••-••-3309 ≠ •••-••-3390"
// without unmasking. Full values come only through POST /api/reveal, which logs first.

export type MaskKind = 'ssn' | 'ein' | 'account' | 'routing' | 'ip_pin' | 'pin'

export interface MaskToken {
  kind: MaskKind
  last4: string
  eq: string
  raw: string // the token text itself
}

// last4 is at most 4 alphanumerics: a longer "last4" would smuggle a clear value inside a token.
export const MASK_RE = /«(ssn|ein|account|routing|ip_pin|pin)·([0-9A-Za-z]{0,4})·eq:([A-Za-z0-9_-]{1,32})»/g

export function makeToken(kind: MaskKind, last4: string, eq: string): string {
  return `«${kind}·${last4}·eq:${eq}»`
}

export function parseToken(s: string): MaskToken | null {
  const m = new RegExp(MASK_RE.source).exec(s)
  return m ? { kind: m[1] as MaskKind, last4: m[2], eq: m[3], raw: m[0] } : null
}

export const isMasked = (v: unknown): v is string => typeof v === 'string' && new RegExp(MASK_RE.source).test(v)

/** Split free text into plain strings and tokens, for rendering. */
export function splitMasked(text: string): (string | MaskToken)[] {
  const out: (string | MaskToken)[] = []
  let last = 0
  for (const m of text.matchAll(MASK_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    out.push({ kind: m[1] as MaskKind, last4: m[2], eq: m[3], raw: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function displayMasked(t: Pick<MaskToken, 'kind' | 'last4'>): string {
  switch (t.kind) {
    case 'ssn':
      return `•••-••-${t.last4}`
    case 'ein':
      return `••-•••${t.last4}`
    default:
      return `••••${t.last4}`
  }
}

/** Equality of two possibly-masked values (token tags or plain strings). */
export function sameValue(a: unknown, b: unknown): boolean {
  const ta = typeof a === 'string' ? parseToken(a) : null
  const tb = typeof b === 'string' ? parseToken(b) : null
  if (ta && tb) return ta.eq === tb.eq
  return a === b
}
