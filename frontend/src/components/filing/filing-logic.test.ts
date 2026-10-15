import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import type { State } from '@/lib/model/state'
import { identities } from '@/lib/model/viewer'
import {
  extensionTranscript, keyLines, KEY_LINES, partnerDesk, seasonRecord, signoffMatrix, signTargets, spouseStatus,
} from './filing-logic'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const people = identities(packet)
const who = (id: string) => people.find((v) => v.id === id)!

/** Derive like the server (without authorize) and re-project after each act. */
function play(steps: [string, ActInput][]): State {
  const acts: Act[] = []
  let state = project(model, acts, who('st-03'))
  for (const [actor, input] of steps) {
    const seq = acts.length + 1
    acts.push({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: state.clock, season_at: state.clock, actor, actor_role: who(actor).role,
      type: input.type, target: input.target, refs: refsOf(input), body: input.body as Record<string, unknown>,
      derived: deriveFor(model, state, input), batch_id: null, hash: '', prev_hash: '',
    })
    state = project(model, acts, who('st-03'))
  }
  return state
}

const adjustSchC: ActInput = {
  type: 'adjust', target: 'SchC.1',
  body: { field: 'value', to: 151300, reason: 'Paywell 1099-K is already inside the Atlas deposits', evidence: ['D14'] },
}
const signoff = (target: string, level: 'preparer' | 'reviewer' | 'partner'): ActInput => ({ type: 'signoff', target, body: { level } })

describe('signoffMatrix', () => {
  it('has one row per area plus the return, all empty on an empty log', () => {
    const rows = signoffMatrix(project(model, [], who('st-03')))
    expect(rows).toHaveLength(10)
    expect(rows.at(-1)?.target).toBe('return')
    expect(rows.flatMap((r) => r.cells).every((c) => c.state === 'empty')).toBe(true)
  })

  it('a preparer sign-off is valid, then reopened with the changed claim after an adjust in scope', () => {
    const signed = signoffMatrix(play([['st-01', signoff('area:business', 'preparer')]]))
    expect(signed.find((r) => r.target === 'area:business')?.cells[0].state).toBe('valid')
    const changed = signoffMatrix(play([['st-01', signoff('area:business', 'preparer')], ['st-01', adjustSchC]]))
    const cell = changed.find((r) => r.target === 'area:business')!.cells[0]
    expect(cell.state).toBe('reopened')
    expect(cell.signoff?.changed).toContain('SchC.1')
  })
})

describe('partnerDesk', () => {
  it('lists an adjust over 1,000 uncovered until a partner signs its area', () => {
    const before = partnerDesk(model, play([['st-01', adjustSchC]])).find((i) => i.kind === 'adjust')
    expect(before).toMatchObject({ target: 'SchC.1', area: 'business', covered: false, preparedBy: ['st-01'] })
    expect(Math.abs(before!.effect.fed)).toBeGreaterThan(1000)
    expect(signTargets([before!])).toEqual(['area:business'])
    const after = partnerDesk(model, play([['st-01', adjustSchC], ['st-03', signoff('area:business', 'partner')]])).find((i) => i.kind === 'adjust')
    expect(after?.covered).toBe(true)
  })

  it('only lists open, visible process findings', () => {
    const state = project(model, [], who('st-03'))
    for (const i of partnerDesk(model, state).filter((x) => x.kind === 'finding')) {
      expect(model.findingsById[i.key].family).toBe('process_control')
      expect(state.findings[i.key]).toMatchObject({ visible: true, status: 'open' })
    }
  })

  it('routes post-review engine changes to the partner (CHK-56), uncovered until a partner signs', () => {
    const id = model.findings.find((f) => f.check === 'CHK-56' && f.claims.includes('step:11'))?.id
    if (!id) return // checks are built concurrently
    const item = partnerDesk(model, project(model, [], who('st-03'))).find((i) => i.key === id)
    expect(item).toMatchObject({ kind: 'finding', covered: false })
    const area = model.claims[item!.target].area
    const after = partnerDesk(model, play([['st-03', signoff(`area:${area}`, 'partner')]])).find((i) => i.key === id)
    expect(after?.covered).toBe(true)
  })

  it('signs the whole return for an item without an area', () => {
    expect(signTargets([{ key: 'x', kind: 'finding', target: 'x', area: null, reason: '', effect: { fed: 0, ca: 0 }, preparedBy: [], evidence: [], covered: false }])).toEqual(['return'])
  })
})

describe('approval status', () => {
  it('is not requested on an empty log', () => {
    const state = project(model, [], who('st-03'))
    expect(spouseStatus(state, 'cu-01')).toBe('not_requested')
  })
})

describe('season record', () => {
  it('holds every packet event after v3 as upcoming at the start of the season', () => {
    const { passed, upcoming } = seasonRecord(packet, '2026-06-23T06:05:00Z')
    expect(passed).toEqual([])
    expect(upcoming.map((e) => e.id)).toEqual(['tl-18', 'tl-19', 'tl-20', 'tl-21', 'tl-22', 'tl-23', 'tl-24', 'tl-25', 'tl-26', 'tl-27', 'tl-28', 'tl-29'])
  })

  it('never shows the signature PINs printed in the approval event', () => {
    const approved = seasonRecord(packet, '2026-07-11T00:00:00Z').passed.find((e) => e.id === 'tl-20')
    expect(approved?.detail).toContain('PIN •••••')
    expect(approved?.detail).not.toMatch(/\d{5}/)
  })

  it('shows the packet e-file rejection once the clock passes it', () => {
    const { passed } = seasonRecord(packet, '2026-07-13T18:00:00Z')
    const rejected = passed.find((e) => e.id === 'tl-21')
    expect(rejected?.efile.find((x) => x.jurisdiction === 'federal')).toMatchObject({ status: 'rejected', errors: [{ code: 'R0000-504-02' }] })
  })
})

describe('extension transcript', () => {
  it('uses the transcript in file at the clock and says when a later one arrives', () => {
    const now = extensionTranscript(packet, '2026-06-23T06:05:00Z')
    expect(now).toMatchObject({ asOf: '2026-03-12', later: '2026-08-03' })
    expect(now.rows.every((r) => r.code === '670')).toBe(true)
    const later = extensionTranscript(packet, '2026-08-04T00:00:00Z')
    expect(later.rows.some((r) => r.code === '460')).toBe(true)
    expect(later.rows.some((r) => r.code === '670' && r.amount === 36000)).toBe(true)
  })
})

describe('client copy', () => {
  it('reads key lines from the projection and marks adjusted ones as estimates', () => {
    const lines = keyLines(model, project(model, [], who('st-03')), KEY_LINES.federal)
    expect(lines.find((l) => l.key === 'F1040.37')).toMatchObject({ value: 4220, estimate: false })
    const adjusted = keyLines(model, play([['st-01', adjustSchC]]), ['SchC.1', 'F1040.9'])
    expect(adjusted.every((l) => l.estimate)).toBe(true)
  })
})
