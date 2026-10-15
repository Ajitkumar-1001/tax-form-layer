// The shell's return state, pinned against the masked packet the browser loads, at the packet's "now" (season clock
// 2026-06-23T06:05:00Z, no acts).
import { describe, expect, it } from 'vitest'
import { readPacket } from '@/components/records/fixture'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { filingDeadlines, nextDeadline, SPECTRUM, spectrum, STAGES, stageLabel } from './return-state'

const packet = maskPacket(readPacket()).masked
const state = project(buildModel(packet), [], viewerOf(packet, 'st-01'))

describe('spectrum', () => {
  it('counts the 812 claims in the file, part by part in contract order', () => {
    expect(state.clock).toBe('2026-06-23T06:05:00Z')
    const { parts, total } = spectrum(state)
    expect(total).toBe(812)
    expect(parts.map((p) => [p.key, p.count])).toEqual([['checked', 0], ['corrected', 0], ['matches', 350], ['unchecked', 280], ['open', 182]])
    expect(parts.reduce((n, p) => n + p.count, 0)).toBe(total)
  })

  it('leaves out the 6 claims the season clock has not reached', () => {
    const later = Object.values(state.claims).filter((c) => c.flags.includes('not_yet_in_file')).map((c) => c.id)
    expect(later.sort()).toEqual(['D71', 'D72', 'msg-07', 'msg-08', 'msg-09', 'msg-10'])
    expect(Object.keys(state.claims).length - spectrum(state).total).toBe(6)
  })

  it('puts every claim status in exactly one part, with plain words', () => {
    const statuses = SPECTRUM.flatMap((p) => p.statuses)
    expect([...statuses].sort()).toEqual(['accepted', 'adjusted', 'open', 'read_ok', 'unreviewed', 'verified'])
    expect(SPECTRUM.map((p) => p.label)).toEqual(['Checked by staff', 'Corrected', 'Matches the page (automatic)', 'Not checked yet', 'Has an open issue'])
  })
})

describe('deadlines', () => {
  it('keeps the two due dates of the return, in order (not the internal targets, the FBAR or the 1099s)', () => {
    const d = filingDeadlines(packet)
    expect(d.map((x) => x.date)).toEqual(['2026-04-15', '2026-10-15'])
    expect(d[1]).toEqual({ what: 'Extended due date (federal and California)', date: '2026-10-15', at: Date.parse('2026-10-15T00:00:00Z') })
  })

  it('names the next due date with whole days left, and none once both have passed', () => {
    expect(nextDeadline(packet, '2026-03-01T00:00:00Z')?.date).toBe('2026-04-15')
    expect(nextDeadline(packet, '2026-06-23T06:05:00Z')).toMatchObject({ date: '2026-10-15', daysLeft: 114 })
    expect(nextDeadline(packet, '2026-10-16T00:00:00Z')).toBeNull()
  })
})

describe('stages', () => {
  it('labels the six stages in order', () => {
    expect(STAGES.map((s) => s.key)).toEqual(['preparation', 'review', 'partner', 'approval', 'filed', 'amending'])
    expect(stageLabel(state.stage)).toBe('Preparation')
    expect(stageLabel('partner')).toBe('Partner review')
  })
})
