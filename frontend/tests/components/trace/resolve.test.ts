import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { refHref } from '@/components/atoms/format'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { viewerOf } from '@/lib/model/viewer'
import {
  actFiles, attachmentsFor, claimFindingIds, decodeRefParam, findingsCiting, groupEvidence, historyFor, linkedComms, netEffect, pageRefForms, resolveRef,
  signoffsCovering, valueRows, viewLogFor, whatIfsTouching,
} from '@/components/trace/resolve'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)

describe('decodeRefParam', () => {
  it('decodes the encoded single segment refHref produces', () => {
    for (const ref of ['F8949.B.N1', 'household:theo#ssn', 'py:/prior_preparer_workpaper/notes/0', 'doc:D31#page32']) {
      const seg = refHref(ref).slice('/r/'.length)
      expect(decodeRefParam([seg])).toBe(ref)
    }
  })
  it('joins hand-typed segments and keeps malformed escapes raw', () => {
    expect(decodeRefParam(['py:', 'prior_preparer_workpaper', 'notes', '0'])).toBe('py:/prior_preparer_workpaper/notes/0')
    expect(decodeRefParam(['%E0%A4%A'])).toBe('%E0%A4%A')
    expect(decodeRefParam(undefined)).toBe('')
  })
})

describe('resolveRef', () => {
  const kind = (ref: string) => resolveRef(model, ref).kind
  it('resolves every claim kind to its claim', () => {
    for (const ref of ['F8949.B.N1', 'D28', 'qa-01', 'msg-01', 'call-01', 'household:theo#ssn', 'step:1', 'whatif:equipment_section179', 'diag:DIGITAL_ASSET_BASIS_MISSING', 'py:/prior_preparer_workpaper/notes/0']) {
      expect(kind(ref), ref).toBe('claim')
    }
  })
  it('resolves pages, reads, findings, acts and areas', () => {
    expect(resolveRef(model, 'doc:D31#page32')).toMatchObject({ kind: 'page', page: 32 })
    expect(resolveRef(model, 'D23#page3')).toMatchObject({ kind: 'page', page: 3 })
    expect(kind('ev-0498')).toBe('ev')
    expect(kind('chk:CHK-02:ev-0498')).toBe('finding')
    expect(resolveRef(model, 'act:12')).toMatchObject({ kind: 'act', seq: 12 })
    expect(kind('area:business')).toBe('area')
  })
  it('shows the JSON value behind py:, agency:, ref: and other packet locations', () => {
    expect(resolveRef(model, 'py:/carryovers_into_2025/capital_loss_short')).toMatchObject({ kind: 'data', value: packet.prior_years.carryovers_into_2025.capital_loss_short })
    expect(resolveRef(model, 'agency:/irs_account_transcript_2025/0')).toMatchObject({ kind: 'data', value: { as_of: '2026-03-12' } })
    expect(resolveRef(model, 'ref:param.salt_cap')).toMatchObject({ kind: 'data', value: 40000 })
    expect(resolveRef(model, 'ref:fx.SEK.2024_average')).toMatchObject({ kind: 'data', value: 10.56 })
    expect(resolveRef(model, 'household:theo')).toMatchObject({ kind: 'data', value: { id: 'theo' } })
    expect(resolveRef(model, 'v2')).toMatchObject({ kind: 'data', value: { version: 'v2' } })
    expect(resolveRef(model, 'cu-01')).toMatchObject({ kind: 'data', value: { id: 'cu-01' } })
  })
  it('treats a required entry that is not a line as an entry with its findings', () => {
    const r = resolveRef(model, 'F1040.digital_assets')
    expect(r.kind).toBe('entry')
    expect(r.kind === 'entry' && r.findings.map((f) => f.id)).toEqual(['chk:CHK-49:F1040.digital_assets'])
  })
  it('is graceful about anything else', () => {
    for (const ref of ['nonsense!', 'ev-9999', 'D99', 'doc:D28#page99', 'chk:nope', 'py:/no/such', 'act:x', 'area:nope']) {
      expect(kind(ref), ref).toBe(ref === 'doc:D28#page99' ? 'page' : 'unknown')
    }
  })
})

describe('evidence', () => {
  it('groups a finding evidence pair into pages side by side', () => {
    const f = model.findingsById['chk:CHK-06:F8949.B.N1']
    const { pages, other } = groupEvidence(model, f.evidence)
    expect(pages).toEqual([
      { doc: 'D28', page: 3, focus: ['ev-0497', 'ev-0498'] },
      { doc: 'D11', page: 2, focus: ['ev-0066'] },
      { doc: 'D08', page: 1, focus: ['ev-0027'] },
    ])
    expect(other).toEqual([])
  })
  it('keeps non-page refs apart', () => {
    expect(groupEvidence(model, ['qa-01', 'ref:param.salt_cap', 'D28']).other).toEqual(['qa-01', 'ref:param.salt_cap', 'D28'])
  })
  it('lists findings on a document\'s pages and reads on its trace', () => {
    const ids = claimFindingIds(model, model.claims.D23)
    expect(ids.some((id) => id.startsWith('chk:CHK-17:'))).toBe(true)
    expect(claimFindingIds(model, model.claims['F8949.B.N1'])).toEqual(model.findingsByClaim['F8949.B.N1'])
  })
  it('finds the findings that cite a read', () => {
    expect(findingsCiting(model, ['ev-1045']).map((f) => f.id)).toContain('chk:CHK-01:ev-1045')
  })
})

