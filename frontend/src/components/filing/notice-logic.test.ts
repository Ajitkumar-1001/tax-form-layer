import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Act } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'
import { actSummary, claimRecord, earlierNotices, findNotice, mapItems, preconditions } from './notice-logic'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const partner = identities(packet).find((v) => v.id === 'st-03')!
const RECEIVED = '2028-01-27T00:00:00Z'

describe('findNotice', () => {
  it('finds Letter 566 and holds it back until the clock reaches its arrival', () => {
    const before = findNotice(model, '2026-06-23T06:05:00Z')
    expect(before).toMatchObject({ ref: 'agency:/notices/1', received: false })
    expect(before?.notice.id).toBe('N-2025-L566')
    expect(before?.knownAt.slice(0, 10)).toBe('2028-01-26')
    expect(findNotice(model, RECEIVED)?.received).toBe(true)
  })

  it('lists the earlier CP2000 as context, not the examination', () => {
    expect(earlierNotices(model, RECEIVED, 'agency:/notices/1').map((n) => n.notice.id)).toEqual(['N-2023-CP2000'])
  })
})

describe('mapItems', () => {
  it('maps the charitable item to SchA.12 and Form 8283, and gross receipts to SchC.1', () => {
    const items = mapItems(model, findNotice(model, RECEIVED)!.notice)
    expect(items[0].claims).toEqual(expect.arrayContaining(['SchA.12', 'F8283.A1.vehicle', 'F8283.A1.stock']))
    expect(items[1].claims).toEqual(['SchC.1'])
  })
})

describe('preconditions', () => {
  it('warns: no Form 2848, engagement excludes exams, designee lapsed; the 7216 consent still runs', () => {
    const pre = Object.fromEntries(preconditions(model, RECEIVED, findNotice(model, RECEIVED)!.notice).map((x) => [x.key, x]))
    expect(pre.authority.ok).toBe(false)
    expect(pre.scope.ok).toBe(false)
    expect(pre.scope.detail).toContain('2025 Form 1040 and California Form 540NR')
    expect(pre.designee.ok).toBe(false)
    expect(pre.consent.ok).toBe(true)
  })
})

describe('claimRecord', () => {
  it('collects the value, findings and the acts citing the claim (not reveals)', () => {
    const acts: Act[] = [{
      seq: 1, id: 't-1', engagement: 'test', recorded_at: RECEIVED, season_at: RECEIVED, actor: 'st-03', actor_role: 'partner',
      type: 'decide', target: 'SchC.1', refs: ['SchC.1'], batch_id: null, hash: '', prev_hash: '', derived: {},
      body: { kind: 'notice_response', question: 'Item 2', choice: 'Send the gross-receipts reconciliation', authority: 'IRC 6001', evidence: [], alternatives: [] },
    }]
    const rec = claimRecord(model, project(model, acts, partner), 'SchC.1')
    expect(rec.effective).toBe(163700)
    expect(rec.acts.map((a) => a.seq)).toEqual([1])
    expect(actSummary(rec.acts[0])).toBe('decide: Send the gross-receipts reconciliation')
    expect(rec.findings.every((f) => model.findingsById[f.id].claims.includes('SchC.1'))).toBe(true)
  })
})
