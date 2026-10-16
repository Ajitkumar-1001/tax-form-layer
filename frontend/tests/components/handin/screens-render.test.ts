// Server-render smoke tests of the filing, notice, firm, client, errors and about screens against the real
// model and projected act logs (no jsdom here, so no clicks: the pure logic is tested next to each screen).
// The model is built from the MASKED packet, as /api/packet serves it, and every render must show no mask
// token («…») and no dashed SSN: tokens render through <MaskedText> as •••-••-3309.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { refHref } from '@/components/atoms'
import { ClientPortal } from '@/components/client/client-portal'
import { ClientCopy } from '@/components/filing/client-copy'
import { FilingPage } from '@/components/filing/filing-page'
import { findNotice } from '@/components/filing/notice-logic'
import { NoticePage } from '@/components/filing/notice-page'
import { FirmPage } from '@/components/firm/firm-page'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import { displayMasked, isMasked, parseToken } from '@/lib/model/mask-token'
import type { Packet } from '@/lib/model/packet-types'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { AboutPage } from '@/components/handin/about-page'
import { ErrorsPage } from '@/components/handin/errors-page'

const raw = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const packet = maskPacket(raw).masked
const model = buildModel(packet)
const people = identities(packet)
const role = (id: string) => people.find((v) => v.id === id)?.role ?? 'system'

type Step = [string, ActInput] | Act

/** Derive like the server (without authorize); raw Act entries (agency results) are appended as given. */
function log(steps: Step[]): Act[] {
  const acts: Act[] = []
  for (const s of steps) {
    const seq = acts.length + 1
    if (!Array.isArray(s)) {
      acts.push({ ...s, seq })
      continue
    }
    const [actor, input] = s
    const state = project(model, acts, viewerOf(packet, 'st-03'))
    acts.push({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: '2026-10-14T12:00:00Z', season_at: state.clock, actor, actor_role: role(actor),
      type: input.type, target: input.target, refs: refsOf(input), body: input.body as Record<string, unknown>,
      derived: deriveFor(model, state, input), batch_id: null, hash: `h${seq}`, prev_hash: '',
    })
  }
  return acts
}

const agency = (fileSeq: number, jurisdiction: 'federal' | 'california', status: 'accepted' | 'rejected' | 'held', errors: { code: string; message: string }[] = []): Act => ({
  seq: 0, id: 'a', engagement: 'test', recorded_at: '2026-10-14T12:00:00Z', season_at: '2026-07-14T16:22:00Z', actor: 'system', actor_role: 'system',
  type: 'agency_result', target: `act:${fileSeq}`, refs: [`act:${fileSeq}`], body: { jurisdiction, status, errors, rule: 'disclosed test rule' },
  derived: status === 'accepted' ? { retain_until: '2033-07-14T16:22:00Z' } : {}, batch_id: null, hash: 'x', prev_hash: '',
})

function ws(viewerId: string, acts: Act[] = []): Workspace {
  const viewer = viewerOf(packet, viewerId)
  const state = project(model, acts, viewer)
  return {
    model, state, viewer, identities: people, engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const SSN = /\b\d{3}-\d{2}-\d{4}\b/
/** Renders, and fails the test if the HTML (text or attributes) carries a raw mask token or a dashed SSN. */
const render = (el: ReactElement, w: Workspace) => {
  const html = renderToString(h(WorkspaceContext, { value: w }, el))
  expect(html).not.toMatch(/«/)
  expect(html).not.toMatch(SSN)
  return html
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

const request: [string, ActInput] = ['st-03', { type: 'request_approval', target: 'return', body: {} }]
const approve = (who: string): [string, ActInput] => [who, { type: 'client_approve', target: 'act:1', body: { pin: '12345' } }]
const submit: [string, ActInput] = ['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal', 'california'] } }]
const filed = log([request, approve('cu-01'), approve('cu-02'), submit, agency(4, 'federal', 'accepted'), agency(4, 'california', 'accepted'),
  ['st-03', { type: 'clock', target: 'season', body: { to: '2028-01-27T00:00:00Z' } }]])

describe('filing desk', () => {
  it('renders the 12 steps, the matrix and the gates on an empty log', () => {
    const t = text(render(h(FilingPage), ws('st-03')))
    for (const s of packet.firm.starter_standards.required_steps) expect(t).toContain(s)
    expect(t).toContain('Whole return')
    expect(t).toContain('Blocked by 11 open steps')
    expect(t).toContain('Filing is blocked: 0 of 12 required steps done')
    expect(t).toContain('Nothing has been filed in this engagement')
    expect(t).toContain('Form 4868 with 36,000')
  })

  it('shows accepted filings, retention, the freeze, spouse approvals and the season record', () => {
    const t = text(render(h(FilingPage), ws('st-03', filed)))
    expect(t).toContain('Frozen: federal and California filed and accepted')
    expect(t).toContain('Filed and accepted: federal and California.')
    expect(t).toContain('retain until 2033-07-14')
    expect(t).toContain('Simulation rule: disclosed test rule')
    expect(t).toContain('efile rejected') // packet season record, tl-21
    expect(t).toContain('R0000-504-02')
    // tl-20 prints both signature PINs; the server masks them and the season record shows the masked form.
    expect(t).toContain('Taxpayer PIN ••••1207')
    expect(t).not.toMatch(/PIN:? ?\d/)
  })

  it('shows a rejection with its code and message', () => {
    const acts = log([submit, agency(1, 'federal', 'rejected', [{ code: 'R0000-504-02', message: 'Dependent TIN mismatch' }]), agency(1, 'california', 'held', [{ code: 'STATE-HOLD', message: 'held' }])])
    const t = text(render(h(FilingPage), ws('st-03', acts)))
    expect(t).toContain('rejected')
    expect(t).toContain('Dependent TIN mismatch')
    expect(t).toContain('STATE-HOLD')
    expect(t).toContain('E-file rejected: federal R0000-504-02; California held.')
  })
})

