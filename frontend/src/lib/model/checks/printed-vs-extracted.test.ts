import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { maskPacket } from '@/lib/server/mask'
import { buildModel } from '../build'
import { isMasked } from '../mask-token'
import type { Packet } from '../packet-types'

const raw = readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')
const packet = JSON.parse(raw) as Packet
const m = buildModel(packet)
const of = (check: string) => m.findings.filter((f) => f.check === check)
const byId = (id: string) => m.findingsById[id]

/** What `python3 -I analysis/oracle.py` flags on this packet (17 of 3,012). */
const ORACLE = [
  'ev-0022', 'ev-0498', 'ev-0501', 'ev-0510', 'ev-0516', 'ev-0519', 'ev-0525', 'ev-0528', 'ev-0537',
  'ev-0971', 'ev-0972', 'ev-0973', 'ev-0974', 'ev-0978', 'ev-0986', 'ev-1045', 'ev-1049',
]

describe('CHK-01 printed vs extracted', () => {
  it('flags the oracle reads minus percent-format noise, with blank reads left to CHK-02', () => {
    const percent = ORACLE.filter((id) => m.ev[id].value_type === 'percent')
    expect(percent).toHaveLength(6)
    const ids01 = of('CHK-01').map((f) => f.id.replace('chk:CHK-01:', '')).sort()
    const ids02 = of('CHK-02').map((f) => f.id.replace('chk:CHK-02:', '')).sort()
    expect(ids01).toEqual(['ev-0022', 'ev-0501', 'ev-0510', 'ev-0519', 'ev-0528', 'ev-0537', 'ev-1045', 'ev-1049'])
    expect([...ids01, ...ids02].sort()).toEqual(ORACLE.filter((id) => !percent.includes(id)).sort())
  })

  it('attaches cited misreads to their lines and pre-fills the printed TIN', () => {
    const tin = byId('chk:CHK-01:ev-1045')
    expect(tin.claims).toEqual(['F2441.1b'])
    expect(tin.severity).toBe('warning')
    expect(tin.expected).toBe('74-3829156')
    expect(tin.fix).toMatchObject({ act: 'adjust', target: 'F2441.1b', field: 'label' })
    expect(String(tin.fix?.to)).toContain('74-3829156')

    const gift = byId('chk:CHK-01:ev-1049')
    expect(gift.claims).toEqual(['SchA.11'])
    expect(gift.stake).toEqual({ fed: 390, ca: 72 })
  })

  it('keeps uncited zero phantoms as info on their document', () => {
    const box10 = byId('chk:CHK-01:ev-0022')
    expect(box10).toMatchObject({ severity: 'info', claims: ['D08'] })
    expect(of('CHK-01').filter((f) => f.severity === 'info')).toHaveLength(6)
  })
})

describe('CHK-02 blank field stored as zero', () => {
  it('flags exactly the three RSU basis reads and attaches them to their 8949 rows', () => {
    const found = Object.fromEntries(of('CHK-02').map((f) => [f.id, f.claims]))
    expect(found).toEqual({
      'chk:CHK-02:ev-0498': ['F8949.B.N1'],
      'chk:CHK-02:ev-0516': ['F8949.B.N3'],
      'chk:CHK-02:ev-0525': ['F8949.E.N4'],
    })
    expect(of('CHK-02').every((f) => f.severity === 'high' && f.actual === 0 && f.expected === null)).toBe(true)
  })
})

describe('CHK-03 unread pages and not-extracted documents', () => {
  it('lists the Meridian page 32 pair and the four not-extracted documents', () => {
    const sev = Object.fromEntries(of('CHK-03').map((f) => [f.id, f.severity]))
    expect(sev).toEqual({
      'chk:CHK-03:D30#page32': 'info', // superseded
      'chk:CHK-03:D31#page32': 'warning',
      'chk:CHK-03:D07': 'info', // reproduced as structured data, a prior-year support document
      'chk:CHK-03:D69': 'warning', // structured data, but used in v3 and lands on no line
      'chk:CHK-03:D70': 'warning', // only summarized
      'chk:CHK-03:D72': 'warning',
    })
    expect(byId('chk:CHK-03:D31#page32').evidence).toEqual(['doc:D31#page32'])
  })

  it('says a used, never-extracted document lands nowhere, in place of CHK-48', () => {
    for (const id of ['D07', 'D69', 'D70']) {
      expect(byId(`chk:CHK-03:${id}`).why, id).toContain('v3 lists it as used, yet no line cites it')
      expect(byId(`chk:CHK-48:${id}`), id).toBeUndefined()
    }
    expect(byId('chk:CHK-03:D72').why).not.toContain('lists it as used')
    expect(byId('chk:CHK-03:D07').fix).toEqual({ act: 'dispose', target: 'D07', disposition: 'informational', label: 'Mark as support only' })
  })
})

// The browser runs the checks on the packet the server masks (src/lib/server/mask.ts), so test on that one.
describe('engine-free checks on the server-masked packet', () => {
  const mm = buildModel(maskPacket(packet).masked)
  const MINE = /^chk:CHK-(01|02|03|04|16|17|18|48|49|50|52):/
  const mine = (fs: typeof m.findings) => fs.filter((f) => MINE.test(f.id)).sort((a, b) => a.id.localeCompare(b.id))

  it('masks SSNs, and none reaches a finding', () => {
    expect(JSON.stringify(mm.packet)).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
    expect(JSON.stringify(mine(mm.findings))).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
  })

  it('produces the same findings, claims, values, stakes and fixes as on the raw packet', () => {
    const shape = (fs: typeof m.findings) =>
      mine(fs).map((f) => ({ id: f.id, claims: f.claims, severity: f.severity, stake: f.stake, expected: f.expected, actual: f.actual, fix: f.fix }))
    expect(shape(mm.findings)).toEqual(shape(m.findings))
  })

  it('still finds the printed TIN: EINs stay clear under the firm rule, and titles show only the last four', () => {
    const tin = mm.findingsById['chk:CHK-01:ev-1045']
    expect(isMasked(tin.expected)).toBe(false)
    expect(tin.expected).toBe('74-3829156')
    expect(tin.title).not.toMatch(/\d{2}-\d{7}/)
  })
})
