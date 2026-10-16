import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '@/lib/model/build'
import { computeEffect } from '@/lib/model/effects'
import type { Packet } from '@/lib/model/packet-types'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)
const of = (check: string) => m.findings.filter((f) => f.check === check)

describe('CHK-16 same income from two documents', () => {
  it('flags the Northlake sweep interest once, on the later document line', () => {
    expect(of('CHK-16').map((f) => f.id)).toEqual(['chk:CHK-16:SchB.1.2'])
    const [f] = of('CHK-16')
    expect(f.claims.slice(0, 2)).toEqual(['SchB.1.2', 'SchB.1.1'])
    expect(f).toMatchObject({ signal: 'heuristic', expected: 0, actual: 1840, stake: { fed: -640, ca: -127 } })
    expect(f.fix).toEqual({ act: 'adjust', target: 'SchB.1.2', field: 'value', to: 0, label: expect.any(String) })
    expect(f.why).toContain('7731')
  })

  it('does not pair the same amount from documents of different tax years', () => {
    const doc = m.findingsById['chk:CHK-16:SchB.1.2'].claims[2]
    const other = structuredClone(packet)
    const d = other.documents.find((x) => x.id === doc)!
    d.tax_year -= 1
    expect(buildModel(other).findings.filter((f) => f.check === 'CHK-16')).toEqual([])
  })
})

describe('CHK-17 duplicate page', () => {
  it('finds D23 page 3 and corrects the car expense that carries the tax', () => {
    expect(of('CHK-17').map((f) => f.id)).toEqual(['chk:CHK-17:D23#page3'])
    const [f] = of('CHK-17')
    expect(f.claims).toEqual(['SchC.9', 'SchC.44a'])
    expect(f).toMatchObject({ expected: 5670, actual: 8260, severity: 'high', stake: { fed: 919, ca: 80 } })
    expect(f.why).toContain('SchC.44a becomes 8,100')
  })

  // Regression: the fix adjusted SchC.44a (miles, no tax effect), so applying it cleared the finding and recorded 0 / 0.
  it('fixes SchC.9 to 5,670, and that adjust records the stake', () => {
    const f = m.findingsById['chk:CHK-17:D23#page3']
    expect(f.fix).toMatchObject({ act: 'adjust', target: 'SchC.9', field: 'value', to: 5670 })
    expect(f.fix?.label).toContain('8,100')
    const line = m.lines['SchC.9']
    const eff = computeEffect(packet, line, 'value', line.value as number, f.fix!.to as number)
    expect({ fed: eff.fed, ca: eff.ca }).toEqual(f.stake)
  })

  it('never flags the Meridian original/corrected pages', () => {
    expect(of('CHK-17').some((f) => /D3[01]/.test(f.id + f.evidence.join()))).toBe(false)
  })
})

describe('CHK-18 duplicate and corrected documents', () => {
  it('flags the phone-photo W-2 and records the corrected 1099 lineage, naming the other document', () => {
    const fs = Object.fromEntries(of('CHK-18').map((f) => [f.id, f]))
    expect(Object.keys(fs).sort()).toEqual(['chk:CHK-18:D10', 'chk:CHK-18:D30'])
    expect(fs['chk:CHK-18:D10']).toMatchObject({ severity: 'warning', claims: ['D10', 'D09'], fix: { act: 'dispose', target: 'D10', disposition: 'duplicate_of', ref: 'D09' } })
    expect(fs['chk:CHK-18:D30']).toMatchObject({ severity: 'info', claims: ['D30', 'D31'], fix: { act: 'dispose', target: 'D30', disposition: 'superseded_by', ref: 'D31' } })
    expect(fs['chk:CHK-18:D30'].why).toContain('4 fields changed')
    expect(fs['chk:CHK-18:D30'].why).toContain('M9_basis 6900 → 4880')
  })
})

describe('adjust fixes record the stake their finding states', () => {
  it('holds for every value adjust my checks suggest', () => {
    const mine = m.findings.filter((f) => /^CHK-(01|02|03|04|16|17|18)$/.test(f.check) && f.fix?.act === 'adjust' && f.fix.field === 'value' && f.stake)
    expect(mine.length).toBeGreaterThan(1)
    for (const f of mine) {
      const line = m.lines[f.fix!.target]
      const eff = computeEffect(packet, line, 'value', line.value as number, f.fix!.to as number)
      expect({ fed: eff.fed, ca: eff.ca }, f.id).toEqual(f.stake)
    }
  })
})
