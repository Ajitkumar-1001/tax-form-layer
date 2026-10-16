import { describe, expect, it } from 'vitest'
import { resolveRef } from '@/components/trace/resolve'
import type { Act } from '@/lib/model/acts'
import { ActInputZ } from '@/lib/model/acts'
import { project } from '@/lib/model/project'
import { clockAt, diffSides, sideOptions, sideValues, sinceMe } from '@/components/records/compare'
import { disposeActs, documentRows, exceptionsFirst, extractionText, filterDocs } from '@/components/records/documents'
import { actsOf, loadFixture } from './fixture'

const { model, state } = loadFixture()
const nameOf = (id: string) => id

describe('documents', () => {
  const rows = documentRows(model, state)
  const byId = new Map(rows.map((r) => [r.id, r]))
  it('lists all 74 documents', () => expect(rows).toHaveLength(74))
  it('?unlanded=1 gives the 15 used-but-unlanded documents', () => {
    expect(filterDocs(rows, { unlanded: true, area: null }).map((r) => r.id)).toEqual(
      ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D10', 'D13', 'D15', 'D47', 'D54', 'D69', 'D70', 'D73'],
    )
  })
  it('filters by area', () => {
    expect(filterDocs(rows, { unlanded: false, area: 'pass_throughs_and_basis' }).map((r) => r.id)).toEqual(['D37', 'D38', 'D39', 'D40'])
  })
  it('shows partial reads, late arrivals and lineage', () => {
    expect(byId.get('D31')?.extraction).toBe('partial: page 32 not read')
    expect(extractionText('extracted', null)).toBe('extracted')
    expect(byId.get('D71')?.afterV3).toBe(true)
    expect(byId.get('D72')?.notYetInFile).toBe(true)
    expect(byId.get('D30')?.lineage.map((l) => l.text)).toContain('superseded in v2, v3')
    expect(byId.get('D10')?.lineage.some((l) => l.text.includes('second copy of D09'))).toBe(true)
  })
  it('puts exceptions first', () => {
    expect(exceptionsFirst(rows)[0].unlanded).toBe(true)
  })
  it('builds one valid dispose act per document with the shared reason', () => {
    const acts = disposeActs(['D03', 'D04'], 'informational', 'IP PIN notice, IDs')
    expect(acts).toHaveLength(2)
    for (const a of acts) expect(ActInputZ.safeParse(a).success).toBe(true)
  })
})

describe('compare', () => {
  it('offers versions, 2024, now and every what-if', () => {
    const values = sideOptions(model).map((o) => o.value)
    expect(values).toEqual(expect.arrayContaining(['2024', 'v1', 'v2', 'v3', 'now', 'whatif:standard_deduction']))
  })
  it('attributes v2 → v3 changes to engine v3', () => {
    const rows = diffSides(model, state, 'v2', 'v3', nameOf) ?? []
    const f7203 = rows.find((r) => r.key === 'F7203.1')
    expect(f7203).toMatchObject({ a: 8200, b: 2300, delta: -5900 })
    expect(f7203?.by.map((b) => b.text)).toContain('engine v3 (system)')
  })
  it('overlays a what-if on v3', () => {
    const rows = diffSides(model, state, 'v3', 'whatif:standard_deduction', nameOf) ?? []
    expect(rows.find((r) => r.key === 'F1040.24')).toMatchObject({ a: 81962, b: 94268, delta: 12306 })
    expect(rows).toHaveLength(model.packet.what_if.alternatives.find((a) => a.id === 'standard_deduction')!.changed_lines.length)
  })
  it('links only keys that have a trace: the form-level 2024 key F8938 is plain text', () => {
    const rows = diffSides(model, state, '2024', 'v3', nameOf) ?? []
    expect(rows.find((r) => r.key === 'F8938')?.ref).toBeUndefined()
    for (const r of rows) if (r.ref) expect(resolveRef(model, r.ref).kind, r.key).not.toBe('unknown')
    expect(rows.filter((r) => r.ref).length).toBe(rows.length - 1)
  })
  it('puts an adjust reason in detail, outside the linked attribution text', () => {
    const s = project(model, actsOf(model, [['st-01', { type: 'adjust', target: 'F1040.1a', body: { field: 'value', to: 200, reason: 'Corrected per the W-2', evidence: ['D06'] } }]]), state.viewer)
    const by = diffSides(model, s, 'v3', 'now', nameOf)?.find((r) => r.key === 'F1040.1a')?.by
    expect(by).toEqual([{ text: 'adjust #1 by st-01', ref: 'act:1', detail: 'Corrected per the W-2' }])
  })
  it('now equals v3 with no acts, and an unknown side is null', () => {
    expect(diffSides(model, state, 'v3', 'now', nameOf)).toEqual([])
    expect(sideValues(model, state, 'nope')).toBeNull()
  })
})

