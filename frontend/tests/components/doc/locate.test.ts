import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { maskPacket } from '@/lib/server/mask'
import { isMasked, MASK_RE } from '@/lib/model/mask-token'
import type { Packet } from '@/lib/model/packet-types'
import { locateReads, normalizeText, parseAmount, segmentText } from '@/components/doc/locate'
import { anchorsFor, anchorWarnings, documentSource, readTitle } from '@/components/doc/source'

const raw = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const { masked } = maskPacket(raw)

function anchor(p: Packet, ev: string) {
  const e = p.extracted_values.find((x) => x.id === ev)!
  const doc = p.documents.find((d) => d.id === e.document_id)!
  const src = documentSource(doc)
  const a = anchorsFor(src, p.extracted_values, e.page).find((x) => x.ev === ev)!
  const page = src.pages.find((x) => x.page === e.page)!
  return { a, text: page.kind === 'text' ? normalizeText(page.text) : '' }
}

describe('anchors on the real packet', () => {
  it('ev-0016: Box 1 is found verbatim on D08', () => {
    const { a, text } = anchor(raw, 'ev-0016')
    expect(a.match).toBe('exact')
    expect(text.slice(...a.textRange!)).toBe('104,600.00')
    expect(text.slice(a.textRange![0] - 6, a.textRange![0])).toBe('Box 1 ')
  })

  it('ev-0498: empty read on D28 p3 is "nothing printed", placed by position', () => {
    const { a } = anchor(raw, 'ev-0498')
    expect(a.match).toBe('empty')
    expect(a.textRange).toBeUndefined()
    expect(a.bbox).toEqual({ x0: 0.2288, y0: 0.3816, x1: 0.4362, y1: 0.4043 })
    expect(anchorWarnings(a)).toContain('nothing printed, read as 0.00')
  })

  it('ev-1045: the misread provider TIN is not on D62 under any tier', () => {
    const { a } = anchor(raw, 'ev-1045')
    expect(a.match).toBe('missing')
    expect(anchorWarnings(a)).toContain('read not found on page')
  })

  it('finds the same amount or date printed in another format', () => {
    const fee = anchor(raw, 'ev-0003') // read 4,800.00, printed $4,800
    expect(fee.a.match).toBe('equivalent')
    expect(fee.text.slice(...fee.a.textRange!)).toBe('$4,800')
    const trip = anchor(raw, 'ev-0146') // read 01/03/2025, printed 2025-01-03
    expect(trip.a.match).toBe('equivalent')
    expect(trip.text.slice(...trip.a.textRange!)).toBe('2025-01-03')
  })

  it('matches a rate read as a fraction to the printed percent', () => {
    expect(anchor(raw, 'ev-0971').a.match).toBe('equivalent')
  })

  it('leaves a checkbox read as X unmatched rather than guessing', () => {
    expect(anchor(raw, 'ev-0026').a.match).toBe('missing')
  })

  it('places most reads, and never inside a longer number', () => {
    let missing = 0
    for (const d of raw.documents) {
      const src = documentSource(d)
      for (const pg of d.pages) {
        const text = normalizeText(pg.printed_content)
        for (const a of anchorsFor(src, raw.extracted_values, pg.page)) {
          if (a.match === 'missing') missing++
          if (!a.textRange) continue
          const [s, e] = a.textRange
          expect(/[0-9A-Za-z]/.test(text[s - 1] ?? '') && /[0-9A-Za-z]/.test(text[s])).toBe(false)
          expect(/[0-9A-Za-z]/.test(text[e] ?? '') && /[0-9A-Za-z]/.test(text[e - 1])).toBe(false)
        }
      }
    }
    // 890 of 3,012 reads fail a verbatim search. The date and amount tiers place all but the checkbox
    // reads ("X" for prose like "checked") and the real misreads (ev-1045, the CHK-01 values).
    expect(missing).toBeLessThan(55)
  })
})

describe('locateReads', () => {
  it('respects word boundaries', () => {
    const r = locateReads('trip 150 mi; trip 50 mi', [{ id: 'a', text_as_read: '50' }])
    expect(r.get('a')).toEqual({ match: 'exact', range: [18, 20] })
  })

  it('gives two reads of the same text different occurrences', () => {
    const r = locateReads('0.00 then 0.00', [
      { id: 'a', text_as_read: '0.00' },
      { id: 'b', text_as_read: '0.00' },
    ])
    expect(r.get('a')?.range).toEqual([0, 4])
    expect(r.get('b')?.range).toEqual([10, 14])
  })

  it('parses printed amounts', () => {
    expect(parseAmount('(1,234.50)')).toBe(-1234.5)
    expect(parseAmount('$4,800')).toBe(4800)
    expect(parseAmount('Box 1')).toBeNull()
  })
})

describe('masked pages', () => {
  it('matches a masked SSN read to the same token on the page', () => {
    const { a, text } = anchor(masked, 'ev-0012')
    expect(a.match).toBe('exact')
    expect(isMasked(text.slice(...a.textRange!))).toBe(true)
  })

  it('never cuts a token, so a segment is plain text or whole tokens', () => {
    const d = masked.documents.find((x) => x.id === 'D08')!
    const src = documentSource(d)
    const anchors = anchorsFor(src, masked.extracted_values, 1)
    expect(anchors.find((a) => a.ev === 'ev-0016')?.match).toBe('exact')
    const segs = segmentText(
      d.pages[0].printed_content,
      anchors.flatMap((a) => (a.textRange ? [{ ev: a.ev, range: a.textRange }] : [])),
      new Set(['ev-0016']),
    )
    expect(segs.map((s) => s.text).join('')).toBe(normalizeText(d.pages[0].printed_content))
    for (const s of segs) expect(s.text.replace(new RegExp(MASK_RE.source, 'g'), '')).not.toMatch(/[«»]/)
  })

  it('keeps tokens out of tooltips, which are plain strings', () => {
    const { a, text } = anchor(masked, 'ev-0012')
    const printed = text.slice(...a.textRange!)
    expect(isMasked(a.value)).toBe(true)
    for (const t of [readTitle(a, printed), readTitle({ ...a, match: 'equivalent' }, printed), readTitle({ ...a, textRange: undefined, match: 'empty' })]) {
      expect(isMasked(t), t).toBe(false)
      expect(t).not.toMatch(/[«»]/)
      expect(t).toContain('•••-••-')
    }
  })
})

describe('segmentText', () => {
  it('lets the focused read win an overlap and keeps the text whole', () => {
    const segs = segmentText('abc def ghi', [
      { ev: 'a', range: [0, 7] },
      { ev: 'b', range: [4, 11] },
    ], new Set(['b']))
    expect(segs).toEqual([{ text: 'abc ' }, { text: 'def ghi', ev: 'b' }])
  })
})