describe('notice room', () => {
  const doc = refHref(findNotice(model, '9999')!.notice.document)
  it('says not yet received before the clock reaches it, and does not link the notice document yet', () => {
    const html = render(h(NoticePage), ws('st-03'))
    expect(text(html)).toContain('Not yet received')
    expect(html).not.toContain(doc)
    expect(render(h(NoticePage), ws('st-03', filed))).toContain(doc)
  })
  it('maps items, warns on preconditions and links claims once received', () => {
    const t = text(render(h(NoticePage), ws('st-03', filed)))
    expect(t).toContain('Items under examination')
    expect(t).toContain('No authority to represent')
    expect(t).toContain('The engagement letter excludes examination work')
    expect(t).toContain('F8283.A1.vehicle')
    expect(t).toContain('SchC.1')
    expect(t).toContain('N-2023-CP2000')
  })
})

describe('firm', () => {
  it('renders standards verbatim, staff, engagements and time', () => {
    const t = text(render(h(FirmPage), ws('st-05')))
    for (const r of packet.firm.starter_standards.rules) expect(t).toContain(r)
    expect(t).toContain('Marcus Bell')
    expect(t).toContain('masked only')
    expect(t).toContain('Current engagement: main')
    expect(t).toContain('partner review (budget only)')
    expect(t).toContain('Fresh copy')
  })

  it('shows Fresh copy only to the firm administrator', () => {
    const t = text(render(h(FirmPage), ws('st-03')))
    expect(t).not.toContain('Fresh copy')
    expect(t).toContain('Only the firm administrator')
  })

  it('rounds summed hours for display', () => {
    const t = text(render(h(FirmPage), ws('st-05', log([
      ['st-01', { type: 'time', target: 'area:business', body: { hours: 0.1 } }],
      ['st-01', { type: 'time', target: 'area:business', body: { hours: 0.2 } }],
    ]))))
    expect(t).toContain('0.3 h')
    expect(t).not.toContain('0.30000000000000004')
  })
})

describe('client portal', () => {
  const acts = log([
    ['st-01', { type: 'note', target: 'D73', body: { kind: 'question_client', to: 'cu-01', text: 'Please upload the Halvorsen paystub', blocking: false } }],
    ['st-01', { type: 'note', target: 'D73', body: { kind: 'memo', text: 'INTERNAL memo about wages', blocking: false } }],
    ['st-02', { type: 'note', target: 'D73', body: { kind: 'review_note', text: 'INTERNAL review note', blocking: true } }],
    ['st-03', { type: 'request_approval', target: 'return', body: {} }],
  ])

  it('shows the client their question and the approval, and nothing internal', () => {
    const t = text(render(h(ClientPortal), ws('cu-01', acts)))
    expect(t).toContain('Please upload the Halvorsen paystub')
    expect(t).toContain('Approve and sign with my PIN')
    expect(t).not.toContain('INTERNAL')
    for (const f of model.findings.slice(0, 50)) expect(t).not.toContain(f.title)
  })

  it('shows a masked value in a question as •••-••-last4, never the token', () => {
    const ssn = packet.household.people.map((x) => x.ssn).find(isMasked)!
    const asked = log([['st-01', { type: 'note', target: 'D73', body: { kind: 'question_client', to: 'cu-01', text: `Is ${ssn} Theo's number?`, blocking: false } }]])
    expect(text(render(h(ClientPortal), ws('cu-01', asked)))).toContain(`Is ${displayMasked(parseToken(ssn)!)}`)
  })

  it('is a read-only preview for staff, and offers the client copy after the freeze', () => {
    expect(text(render(h(ClientPortal), ws('st-01', acts)))).toContain('You are previewing what Ngozi Okafor sees')
    expect(text(render(h(ClientPortal), ws('cu-02', filed)))).toContain('Open your copy')
  })
})

describe('client copy', () => {
  it('shows the change since v3 when adjusted, so the balance reconciles', () => {
    expect(text(render(h(ClientCopy), ws('st-03')))).not.toContain('Changes since')
    const adjusted = log([['st-01', { type: 'adjust', target: 'SchC.1', body: { field: 'value', to: 151300, reason: 'Paywell 1099-K is already inside the Atlas deposits', evidence: ['D14'] } }]])
    expect(text(render(h(ClientCopy), ws('st-03', adjusted)))).toContain('Changes since the software computed it (estimate)')
  })
})

describe('hand-in pages', () => {
  it('errors lists all 70 with live status, about renders the disclosures', () => {
    // st-04 has no clearance: the static errors map must not carry a sensitive value.
    expect(text(render(h(ErrorsPage), ws('st-04')))).toContain('•••-••-3309 vs •••-••-3390')
    const t = text(render(h(ErrorsPage), ws('st-03')))
    expect(t).toContain('Showing 70 of 70')
    expect(t).toContain('Prompt / reviewer judgment')
    const a = text(render(h(AboutPage), ws('st-03')))
    expect(a).toContain('demo identity picker, not authentication')
    expect(a).toContain('How AI was used')
  })
})
