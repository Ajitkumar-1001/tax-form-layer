import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Act } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import type { State } from '@/lib/model/state'
import { viewerOf } from '@/lib/model/viewer'
import { agencyActs, simulateEfile } from './agency'
import { maskPacket } from './mask'

const packet = JSON.parse(readFileSync(path.join(process.cwd(), 'data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const { masked } = maskPacket(packet)
const model = buildModel(masked)
const asDelivered = project(model, [], viewerOf(masked, 'st-03'))
const THEO = 'household:theo#ssn'
// The projection of an adjust of Theo's SSN to the number on D06 / the 2024 return.
const corrected: State = {
  ...asDelivered,
  claims: { ...asDelivered.claims, [THEO]: { ...asDelivered.claims[THEO], effective: masked.prior_years.return_2024.dependents[1].ssn } },
}

describe('simulated e-file', () => {
  it('rejects federal with R0000-504-02 naming Theo and holds California while the organizer SSN stands', () => {
    const [fed, ca] = simulateEfile(model, asDelivered, ['federal', 'california'])
    expect(fed).toMatchObject({ jurisdiction: 'federal', status: 'rejected', errors: [{ code: 'R0000-504-02' }] })
    expect(fed.errors[0].message).toContain('(dependent 2: Theo Lindqvist-Okafor)')
    expect(fed.refs).toEqual(['agency:/efile/0', THEO])
    expect(ca).toMatchObject({ jurisdiction: 'california', status: 'held', errors: [{ code: 'STATE-HOLD' }] })
  })

  it('accepts both once the effective SSN matches the last accepted return', () => {
    expect(simulateEfile(model, corrected, ['federal', 'california']).map((r) => r.status)).toEqual(['accepted', 'accepted'])
  })

  it('reads the projected effective value of a stored SSN adjust', () => {
    const to = masked.prior_years.return_2024.dependents[1].ssn
    const fix = {
      seq: 1, id: 'a', engagement: 'main', recorded_at: '2026-06-23T07:00:00.000Z', season_at: '2026-06-23T06:05:00.000Z',
      actor: 'st-01', actor_role: 'preparer', type: 'adjust', target: THEO, refs: [THEO], batch_id: null, hash: '', prev_hash: '',
      body: { field: 'value', to, reason: 'Transposed digits; D06 shows the right number', evidence: ['ev-0012'] },
      derived: { from: asDelivered.claims[THEO].original, effect: { fed: 0, ca: 0, basis: 'none', category: 'none' }, needs_partner: false, amendment: 0 },
    } as Act
    const state = project(model, [fix], viewerOf(masked, 'st-03'))
    expect(simulateEfile(model, state, ['federal', 'california']).map((r) => r.status)).toEqual(['accepted', 'accepted'])
  })

  it('answers only for the jurisdictions submitted', () => {
    expect(simulateEfile(model, asDelivered, ['california']).map((r) => [r.jurisdiction, r.status])).toEqual([['california', 'accepted']])
  })

  it('writes system acts targeting the file act, with retention on acceptance', () => {
    const file = { seq: 41, engagement: 'copy-00000000', season_at: '2026-07-13T17:00:00.000Z' } as Act
    const [fed, ca] = agencyActs(model, corrected, file, ['federal', 'california'])
    expect(fed).toMatchObject({ actor: 'system', actor_role: 'system', type: 'agency_result', target: 'act:41', batch_id: null })
    expect(fed.derived).toEqual({ retain_until: '2033-07-13T17:00:00.000Z' })
    expect(ca.body).toMatchObject({ jurisdiction: 'california', status: 'accepted' })
  })
})
