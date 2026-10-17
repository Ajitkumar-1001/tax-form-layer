// Focus returns on the trace pane (act-host.tsx, returnFocusTo): each of these containers outlives the control that opens
// an act from it, so the dialog hands focus back to it once the opener is gone. Server render of ClaimPane on the masked
// packet, as claim-drawer.test.ts does for the drawer body; no navigation, so no next/navigation mock.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { ClaimPane } from '@/components/trace/claim-pane'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

const masked = maskPacket(readPacket()).masked
const model = buildModel(masked)
const viewer = viewerOf(masked, 'st-01')
const people = identities(masked)

function wsOf(acts: ReturnType<typeof actsOf>): Workspace {
  const state = project(model, acts, viewer)
  return {
    model, state, viewer, identities: people, engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const render = (refId: string, w: Workspace) => renderToString(h(WorkspaceContext, { value: w }, h(ClaimPane, { claimRef: refId })))
const openTag = (html: string, from: number) => html.slice(from, html.indexOf('>', from) + 1)

describe('claim pane focus returns', () => {
  // st-01 adjusts a line, then st-02 leaves a blocking note on it: the adjust is revertable, the note is open.
  const log = actsOf(model, [
    ['st-01', { type: 'adjust', target: 'F1040.1a', body: { field: 'value', to: 200, reason: 'Matches the W-2 box 1', evidence: [] } }],
    ['st-02', { type: 'note', target: 'F1040.1a', body: { kind: 'review_note', to: 'st-01', text: 'Please tie this line out', blocking: true } }],
  ])
  const [adjust, note] = log.map((a) => `act:${a.seq}`)

  it('marks finding cards, act rows and an open note as focus returns', () => {
    const marked = (tag: string) => {
      expect(tag).toContain(' data-focus-return="true"')
      expect(tag).toContain(' tabindex="-1"')
      expect(tag).toContain('focus-visible:ring-2')
    }

    // A finding card: the fix button gives way to "Resolved by" once the act lands.
    const findings = render('household:theo#ssn', wsOf([]))
    const cards = [...findings.matchAll(/<article\b/g)].map((m) => openTag(findings, m.index))
    expect(cards.length).toBeGreaterThan(0)
    for (const tag of cards) marked(tag)

    // An act row: Revert goes once the act is reverted.
    const actView = render(adjust, wsOf(log))
    const rows = [...actView.matchAll(/<li\b/g)].map((m) => m.index).filter((at) => actView.slice(at, actView.indexOf('</li>', at)).includes('Revert'))
    expect(rows).toHaveLength(1)
    marked(openTag(actView, rows[0]))

    // The open note's block: Reply and Resolve go once it is resolved.
    const noteView = render(note, wsOf(log))
    const heading = noteView.indexOf('>Open note</h2>')
    expect(heading).toBeGreaterThan(-1)
    marked(openTag(noteView, noteView.lastIndexOf('<section', heading)))
    // Opt-in: the page's other sections (Cites, Recorded) carry no marker; only the act's row and its note do.
    expect(noteView.match(/ data-focus-return="true"/g)).toHaveLength(2)
  })
})
