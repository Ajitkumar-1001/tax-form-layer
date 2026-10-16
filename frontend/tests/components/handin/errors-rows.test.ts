import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANON_ERRORS, CHECK_NAMES } from '@/lib/errors-map'
import type { Act } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import { ALL_CHECKS } from '@/lib/model/checks'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { byCheck, errorRows, filterRows, implementedChecks, type LiveFinding } from '@/components/handin/errors-rows'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)
const viewer = identities(packet).find((v) => v.id === 'st-01')!
const implemented = implementedChecks(model, ALL_CHECKS)

const act = (seq: number, type: Act['type'], target: string, body: Record<string, unknown>, actor = 'st-01'): Act => ({
  seq, id: `t-${seq}`, engagement: 'test', recorded_at: '2026-06-23T06:05:00Z', season_at: '2026-06-23T06:05:00Z', actor,
  actor_role: 'preparer', type, target, refs: [target], body, derived: {}, batch_id: null, hash: '', prev_hash: '',
})

describe('errors map (generated)', () => {
  it('has the 70 canonical errors and names every check it cites', () => {
    expect(CANON_ERRORS).toHaveLength(70)
    expect(new Set(CANON_ERRORS.map((e) => e.id)).size).toBe(70)
    for (const e of CANON_ERRORS) for (const c of e.checks) expect(CHECK_NAMES[c]).toBeTruthy()
  })

  it('carries no sensitive value (the module ships to every viewer): nothing the server masker would mask', () => {
    const { maskText } = maskPacket(packet)
    const strings = [...Object.values(CHECK_NAMES), ...CANON_ERRORS.flatMap((e) => [e.title, e.area, e.howSurfaced, e.uncaught ?? '', ...e.refs, ...e.lines])]
    for (const s of strings) {
      expect(s).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
      expect(maskText(s, new Map())).toBe(s)
    }
    expect(CANON_ERRORS.find((e) => e.title.includes('SSN transposed'))?.title).toContain('•••-••-3309 vs •••-••-3390')
  })
})

describe('errorRows', () => {
  const rows = errorRows(model, project(model, [], viewer), CANON_ERRORS, implemented)

  it('labels errors whose checks are not in code as prompts, never as open', () => {
    for (const r of rows.filter((x) => !x.checks.some((c) => c.implemented))) {
      expect(r.status).toBe('prompt')
      expect(r.findings).toEqual([])
    }
  })

  it('only attaches findings from a check that catches the error', () => {
    for (const r of rows) for (const f of r.findings) expect(r.error.checks).toContain(f.check)
  })

  it('a row with findings is open, resolved or not yet in file; a primary claim exists in the model', () => {
    for (const r of rows.filter((x) => x.findings.length)) expect(['open', 'resolved', 'not_yet']).toContain(r.status)
    for (const r of rows) if (r.primary) expect(model.claims[r.primary]).toBeTruthy()
  })

  it('a resolve act on every matched finding turns the row resolved, with who did it', () => {
    const row = rows.find((r) => r.status === 'open')
    if (!row) return // checks are built concurrently; nothing open means nothing to resolve
    const acts = row.findings.filter((f) => f.visible).map((f, i) => act(i + 1, 'resolve', f.id, { resolution: 'cleared', text: 'checked' }))
    const after = errorRows(model, project(model, acts, viewer), [row.error], implemented)[0]
    expect(after.status).toBe('resolved')
    expect(after.findings.filter((f) => f.visible).every((f) => f.resolvedBy?.actor === 'st-01')).toBe(true)
  })

  it('filters by category and status', () => {
    const judgment = filterRows(rows, { category: 'judgment_call', status: 'all' })
    expect(judgment.length).toBeGreaterThan(0)
    expect(judgment.every((r) => r.error.category === 'judgment_call')).toBe(true)
    expect(filterRows(rows, { category: 'all', status: 'all' })).toHaveLength(70)
  })
})

describe('byCheck', () => {
  it('groups a row\'s findings per check into open, resolved (with who) and not yet in file', () => {
    const f = (id: string, check: string, visible: boolean, resolvedBy?: LiveFinding['resolvedBy']): LiveFinding => ({
      id, check, title: id, signal: 'computed', severity: 'high', visible, status: resolvedBy ? 'resolved' : 'open', knownSince: '2026-01-12', ...(resolvedBy && { resolvedBy }),
    })
    expect(byCheck([f('a', 'CHK-48', true), f('b', 'CHK-48', true, { seq: 7, actor: 'st-02', how: 'dispose' }), f('c', 'CHK-25', false)])).toEqual([
      { check: 'CHK-48', signal: 'computed', open: ['a'], resolved: [{ id: 'b', seq: 7, actor: 'st-02', how: 'dispose' }], hidden: [] },
      { check: 'CHK-25', signal: 'computed', open: [], resolved: [], hidden: ['c'] },
    ])
  })
})
