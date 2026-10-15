import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from './build'
import type { Packet } from './packet-types'

export const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet

describe('buildModel', () => {
  const m = buildModel(packet)
  it('derives claims for every v3 line, document and comm', () => {
    expect(m.claimList.filter((c) => c.kind === 'line')).toHaveLength(627)
    expect(m.claimList.filter((c) => c.kind === 'doc')).toHaveLength(74)
    expect(m.claimList.filter((c) => c.kind === 'comm')).toHaveLength(56)
    expect(m.claimList.filter((c) => c.kind === 'step')).toHaveLength(12)
  })
  it('every v3 input resolves to a line', () => {
    const missing = m.claimList.flatMap((c) => c.inputs.filter((i) => !m.claims[i]))
    expect(missing).toEqual([])
  })
})
