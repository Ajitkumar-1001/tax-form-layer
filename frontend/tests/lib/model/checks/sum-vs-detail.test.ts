import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { brokerTieOuts } from '@/lib/model/checks/sum-vs-detail'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)

describe('broker tie-outs (Records UI)', () => {
  it('returns every broker document, passing ones included', () => {
    const rows = Object.fromEntries(
      brokerTieOuts(m).map((t) => [t.doc, { status: t.status, summary: t.summary, extracted: t.extracted, printed: t.printed.count, superseded: t.superseded }]),
    )
    expect(rows).toEqual({
      D28: { status: 'tied', summary: 68020, extracted: { count: 5, proceeds: 68020 }, printed: 5, superseded: false },
      D30: { status: 'gap', summary: 71965, extracted: { count: 17, proceeds: 71715 }, printed: 18, superseded: true },
      D31: { status: 'gap', summary: 71965, extracted: { count: 17, proceeds: 71715 }, printed: 18, superseded: false },
      D34: { status: 'tied', summary: 34833, extracted: { count: 12, proceeds: 34833 }, printed: 12, superseded: false },
      D74: { status: 'tied', summary: 334728.52, extracted: { count: 260, proceeds: 334728.52 }, printed: 260, superseded: false },
    })
  })

  it('names the unread lot and its page', () => {
    const d31 = brokerTieOuts(m).find((t) => t.doc === 'D31')
    expect(d31?.gap).toBe(250)
    expect(d31?.unread).toEqual([{ lot: 'M18', page: 32, proceeds: 250, basis: 310, sold: '2025-12-15', term: 'short', covered: false }])
  })
})

describe('CHK-04 summary vs lot detail', () => {
  it('flags only the current Meridian document', () => {
    const fs = m.findings.filter((f) => f.check === 'CHK-04')
    expect(fs.map((f) => f.id)).toEqual(['chk:CHK-04:D31'])
    const [f] = fs
    expect(f).toMatchObject({ expected: 71965, actual: 71715, severity: 'warning', signal: 'computed' })
    expect(f.claims).toEqual(['D31', 'diag:BROKER_SUMMARY_DETAIL_MISMATCH'])
    expect(f.evidence).toEqual(['ev-0703', 'doc:D31#page32'])
    // M18: 250 proceeds − 310 basis, short-term, sold 2025-12-15 after the California move, so no California effect.
    expect(f.stake).toEqual({ fed: -21, ca: 0 })
  })
})
