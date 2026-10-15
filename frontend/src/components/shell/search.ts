// ⌘K search over claims (lines, documents, facts, comms, steps, decisions). Pure, so it is tested.
import type { Claim, ClaimKind } from '@/lib/model/claims'

export const KIND_LABEL: Record<ClaimKind, string> = {
  line: 'Line', doc: 'Document', comm: 'Client', fact: 'Household', step: 'Step', whatif: 'What-if', diag: 'Diagnostic', prior_item: 'Prior year',
}

/**
 * Every whitespace-separated term must appear in the id or the label (case-insensitive).
 * Ranked: exact id, id prefix, id contains the query, label only; ties keep packet order.
 * An empty query lists every document (the limit applies to searches only).
 */
export function searchClaims(claims: Claim[], query: string, limit: number): Claim[] {
  const q = query.trim().toLowerCase()
  if (!q) return claims.filter((c) => c.kind === 'doc')
  const terms = q.split(/\s+/)
  const hits: [number, Claim][] = []
  for (const c of claims) {
    const id = c.id.toLowerCase()
    const hay = `${id} ${c.label.toLowerCase()}`
    if (!terms.every((t) => hay.includes(t))) continue
    hits.push([id === q ? 0 : id.startsWith(q) ? 1 : id.includes(q) ? 2 : 3, c])
  }
  return hits
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, c]) => c)
}

/** The palette's claim group: at most `limit` search hits, headed "first N" only when more than N match. */
export function paletteHits(claims: Claim[], query: string, limit: number): { hits: Claim[]; heading: string } {
  if (!query.trim()) {
    const docs = searchClaims(claims, query, limit)
    return { hits: docs, heading: `All documents (${docs.length})` }
  }
  const found = searchClaims(claims, query, limit + 1) // one extra tells "exactly N" from "more than N"
  return { hits: found.slice(0, limit), heading: `Claims and documents (${found.length > limit ? `first ${limit}` : found.length})` }
}
