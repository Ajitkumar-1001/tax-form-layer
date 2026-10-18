// The top bar's season clock, server-rendered per viewer against the real model and the real authorize() (no DOM, so no
// clicks). The hover fill, the pointer, the arrow's look, Tab skipping the static text and the popover opening are browser
// checks; here: which viewers get a control at all, and what the others get instead.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readPacket } from '../records/fixture'
import { SeasonClock } from '@/components/shell/season-clock'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

const packet = maskPacket(readPacket()).masked
const model = buildModel(packet)

const REFUSED = 'Only the partner or the firm administrator moves the season clock.'
// A <button> (a quoted attribute may hold ">") whose content, nested tags included, reaches "Next:".
const NEXT_IN_BUTTON = /<button(?:\s+[\w:-]+(?:="[^"]*")?)*\s*>(?:(?!<\/button>)[\s\S])*Next:/

/** The clock chip as `viewerId` sees it on a fresh engagement (empty log, so there is a next event), and that event's label. */
function chipFor(viewerId: string): { html: string; label: string } {
  const viewer = viewerOf(packet, viewerId)
  const state = project(model, [], viewer)
  const ws: Workspace = {
    model, state, viewer, identities: identities(packet), engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
  const label = state.nextEvent?.label
  if (!label) throw new Error('the fixture has no next event, so the chip would render no "Next:" at all')
  // React's text separators (<!-- -->) out, so "Next:</span> <label>" is one run of text.
  return { html: renderToString(h(WorkspaceContext, { value: ws }, h(SeasonClock))).replaceAll('<!-- -->', ''), label }
}

/** What the chip offers: the next event in words, a control holding it, how many controls, the arrow, the refusal in words, and the tour's anchor. */
function offer({ html, label }: { html: string; label: string }) {
  return {
    nextShown: html.includes(`Next:</span> ${label}`),
    nextInButton: NEXT_IN_BUTTON.test(html),
    buttons: html.match(/<button\b/g)?.length ?? 0,
    arrow: html.includes('lucide-chevron-right'),
    reasonAsTitle: html.includes(`title="${REFUSED}"`),
    reasonAsText: html.includes(`<span class="sr-only">${REFUSED}</span>`),
    tourAnchor: html.includes('<span data-tour="season-time" '), // the time, whoever the viewer: the tour's "season-time" stop points at it
  }
}

describe('SeasonClock', () => {
  it('only a viewer who may move the clock gets a Next button', () => {
    // Priya (preparer), Daniel (reviewer) and Marcus (preparer): the next event is text, with the reason as title and as sr-only text.
    for (const id of ['st-01', 'st-02', 'st-04']) {
      expect(offer(chipFor(id)), id).toEqual({ nextShown: true, nextInButton: false, buttons: 0, arrow: false, reasonAsTitle: true, reasonAsText: true, tourAnchor: true })
    }
    // Helen (partner) and Jo (firm administrator): the control, with its arrow and no refusal.
    for (const id of ['st-03', 'st-05']) {
      expect(offer(chipFor(id)), id).toEqual({ nextShown: true, nextInButton: true, buttons: 1, arrow: true, reasonAsTitle: false, reasonAsText: false, tourAnchor: true })
    }
  })
})
