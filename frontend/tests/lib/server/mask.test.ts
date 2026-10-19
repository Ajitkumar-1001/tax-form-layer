import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '@/lib/model/build'
import { parseToken, plainMasked, sameValue } from '@/lib/model/mask-token'
import type { Packet } from '@/lib/model/packet-types'
import { maskFact, maskPacket } from '@/lib/server/mask'

const packet = JSON.parse(readFileSync(path.join(process.cwd(), 'data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet

const { masked, secrets, maskText } = maskPacket(packet)
const json = JSON.stringify(masked)

// Every sensitive string the packet holds, gathered independently of mask.ts.
const people = packet.household.people
const bank = packet.household.bank_account_for_refund_or_payment
const collected = [
  ...people.flatMap((p) => [p.ssn, p.ip_pin]),
  bank.routing,
  bank.account,
  ...packet.prior_years.return_2024.dependents.map((d) => d.ssn),
  ...packet.extracted_values
    .filter((e) => ['ssn', 'account_number'].includes(e.value_type) || e.field === 'ip_pin')
    .flatMap((e) => [e.value, e.text_as_read]),
  packet.firm.firm_identity.ero_pin,
  '41207', // tl-20 taxpayer 8879 PIN
  '88310', // tl-20 spouse 8879 PIN
].filter((v): v is string => typeof v === 'string' && v.length > 0)

describe('maskPacket', () => {
  it('leaves none of the collected sensitive strings and no SSN pattern in the masked JSON', () => {
    expect(collected.length).toBeGreaterThan(15)
    for (const v of collected) expect(json.includes(v), v).toBe(false)
    expect(json.match(/\b\d{3}-\d{2}-\d{4}\b/g)).toBeNull()
  })

  it('keeps every clear value revealable on the server', () => {
    const clear = new Set([...secrets.values()].map((s) => s.value))
    for (const v of collected) expect(clear.has(v), v).toBe(true)
  })

  it('gives equal values equal tags (Theo on D06 = 2024 return ≠ organizer)', () => {
    const d06 = masked.extracted_values.find((e) => e.id === 'ev-0012')!.value
    const py = masked.prior_years.return_2024.dependents[1].ssn
    const household = masked.household.people.find((p) => p.id === 'theo')!.ssn
    expect(sameValue(d06, py)).toBe(true)
    expect(sameValue(household, py)).toBe(false)
    expect(parseToken(household)).toMatchObject({ kind: 'ssn', last4: '3309' })
    expect(parseToken(py)).toMatchObject({ kind: 'ssn', last4: '3390' })
  })

  it('masks inside free text and keeps EINs clear', () => {
    const d06 = masked.documents.find((d) => d.id === 'D06')!.pages[0].printed_content
    expect(d06).toMatch(/Theo Lindqvist-Okafor SSN «ssn·3390·eq:/)
    expect(masked.timeline.find((t) => t.id === 'tl-20')!.detail).toMatch(/Taxpayer PIN «pin··eq:/)
    expect(masked.extracted_values.find((e) => e.id === 'ev-0014')!.value).toBe('82-4471903')
  })

  it('does not change what the checks find', () => {
    expect(buildModel(masked).findings.map((f) => f.id)).toEqual(buildModel(packet).findings.map((f) => f.id))
  })

  it('masks stray SSNs in act text and tokenizes a corrected fact to the same tag as the packet', () => {
    const out = new Map()
    expect(maskText('typo, should be 666-74-3390 per D06', out)).not.toMatch(/\d{3}-\d{2}-\d{4}/)
    const fixed = maskFact('household:theo#ssn', '666-74-3390', out)
    expect(sameValue(fixed, masked.prior_years.return_2024.dependents[1].ssn)).toBe(true)
    expect(maskFact('household#bank_account', '123456789 / 000111222', out)).toMatch(/^«routing·6789·eq:.+» \/ «account·1222·eq:.+»$/)
  })

  it('masks known values typed without dashes or with spaces, to the same tags', () => {
    const out = new Map()
    const text = maskText('Theo 666743309 vs 666 74 3390, IBAN se4580000000041277839901, PIN 482 915', out)
    expect(text.replace(/«[^»]+»/g, '')).not.toMatch(/\d/)
    const [organizer, d06, iban, pin] = text.match(/«[^»]+»/g)!
    expect(sameValue(organizer, masked.household.people.find((p) => p.id === 'theo')!.ssn)).toBe(true)
    expect(sameValue(d06, masked.prior_years.return_2024.dependents[1].ssn)).toBe(true)
    expect(parseToken(iban)).toMatchObject({ kind: 'account' })
    expect(parseToken(pin)).toMatchObject({ kind: 'ip_pin', last4: '' })
  })

  it('leaves tokens the server issued alone and masks a made-up token as text', () => {
    const theo = masked.household.people.find((p) => p.id === 'theo')!.ssn
    expect(maskText(`Theo ${theo}`, new Map())).toBe(`Theo ${theo}`)
    const out = new Map()
    expect(maskText('Card «ssn·3456·eq:666-12-3456»', out)).not.toContain('666-12-3456')
    expect([...out.values()]).toEqual([{ kind: 'ssn', value: '666-12-3456' }])
  })

  it('leaves numbers that only contain a known value alone', () => {
    expect(maskText('Ref 14829150 and 4829151', new Map())).toBe('Ref 14829150 and 4829151')
  })

  // A PIN is 5-6 digits: a last-4 tail would show nearly all of it to staff without clearance.
  it('shows no digit of any PIN: packet tokens, free text, a corrected fact, and what the screens print', () => {
    const pinTokens = [...json.matchAll(/«(?:pin|ip_pin)·[^»]*»/g)].map((m) => m[0])
    expect(pinTokens.length).toBeGreaterThan(3)
    const out = new Map()
    const typed = maskText('Taxpayer PIN 41207, spouse PIN 88310', out)
    const fact = maskFact('household:ngozi#ip_pin', '135790', out)
    for (const t of [...pinTokens, typed, fact]) {
      for (const tok of t.matchAll(/«(?:pin|ip_pin)·([^·]*)·/g)) expect(tok[1], t).toBe('')
      expect(plainMasked(t).replace(/[^0-9]/g, ''), plainMasked(t)).toBe('')
    }
  })

  it('still compares PINs by tag and leaves the PIN tokens it issued alone', () => {
    const out = new Map()
    const a = maskText('PIN 41207', out)
    expect(maskText(a, out)).toBe(a)
    expect(parseToken(a)!.eq).toBe(parseToken(maskText('PIN 41207', new Map()))!.eq)
  })
})
