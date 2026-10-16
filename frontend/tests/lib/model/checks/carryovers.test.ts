import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { checks } from '@/lib/model/checks/carryovers'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)
const run = (id: string) => checks.find((c) => c.id === id)!.run(m)

describe('CHK-30 basis by year', () => {
  const found = run('CHK-30')
  it('flags the S corp and partnership chains, not the IRA or home', () => {
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-30:scorp_lindqvist_family_woodworks', 'chk:CHK-30:partnership_ridgeline'])
  })
  it('S corp: 2022 client worksheet 21,300, 2023 and 2024 blank', () => {
    const f = found[0]
    expect(f.evidence).toEqual([0, 1, 2].map((i) => `py:/basis_records/scorp_lindqvist_family_woodworks/${i}`))
    expect(f.why).toContain('2022: ending stock basis 21,300 from client worksheet')
    expect(f.why).toContain('2023: ending stock basis blank')
    expect(f.claims[0]).toBe('F7203.1')
    expect(f.fix?.act).toBe('decide')
  })
  it('Ridgeline: outside basis never computed, attached to its K-1', () => {
    expect(found[1].why).toContain('outside basis blank')
    expect(found[1].claims).toEqual(['D37'])
  })
})

describe('CHK-31 carryovers out', () => {
  const found = run('CHK-31')
  it('finds the two missing rows and no mismatched ones', () => {
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-31:iso_basis', 'chk:CHK-31:refinance_points'])
  })
  it('ISO shares held: regular 12,000 / AMT 52,000 from Form 3921', () => {
    expect(found[0].title).toContain('regular 12,000, AMT 52,000')
    expect(found[0].claims).toEqual(['F6251.2i', 'D12'])
  })
  it('a carryover key that merely contains "iso" (comparison_basis) does not hide the ISO row', () => {
    const v3 = packet.return_versions[2]
    const federal = { ...v3.carryovers_out.federal, comparison_basis: 1 }
    const p2 = { ...packet, return_versions: [...packet.return_versions.slice(0, 2), { ...v3, carryovers_out: { ...v3.carryovers_out, federal } }] }
    expect(checks.find((c) => c.id === 'CHK-31')!.run(buildModel(p2)).map((f) => f.id)).toContain('chk:CHK-31:iso_basis')
  })
  it('refinance points: 3,200 - 9 = 3,191, term unsourced', () => {
    expect(found[1].title).toContain('3,191')
    expect(found[1].why).toContain('360-month term comes from the engine')
    expect(found[1].claims).toEqual(['SchA.8c', 'D57'])
  })
})

describe('CHK-32 prior-preparer items', () => {
  const found = run('CHK-32')
  it('one finding per prior item claim', () => {
    const items = m.claimList.filter((c) => c.kind === 'prior_item').map((c) => c.id)
    expect(found).toHaveLength(items.length)
    expect(found.map((f) => f.claims[0]).sort()).toEqual(items.sort())
  })
  it('the Form 3520 item and the 300 sq ft home office note are the warnings', () => {
    const warnings = found.filter((f) => f.severity === 'warning')
    expect(warnings.map((f) => f.id)).toEqual(['chk:CHK-32:notes/4', 'chk:CHK-32:open_items/3'])
    expect(warnings[0].title).toBe('Prior year used 300 sq ft; D24 measures 220') // the Sacramento office the note names, not Austin
    expect(warnings[0].knownSince).toBe(packet.documents.find((d) => d.id === 'D24')!.received_at)
    expect(warnings[1].title).toContain('Form 3520')
    expect(warnings.every((f) => f.fix?.disposition === 'client_notified')).toBe(true)
  })
  it('the 2024 Form 5498 item points at the 2024 5498 only', () => {
    expect(found.find((f) => f.id === 'chk:CHK-32:open_items/1')!.why).toContain('Possibly resolved by D42.')
  })
})

it('every finding keeps an existing claim and survives runChecks', () => {
  for (const c of checks) {
    for (const f of c.run(m)) {
      expect(f.claims.length).toBeGreaterThan(0)
      expect(f.claims.every((id) => m.claims[id])).toBe(true)
      expect(m.findingsById[f.id]?.claims).toEqual(f.claims)
    }
  }
})
