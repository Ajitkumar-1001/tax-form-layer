import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Packet } from '@/lib/model/packet-types'
import { identities } from '@/lib/model/viewer'
import { DEFAULT_ACTOR, freshCopyRefusal, signActor, verifyActor } from '@/lib/server/identity'

const packet = JSON.parse(readFileSync(path.join(process.cwd(), 'data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const everyone = identities(packet)

describe('fresh copy', () => {
  it('is the firm administrator only', () => {
    const allowed = everyone.filter((v) => freshCopyRefusal(v) === null).map((v) => v.id)
    expect(allowed).toEqual(['st-05'])
    expect(freshCopyRefusal(everyone.find((v) => v.id === 'st-03')!)).toMatch(/^Only the firm administrator/)
    expect(freshCopyRefusal(everyone.find((v) => v.id === 'cu-01')!)).toMatch(/^Only the firm administrator/)
  })
})

describe('actor cookie', () => {
  it('round-trips a signed actor and falls back to the default when tampered with', () => {
    expect(verifyActor(signActor('st-05'))).toBe('st-05')
    expect(verifyActor(signActor('st-04').replace('st-04', 'st-05'))).toBe(DEFAULT_ACTOR)
    expect(verifyActor('st-05')).toBe(DEFAULT_ACTOR)
  })
})