describe('since I last looked', () => {
  const act = (seq: number, actor: string, type: Act['type'], body: Record<string, unknown> = {}): Act => ({
    seq, id: `a${seq}`, engagement: 'main', recorded_at: '', season_at: '', actor, actor_role: '', type, target: 'season', refs: [], body, derived: {}, batch_id: null, hash: '', prev_hash: '',
  })
  it('reads the clock at a seq', () => {
    const acts = [act(1, 'st-03', 'clock', { to: '2026-07-01T00:00:00Z' }), act(2, 'st-03', 'clock', { to: '2026-08-01T00:00:00Z' })]
    expect(clockAt(acts, 0)).toBe('2026-06-23T06:05:00Z')
    expect(clockAt(acts, 1)).toBe('2026-07-01T00:00:00Z')
  })
  it('reads a date-only clock act as the instant project uses', () => {
    const acts = [act(1, 'st-03', 'clock', { to: '2026-07-01' }), act(2, 'st-03', 'clock', { to: '2026-07-15' })]
    expect(clockAt(acts, 1)).toBe('2026-07-01T00:00:00Z')
    expect(clockAt(acts, 1)).toBe(project(model, acts.slice(0, 1), state.viewer).clock)
  })
  it('does not count a finding known at the instant I last looked as newly visible', () => {
    // No packet finding is known exactly at midnight, so add a copy of msg-08's finding known at 2026-07-01T00:00:00Z.
    const base = model.findingsById['chk:CHK-25:msg-08']
    const midnight = { ...base, id: 'chk:CHK-25:msg-08:midnight', knownSince: '2026-07-01T00:00:00Z' }
    const m = { ...model, findings: [...model.findings, midnight], findingsById: { ...model.findingsById, [midnight.id]: midnight } }
    const acts = [act(1, 'st-03', 'clock', { to: '2026-07-01' }), act(2, 'st-03', 'clock', { to: '2026-07-15' })]
    expect(project(m, acts.slice(0, 1), state.viewer).findings[midnight.id].visible).toBe(true) // visible when I looked
    const fresh = sinceMe(m, project(m, acts, state.viewer), 'st-01', 1).findings.map((f) => f.id)
    expect(fresh).not.toContain(midnight.id)
    expect(fresh).toContain('chk:CHK-25:msg-08') // known at 16:40 that day, after I looked
  })
  it('summarises acts by others in plain language', () => {
    const s = sinceMe(model, { ...state, acts: [act(1, 'st-02', 'note'), act(2, 'st-01', 'note')] }, 'st-01', 0)
    expect(s.acts.map((a) => a.seq)).toEqual([1])
    expect(s.summary).toContain('1 act by others')
    expect(s.findings).toEqual([])
  })
  it('counts only sign-offs reopened after lastSeenSeq', () => {
    const acts = actsOf(model, [
      ['st-01', { type: 'signoff', target: 'return', body: { level: 'preparer' } }],
      ['st-01', { type: 'adjust', target: 'F1040.1a', body: { field: 'value', to: 200, reason: 'Corrected per the W-2', evidence: ['D06'] } }],
    ])
    const s = project(model, acts, state.viewer)
    expect(s.signoffs.filter((x) => !x.valid)).toHaveLength(1)
    expect(sinceMe(model, s, 'st-02', 1).reopened).toBe(1) // reopened by #2, after I looked
    expect(sinceMe(model, s, 'st-02', 2).reopened).toBe(0) // already reopened when I looked
    expect(sinceMe(model, s, 'st-02', 2).summary).not.toContain('reopened')
  })
})
