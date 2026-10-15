// Server-render smoke test of every act form against the real model (no jsdom in this repo, so no clicks).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { WorkspaceContext } from '@/components/workspace/context'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import type { Finding } from '@/lib/model/checks/types'
import type { Packet } from '@/lib/model/packet-types'
import { project, scopeOf } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { ActForm } from './act-dialog'
import { ActButton, FindingFixButton } from './act-host'
import { normalizeRequest } from './draft'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)

function workspace(viewerId: string, can: Workspace['can'] = () => ({ ok: true })): Workspace {
  const viewer = viewerOf(packet, viewerId)
  return {
    model, state: project(model, [], viewer), viewer, identities: identities(packet), engagement: 'main', packetSha: 'test',
    post: async () => ({ ok: true, acts: [] }), can, reveal: async () => ({ ok: false, reason: 'n/a' }),
    switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

/** The provider's can(): the real authorize() on the same state the form reads. */
function real(viewerId: string): Workspace {
  const ws = workspace(viewerId)
  return { ...ws, can: (i) => authorize(model, ws.state, i, ws.viewer) }
}

const render = (req: OpenActRequest, ws = workspace('st-01')) =>
  renderToString(h(Dialog, { open: true }, h(WorkspaceContext, { value: ws }, h(ActForm, { req: normalizeRequest(req), onDone: () => {}, onOpen: () => {} }))))

const CASES: [OpenActRequest, string][] = [
  [{ type: 'verify', target: 'F1040.19' }, 'Agreed to source document'],
  [{ type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis', to: 19100 } }, 'Routes to partner'],
  [{ type: 'decide', target: 'F8867.status' }, 'Form 8867 paid-preparer due diligence'],
  [{ type: 'decide', target: 'whatif:standard_deduction' }, 'Exact engine result from the packet what-if.'],
  [{ type: 'dispose', target: 'D12' }, 'Save disposition'],
  [{ type: 'note', target: 'F1040.19' }, 'Add note'],
  [{ type: 'reply', target: 'act:1' }, 'Send reply'],
  [{ type: 'resolve', target: 'chk:CHK-01:x' }, 'What was done'],
  [{ type: 'attach', target: 'D11' }, 'Filed against'],
  [{ type: 'signoff', target: 'business' }, 'Business (Sch C)'],
  [{ type: 'revert', target: 'act:1' }, 'the revert is itself logged'],
  [{ type: 'assign', target: 'business' }, 'Assignee'],
  [{ type: 'time', target: 'business' }, 'Hours'],
  [{ type: 'request_approval', target: 'return' }, 'Send for approval'],
  [{ type: 'file', target: 'return' }, 'California (FTB)'],
  [{ type: 'amend_open', target: 'return' }, 'Open amendment'],
  [{ type: 'client_approve', target: 'act:1' }, '5-digit signature PIN'],
  [{ type: 'clock', target: 'season' }, 'Advance clock'],
]

describe('act forms render', () => {
  it.each(CASES)('%o shows %s', (req, text) => {
    const html = render(req)
    expect(html).toContain(text)
    expect(html).toContain('type="submit"')
  })

  it('a refusal replaces the submit button with the reason', () => {
    const reason = 'You prepared Sch3.10 (timeline:extension-2026-04-14). Route to another reviewer or the partner.'
    const html = render({ type: 'signoff', target: 'payments_and_filing' }, workspace('st-02', () => ({ ok: false, reason })))
    expect(html).toContain(reason)
    expect(html).not.toContain('type="submit"')
  })

  it('the adjust preview strikes the value it replaces and shows the effect', () => {
    const html = render({ type: 'adjust', target: 'F1040.19', prefill: { to: 0 } })
    expect(html).toMatch(/<s[^>]*>400<\/s>/)
    expect(html).toContain('+400')
  })

  it('reviewers are steered to a review note; a partner may sign at reviewer level', () => {
    expect(render({ type: 'adjust', target: 'F1040.19' }, workspace('st-02'))).toContain('Propose it as a review note')
    expect(render({ type: 'note', target: 'F1040.19' }, workspace('st-02'))).toContain('Blocking: approval and filing wait')
    expect(render({ type: 'signoff', target: 'return' }, workspace('st-03'))).toContain('>Level</label>')
  })

  it('sign-off states its scope with the same count the server fingerprints', () => {
    expect(render({ type: 'signoff', target: 'business' })).toContain(`>${scopeOf(model, 'area:business').length.toLocaleString('en-US')}<`)
  })

  it('buttons: disabled with the reason only when every level the role has is refused', () => {
    const button = (ws: Workspace) => renderToString(h(WorkspaceContext, { value: ws }, h(ActButton, { type: 'verify', target: 'Sch3.10' }, 'Verify')))
    const reviewerOnly: Workspace['can'] = (i) => (i.type === 'verify' && i.body.level === 'reviewer' ? { ok: false, reason: 'You prepared Sch3.10' } : { ok: true })
    expect(button(workspace('st-02', reviewerOnly))).not.toContain(' disabled=""')
    const html = button(workspace('st-02', () => ({ ok: false, reason: 'Frozen' })))
    expect(html).toContain(' disabled=""')
    expect(html).toContain('title="Frozen"')
    const finding: Finding = { id: 'chk:x', check: 'CHK-01', family: 'printed_vs_extracted', title: 't', why: 'w', severity: 'high', signal: 'computed', claims: [], evidence: [], knownSince: '' }
    expect(renderToString(h(WorkspaceContext, { value: workspace('st-01') }, h(FindingFixButton, { finding })))).toContain('Resolve…')
  })
})

// Regression (review must-fix 1 and 3): buttons and forms judged by the real authorize(), not a stub that says yes.
describe('with the real authorize()', () => {
  const html = (ws: Workspace, el: ReturnType<typeof h>) => renderToString(h(WorkspaceContext, { value: ws }, el))
  const disabled = (s: string) => s.includes(' disabled=""')
  const state0 = project(model, [], viewerOf(packet, 'st-01'))
  it('an adjust button is enabled before a new value is typed', () => {
    for (const id of ['st-01', 'st-02', 'st-03']) {
      expect(disabled(html(real(id), h(ActButton, { type: 'adjust', target: 'F1040.19' }, 'Adjust')))).toBe(false)
    }
    expect(disabled(html(real('st-01'), h(ActButton, { type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis' } }, 'Adjust')))).toBe(false)
  })

  it('refusals that typing cannot fix still disable the button, with the reason', () => {
    const s = html(real('st-05'), h(ActButton, { type: 'adjust', target: 'F1040.19' }, 'Adjust'))
    expect(disabled(s)).toBe(true)
    expect(s).toContain('firm administrator')
  })

  it('a dispose fix that needs a ref is enabled even when the check names no ref', () => {
    // authorize() checks body.findings are real and visible, so take a real finding on a document and strip its ref.
    const onDoc = model.findings.find((f) => state0.findings[f.id]?.visible && model.claims[f.claims[0]]?.kind === 'doc')!
    const fix = { act: 'dispose' as const, target: onDoc.claims[0], disposition: 'duplicate_of', label: 'Mark as a duplicate' }
    expect(disabled(html(real('st-01'), h(FindingFixButton, { finding: { ...onDoc, claims: [onDoc.claims[0]], evidence: [], fix } })))).toBe(false)
    // The finding the first review named (review defect 1: no silent pass when it is missing).
    const named = model.findingsById['chk:CHK-18:D10']
    expect(named?.fix?.act).toBe('dispose')
    expect(disabled(html(real('st-01'), h(FindingFixButton, { finding: named })))).toBe(false)
  })

  it('an adjust button pre-filled with a what-if is enabled before the amount is typed (review defect 2)', () => {
    const alts = packet.what_if.alternatives.filter((a) => a.changed_lines.some((c) => model.lines[c.key]))
    expect(alts.length).toBe(4)
    for (const a of alts) {
      const target = a.changed_lines.find((c) => model.lines[c.key])!.key
      const req: OpenActRequest = { type: 'adjust', target, prefill: { what_if: a.id } }
      expect(disabled(html(real('st-01'), h(ActButton, req, 'Adjust')))).toBe(false)
      expect(render(req, real('st-01'))).toContain('type="submit"')
    }
  })

  it('a finding without a fix opens an enabled Resolve…', () => {
    const open = Object.values(state0.findings).find((f) => f.visible && f.status === 'open' && !model.findingsById[f.id].fix)
    expect(open).toBeDefined()
    const s = html(real('st-01'), h(FindingFixButton, { finding: model.findingsById[open!.id] }))
    expect(s).toContain('Resolve…')
    expect(disabled(s)).toBe(false)
  })

  it('an empty form keeps its submit button, so its field errors can show', () => {
    expect(render({ type: 'adjust', target: 'F1040.19' }, real('st-01'))).toContain('type="submit"')
    expect(render({ type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis' } }, real('st-01'))).toContain('type="submit"')
    expect(render({ type: 'dispose', target: 'D12', prefill: { disposition: 'duplicate_of' } }, real('st-01'))).toContain('type="submit"')
  })
})