describe('built', () => {
  it('lists 2024 and engine versions with the change from the row before', () => {
    const rows = valueRows(model.claims['F1040.1a'])
    expect(rows.map((r) => r.label)).toEqual(['2024', 'v1', 'v2', 'v3'])
    expect(rows[1]).toMatchObject({ value: 212400, delta: 212400 - 156039 })
    expect(rows[1].pct).toBeCloseTo(36.12, 1)
    expect(rows[2]).toMatchObject({ delta: 0, pct: 0 })
  })
  it('lists what-if alternatives that change a line with exact deltas', () => {
    expect(whatIfsTouching(model, 'F4562-C.12')).toEqual([
      expect.objectContaining({ id: 'equipment_section179', old: 0, new: 38000, fed: 0, ca: -1050 }),
    ])
  })
})

describe('history', () => {
  let seq = 0
  const act = (type: Act['type'], target: string, body: Record<string, unknown>, extra: Partial<Act> = {}): Act => {
    seq++
    return {
      seq, id: `a${seq}`, engagement: 'main', recorded_at: `2026-10-14T10:00:${String(seq).padStart(2, '0')}Z`, season_at: '2026-06-23T06:05:00Z',
      actor: 'st-01', actor_role: 'preparer', type, target, refs: refsOf({ type, target, body } as ActInput),
      body, derived: {}, batch_id: null, hash: '', prev_hash: '', ...extra,
    }
  }
  const acts: Act[] = [
    act('adjust', 'F8949.B.N1', { field: 'basis', to: 19100, reason: 'D11 adjusted basis', evidence: ['ev-0066'] }, { derived: { from: 0, effect: { fed: -6647, ca: -1222, basis: 'rate', category: 'stcg' }, needs_partner: true, amendment: 0 } }),
    act('note', 'F8949.B.N1', { kind: 'question_client', text: 'Do you have the supplement?', blocking: false }),
    act('reply', 'act:2', { text: 'Attached', attachments: [{ name: 'd11.txt', mime: 'text/plain', size: 2, data_base64: 'aGk=' }] }, { actor: 'cu-01', actor_role: 'client' }),
    act('attach', 'F8949.B.N1', { label: 'Broker letter', text: 'pasted', filed_against: ['F8949.B.N1'] }),
    act('adjust', 'F8949.B.N1', { field: 'value', to: 19000, reason: 'test then revert', evidence: [] }, { derived: { from: 19240, effect: { fed: -100, ca: 0, basis: 'rate', category: 'stcg' }, needs_partner: false, amendment: 0 } }),
    act('revert', 'act:5', { reason: 'wrong' }),
    act('view_sensitive', 'household:theo#ssn', { eq: 'abc', kind: 'ssn', context: 'household:theo#ssn', denied: false }),
    act('dispose', 'msg-01', { disposition: 'applied_to', ref: 'F8949.B.N1', reason: 'basis answer' }),
  ]
  const state = project(model, acts, viewerOf(packet, 'st-01'))

  it('lists acts on the claim and follow-ups on them, reverted ones marked', () => {
    const rows = historyFor(state, ['F8949.B.N1'])
    expect(rows.map((r) => [r.act.seq, r.reverted, r.revertable])).toEqual([
      [1, false, true], [2, false, true], [3, false, true], [4, false, true], [5, true, false], [6, false, false], [8, false, true],
    ])
  })
  it('nets only live adjusts', () => {
    expect(netEffect(state, 'F8949.B.N1')).toEqual({ fed: -6647, ca: -1222, count: 1 })
  })
  it('collects attachments and replies with files as data URLs', () => {
    const rows = attachmentsFor(state, 'F8949.B.N1')
    expect(rows.map((r) => [r.seq, r.label, r.files.map((f) => f.href)])).toEqual([
      [3, 'Reply on act:2', ['data:text/plain;base64,aGk=']],
      [4, 'Broker letter', []],
    ])
  })
  it('turns an act\'s files into data URLs', () => {
    expect(actFiles(acts[2]).map((f) => [f.name, f.href])).toEqual([['d11.txt', 'data:text/plain;base64,aGk=']])
    expect(actFiles(acts[3])).toEqual([])
  })
  it('links comms disposed as applied to the claim', () => {
    expect(linkedComms(model, state, 'F8949.B.N1', ['ev-0493'])).toEqual(['msg-01'])
  })
  it('drops a comm whose applied_to dispose was reverted or superseded, as the header does', () => {
    const reverted = project(model, [...acts, act('revert', 'act:8', { reason: 'wrong line' })], viewerOf(packet, 'st-01'))
    expect(reverted.claims['msg-01'].disposition).toBeUndefined()
    expect(linkedComms(model, reverted, 'F8949.B.N1', ['ev-0493'])).toEqual([])
    const redisposed = project(model, [...acts, act('dispose', 'msg-01', { disposition: 'informational', reason: 'no change' })], viewerOf(packet, 'st-01'))
    expect(linkedComms(model, redisposed, 'F8949.B.N1', ['ev-0493'])).toEqual([])
  })
  it('collects history for both spellings of a page ref', () => {
    expect(pageRefForms('D23', 3)).toEqual(['doc:D23#page3', 'D23#page3'])
    const page = project(model, [
      act('note', 'D23#page3', { kind: 'question_client', text: 'posted from a bare URL', blocking: false }),
      act('note', 'doc:D23#page3', { kind: 'question_client', text: 'p3 total?', blocking: false }),
    ], viewerOf(packet, 'st-01'))
    expect(historyFor(page, pageRefForms('D23', 3)).map((r) => r.act.target)).toEqual(['D23#page3', 'doc:D23#page3'])
  })
  it('finds view-log rows by context', () => {
    expect(viewLogFor(state, 'household:theo#ssn', null).map((a) => a.seq)).toEqual([7])
    expect(viewLogFor(state, 'F8949.B.N1', 19240)).toEqual([])
  })
  it('lists sign-offs that cover the claim', () => {
    expect(signoffsCovering(state, model.claims['F8949.B.N1'])).toEqual([])
  })
})
