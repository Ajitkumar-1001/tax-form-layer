import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { checks, paymentTieOuts } from '@/lib/model/checks/agency'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet

describe('CHK-19 payments vs agency records', () => {
  const m = buildModel(packet)
  const rows = Object.fromEntries(paymentTieOuts(m).map((r) => [r.line, r]))

  it('ties each payment line to its ledger', () => {
    expect(Object.values(rows).map((r) => [r.line, r.onReturn, r.agency, r.diff])).toEqual([
      ['F1040.26', 13000, 12000, 1000],
      ['Sch3.10', 36000, 36000, 0],
      ['F540NR.72', 14000, 10500, 3500],
      ['F540NR.73', 0, 0, 0],
    ])
  })

  it('shows the Q4 federal estimate from the client answer against the transcript', () => {
    const r = rows['F1040.26']
    expect(r.knownSince).toBe('2026-03-12')
    expect(r.payments.filter((p) => p.status !== 'matched')).toEqual([
      { date: '2026-01-14', amount: 4000, status: 'return_only', ref: null },
      { date: '2026-01-15', amount: 3000, status: 'agency_only', ref: 'agency:/irs_account_transcript_2025/0/transactions/3' },
    ])
  })

  it('shows the extension payment from the firm record before a transcript lists it', () => {
    const r = rows['Sch3.10']
    // Only the 2026-08-03 transcript shows the Form 4868 payment; the extension worksheet and filing event are earlier.
    expect(r.firmRecord).toEqual({ amount: 36000, ref: 'timeline:extension-2026-04-14', knownSince: '2026-04-14T15:00:00Z' })
    expect([r.knownSince, r.agencyKnownSince]).toEqual(['2026-04-14T15:00:00Z', '2026-08-03'])
    expect(rows['F540NR.73']).toMatchObject({ knownSince: '2026-03-12', agencyKnownSince: '2026-03-12', firmRecord: { amount: 0 } })
    expect(rows['F1040.26'].firmRecord).toBeUndefined()
  })

  it('finds the state payment designated to the prior year', () => {
    const odd = rows['F540NR.72'].payments.filter((p) => p.status !== 'matched')
    expect(odd).toMatchObject([{ date: '2025-09-15', amount: 3500, status: 'other_year', ref: 'agency:/ftb_account/tax_year_2024_payments_after_filing/0' }])
    expect(rows['F540NR.72'].evidence).toEqual(expect.arrayContaining(['ev-1074', 'ev-1075', 'ev-1076']))
  })

  it('reports the two mismatches as findings with direct effects', () => {
    const fs = checks[0].run(m)
    expect(fs.map((f) => [f.id, f.expected, f.actual, f.stake, f.knownSince])).toEqual([
      ['chk:CHK-19:F1040.26', 12000, 13000, { fed: 1000, ca: 0 }, '2026-03-12'],
      ['chk:CHK-19:F540NR.72', 10500, 14000, { fed: 0, ca: 3500 }, '2026-03-12'],
    ])
    expect(fs[0].claims).toEqual(['F1040.26', 'qa-41'])
    expect(fs.map((f) => f.severity)).toEqual(['warning', 'high'])
  })
})
