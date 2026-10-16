import { describe, expect, it } from 'vitest'
import type { Claim, ClaimKind } from '@/lib/model/claims'
import { paletteHits, searchClaims } from '@/components/shell/search'

const claim = (id: string, label: string, kind: ClaimKind = 'line'): Claim => ({
  id, label, kind, area: 'payments_and_filing', sources: [], inputs: [], usedBy: [], knownAt: '2026-06-23T06:05:00Z',
})
const claims = [
  claim('D28', 'Brokerage 1099-B (Fidelity)', 'doc'),
  claim('F8949.B.N1', 'NVDA sold 2025-03-03'),
  claim('F1040.1a', 'Wages from W-2'),
  claim('SchD.7', 'Net short-term gain (F8949 box B)'),
]

describe('searchClaims', () => {
  it('ranks id matches before label matches', () => {
    expect(searchClaims(claims, 'f8949', 10).map((c) => c.id)).toEqual(['F8949.B.N1', 'SchD.7'])
  })
  it('requires every term, across id and label', () => {
    expect(searchClaims(claims, '1099 fidelity', 10).map((c) => c.id)).toEqual(['D28'])
    expect(searchClaims(claims, '1099 nvda', 10)).toEqual([])
  })
  it('lists every document for an empty query and limits searches', () => {
    expect(searchClaims(claims, '  ', 10).map((c) => c.id)).toEqual(['D28'])
    expect(searchClaims([...claims, claim('D29', 'Fidelity supplemental', 'doc')], '', 1).map((c) => c.id)).toEqual(['D28', 'D29'])
    expect(searchClaims(claims, 'f', 1)).toHaveLength(1)
  })
})

describe('paletteHits (regression: exactly LIMIT hits were headed "first LIMIT")', () => {
  it('says "first N" only when more than N match', () => {
    expect(paletteHits(claims, 'f8949', 2)).toEqual({ hits: [claims[1], claims[3]], heading: 'Claims and documents (2)' })
    const more = paletteHits(claims, 'f', 2)
    expect(more.hits).toHaveLength(2)
    expect(more.heading).toBe('Claims and documents (first 2)')
  })
  it('lists every document for an empty query, beyond the limit', () => {
    const docs = [claim('D01', 'a', 'doc'), claim('D02', 'b', 'doc'), claim('D03', 'c', 'doc')]
    expect(paletteHits(docs, '', 2)).toEqual({ hits: docs, heading: 'All documents (3)' })
  })
})
