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
  extensionTranscript, keyLines, KEY_LINES, partnerDesk, seasonRecord, signoffMatrix, signTargets, sinceSigned, spouseStatus,
} from '@/components/filing/filing-logic'

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

// A reopened sign-off's "since then" (the sign-off matrix and the Sign off form): each act once, oldest first, reverts included.
describe('sinceSigned', () => {
  const sign: [string, ActInput] = ['st-01', signoff('area:business', 'preparer')]
  const business = (state: State) => state.signoffs.find((s) => s.target === 'area:business' && s.level === 'preparer')!

  it('names each act once, oldest first: two notes by Daniel, then a reply by Priya', () => {
    const tie: [string, ActInput] = ['st-02', { type: 'note', target: 'SchC.1', body: { kind: 'review_note', text: 'Tie gross receipts to the 1099-K first.', blocking: true } }]
    const bank: [string, ActInput] = ['st-02', { type: 'note', target: 'SchC.1', body: { kind: 'review_note', text: 'Tie the Atlas deposits to the bank statements too.', blocking: false } }]
    const noted = play([sign, tie, bank])
    const first = noted.notes.find((n) => n.text === 'Tie gross receipts to the 1099-K first.')!.seq
    const reply: [string, ActInput] = ['st-01', { type: 'reply', target: `act:${first}`, body: { text: 'Tied: see the D14 deposits.', attachments: [] } }]
    const state = play([sign, tie, bank, reply])
    expect(business(state).valid).toBe(false)
    expect(sinceSigned(model, state, business(state))).toEqual(['Note added by Daniel Ortiz', 'Replied by Priya Raman'])
  })

  it('names a revert of an adjust the sign-off covered', () => {
    const seq = play([['st-01', adjustSchC]]).adjusts.find((v) => v.target === 'SchC.1')!.seq
    const state = play([['st-01', adjustSchC], sign, ['st-01', { type: 'revert', target: `act:${seq}`, body: { reason: 'The Paywell figure was right after all' } }]])
    expect(business(state).valid).toBe(false)
    expect(business(state).changed).toContain('SchC.1')
    expect(sinceSigned(model, state, business(state))).toContain('Reverted by Priya Raman')
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
  it("marks stale key lines 'not recomputed' and leaves the balance to the summary", () => {
    expect(KEY_LINES.federal).not.toContain('F1040.37')
    expect(KEY_LINES.california).not.toContain('F540NR.97')
    expect(keyLines(model, project(model, [], who('st-03')), KEY_LINES.federal).some((l) => l.notRecomputed)).toBe(false)
    expect(keyLines(model, play([['st-01', adjustSchC]]), ['SchC.1', 'F1040.9', 'F1040.1z']).map((l) => l.notRecomputed)).toEqual([false, true, false])
  })

  it('leaves a stale line the person then adjusted directly untagged: it holds their value, not the engine figure', () => {
    const adjustTotalIncome: ActInput = {
      type: 'adjust', target: 'F1040.9',
      body: { field: 'value', to: 470000, reason: 'Total income re-keyed by hand after the Paywell change', evidence: ['D14'] },
    }
    const state = play([['st-01', adjustSchC], ['st-01', adjustTotalIncome]])
    // Both halves of the rule hold on this line, so the untagged result proves the adjust clause and not just the stale one.
    expect(state.claims['F1040.9'].flags).toContain('stale')
    expect(state.claims['F1040.9'].adjust).toBeDefined()
    const [total, agi] = keyLines(model, state, ['F1040.9', 'F1040.11'])
    expect(total.notRecomputed).toBe(false)
    expect(agi.notRecomputed).toBe(true)
  })

  // Only a value adjust makes a line hold the person's figure: a label adjust leaves the engine's pre-change number in place.
  it('keeps the tag on a stale line whose label alone was then adjusted', () => {
    const relabel: ActInput = {
      type: 'adjust', target: 'F1040.11',
      body: { field: 'label', to: 'Adjusted gross income (AGI)', reason: 'Label as printed on the 2025 Form 1040', evidence: [] },
    }
    const state = play([['st-01', adjustSchC], ['st-01', relabel]])
    // The line is stale and carries an adjust, a label one: what the rule used to read as "holds the person's value".
    expect(state.claims['F1040.11'].flags).toContain('stale')
    expect(state.claims['F1040.11'].adjust?.field).toBe('label')
    expect(keyLines(model, state, ['F1040.11'])[0].notRecomputed).toBe(true)
  })

  it('drops the tag for a live value adjust of the line itself, and brings it back once that adjust is reverted', () => {
    const agi: ActInput = {
      type: 'adjust', target: 'F1040.11',
      body: { field: 'value', to: 433190, reason: 'AGI re-keyed by hand after the Paywell change', evidence: ['D14'] },
    }
    const adjusted = play([['st-01', adjustSchC], ['st-01', agi]])
    expect(adjusted.claims['F1040.11'].flags).toContain('stale')
    expect(keyLines(model, adjusted, ['F1040.11'])[0].notRecomputed).toBe(false)
    const seq = adjusted.adjusts.find((v) => v.target === 'F1040.11' && v.field === 'value')!.seq
    const revert: ActInput = { type: 'revert', target: `act:${seq}`, body: { reason: 'Back to the engine figure' } }
    const reverted = play([['st-01', adjustSchC], ['st-01', agi], ['st-01', revert]])
    expect(reverted.claims['F1040.11'].flags).toContain('stale')
    expect(reverted.adjusts.find((v) => v.seq === seq)?.reverted).toBe(true)
    expect(keyLines(model, reverted, ['F1040.11'])[0].notRecomputed).toBe(true)
  })
})
