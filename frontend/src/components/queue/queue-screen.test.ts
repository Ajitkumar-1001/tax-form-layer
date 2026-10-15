// The queue keeps exactly one h1 now that the Overview owns / (spec 2026-10-15 §8: one h1 on / and /queue), with or without
// a selected claim: the compact claim pane's title steps down to h2, while the full trace page keeps it as its h1.
// Server-rendered against the masked packet with an empty log, as masked-render.test.ts does; the navigation hooks are mocked.
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readPacket } from '@/components/records/fixture'
import { ClaimPane } from '@/components/trace/claim-pane'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { QueueScreen } from './queue-screen'

const nav = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/queue',
}))

const masked = maskPacket(readPacket()).masked
const model = buildModel(masked)
const viewer = viewerOf(masked, 'st-01')
const state = project(model, [], viewer)
const ws: Workspace = {
  model, state, viewer, identities: identities(masked), engagement: 'main', packetSha: 'sha-test',
  post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
  reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
}

const render = (el: ReactElement, query = '') => {
  nav.query = query
  return renderToString(h(WorkspaceContext, { value: ws }, el))
}
const h1s = (html: string) => html.match(/<h1[\s>][\s\S]*?<\/h1>/g)
const QUEUE_H1 = ['<h1 class="sr-only">Queue</h1>']

describe('queue screen', () => {
  it('has exactly one h1, visually hidden, when nothing is selected', () => {
    expect(h1s(render(h(QueueScreen)))).toEqual(QUEUE_H1)
  })

  // A claim, an area, an act missing from the log (ActView's nested NotFound) and an unknown ref: every view's title.
  it.each([
    ['F8949.B.N1', model.claims['F8949.B.N1'].label],
    ['area:intake_and_engagement', 'Intake &amp; identity'],
    ['act:12', 'Nothing here'],
    ['no-such-ref', 'Nothing here'],
  ])('keeps its one h1 with ?c=%s selected: the pane title is an h2', (ref, title) => {
    const html = render(h(QueueScreen), `c=${encodeURIComponent(ref)}`)
    expect(h1s(html)).toEqual(QUEUE_H1)
    // Proof the pane rendered, so the h1 count is not vacuous.
    expect(html).toContain('aria-label="Close the claim pane"')
    expect(html).toMatch(new RegExp(`<h2 class="text-lg[^"]*">${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>`))
  })
})

describe('full trace page', () => {
  it('keeps the claim title as its one h1', () => {
    const html = render(h(ClaimPane, { claimRef: 'F8949.B.N1' }))
    expect(h1s(html)).toEqual([`<h1 class="text-lg leading-snug font-semibold text-balance">${model.claims['F8949.B.N1'].label}</h1>`])
  })
})
