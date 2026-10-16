// The claim drawer (spec 2026-10-15-queue-worklist §6). Base UI portals the drawer out of a server render, so its body is
// rendered alone, for each kind of view, against the masked packet with an empty log; plus the history rules it closes by.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { SUPPORT_LEGEND } from '@/components/atoms/status'
import { ClaimDrawerBody, canClose, closeAction, drawerEntry, isDrawerEntry, keepsDrawerMark, openWrite } from '@/components/queue/claim-drawer'
import { CLAIM_DRAWER_TITLE_ID } from '@/components/trace/header'
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
const state = project(model, [], viewer)
const people = identities(masked)
const ws: Workspace = {
  model, state, viewer, identities: people, engagement: 'main', packetSha: 'sha-test',
  post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
  reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
}

const render = (refId: string, value: Workspace = ws) => renderToString(h(WorkspaceContext, { value }, h(ClaimDrawerBody, { refId, onClose: () => {} })))
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('claim drawer body', () => {
  // A claim, an area, an act missing from the log (ActView's nested NotFound) and an unknown ref: every view's title.
  it.each([
    ['F8949.B.N1', model.claims['F8949.B.N1'].label],
    ['area:intake_and_engagement', 'Intake &amp; identity'],
    ['act:12', 'Nothing here'],
    ['no-such-ref', 'Nothing here'],
  ])('renders %s with the close button and the one focusable h2 that names the drawer', (ref, title) => {
    const html = render(ref)
    expect(html).toContain('aria-label="Close the claim pane"')
    expect(html).toMatch(new RegExp(`<h2 id="claim-drawer-title" tabindex="-1" class="[^"]*">${esc(title)}</h2>`))
    expect(html.match(/id="claim-drawer-title"/g)).toHaveLength(1)
    // The queue owns the page's one h1.
    expect(html).not.toMatch(/<h1[\s>]/)
  })

  it('names the heading with the one exported id', () => {
    expect(CLAIM_DRAWER_TITLE_ID).toBe('claim-drawer-title')
  })

  // Opening the drawer, Enter on the open row and j / k move focus to the heading, so keyboard focus must show there.
  it('shows keyboard focus on the heading: a focus-visible outline, not outline-none', () => {
    const cls = render('F8949.B.N1').match(/<h2 id="claim-drawer-title" tabindex="-1" class="([^"]*)"/)![1].split(' ')
    expect(cls).toEqual(expect.arrayContaining(['focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-ring']))
    expect(cls).not.toContain('outline-none')
  })

  // The close label and the heading id are pinned above for all four refs (a claim, an area, an act and an unknown ref).
  // "Assigned to" and the legend belong to the claim header, which only a claim has, so they are pinned for the claim alone.
  it("shows who the claim's area is assigned to, and the support legend under the letters", () => {
    const claim = model.claims['F8949.B.N1']
    const assignee = people.find((v) => v.id === state.assignments[claim.area])!
    const html = render(claim.id)
    expect(html).toContain(`<dt class="text-muted-foreground">Assigned to</dt><dd>${assignee.name} (${assignee.role.replaceAll('_', ' ')})</dd>`)
    expect(html).toContain(SUPPORT_LEGEND)
  })

  // A blocking review note whose text quotes Theo's SSN token: the act's own view and the claim it sits on both show the
  // token in its display form, never raw. Read at run time: the eq tag is an HMAC keyed by MASK_SECRET.
  it('masks a token in a blocking note, in the act view and on the claim it targets', () => {
    const theo = masked.household.people.find((p) => p.id === 'theo')!.ssn
    const acts = actsOf(model, [
      ['st-02', { type: 'note', target: 'household:theo#ssn', body: { kind: 'review_note', to: 'st-01', text: `Check Theo ${theo} before filing`, blocking: true } }],
    ])
    expect(acts[0].body.text).toContain('«')
    const s = project(model, acts, viewer)
    const noted: Workspace = { ...ws, state: s, can: (i) => authorize(model, s, i, viewer) }
    // The act view quotes the note; the claim's own view shows the SSN value (the same token) in display form.
    expect(render('act:1', noted).replace(/<[^>]+>/g, '')).toContain('Check Theo •••-••-3309')
    for (const ref of ['act:1', 'household:theo#ssn']) {
      const html = render(ref, noted)
      expect(html, ref).toContain('•••-••-3309')
      expect(html, ref).not.toContain('«')
    }
  })
})

describe('drawer history', () => {
  it('marks the entry opening pushes with a new object each time (Next writes its keys into it)', () => {
    expect(drawerEntry()).toEqual({ claimDrawer: true })
    expect(drawerEntry()).not.toBe(drawerEntry())
  })

  it("reads the mark beside Next's own keys, and nothing else as one", () => {
    expect(isDrawerEntry({ ...drawerEntry(), __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} })).toBe(true)
    expect(isDrawerEntry({ __NA: true })).toBe(false)
    expect(isDrawerEntry({ claimDrawer: 'yes' })).toBe(false)
    expect(isDrawerEntry(null)).toBe(false)
  })

  it('closes by going back over the entry opening pushed, else by a replace (a deep link)', () => {
    expect(closeAction({ claimDrawer: true, __NA: true })).toBe('back')
    expect(closeAction({ __NA: true })).toBe('replace')
    expect(closeAction(null)).toBe('replace')
  })

  it('keeps the mark over a write of ?c alone, and drops it for a filter write, so the next close replaces (spec §6)', () => {
    const mark = { ...drawerEntry(), __NA: true }
    // A row click, Enter or j / k while the drawer is open.
    expect(keepsDrawerMark({ c: 'SchC.1' }, true, mark)).toBe(true)
    // A filter write while it is open: the close that follows must not go back to the entry with the old filters.
    expect(keepsDrawerMark({ area: 'business' }, true, mark)).toBe(false)
    expect(keepsDrawerMark({ q: null }, true, mark)).toBe(false)
    expect(keepsDrawerMark({ area: null, mine: '0', q: null }, true, mark)).toBe(false)
    expect(keepsDrawerMark({ c: 'SchC.1', area: 'business' }, true, mark)).toBe(false)
    expect(closeAction(keepsDrawerMark({ area: 'business' }, true, mark) ? drawerEntry() : null)).toBe('replace')
    // Removing ?c, and a replace on an entry that opening did not push (a deep link).
    expect(keepsDrawerMark({ c: null }, false, mark)).toBe(false)
    expect(keepsDrawerMark({ c: 'SchC.1' }, true, { __NA: true })).toBe(false)
  })

  // Read against the live ?c (window.location), not the rendered one: Next commits useSearchParams in a transition, so a
  // second click before it lands would otherwise push a second entry with the same ?c (and leave Esc stuck).
  it('pushes when opening from closed, replaces when switching claims, and writes nothing for the open claim', () => {
    expect(openWrite(null, 'Sch3.10')).toBe('push')
    expect(openWrite('Sch3.10', 'SchC.1')).toBe('replace')
    expect(openWrite('Sch3.10', 'Sch3.10')).toBeNull()
  })

  it('a double click before ?c commits writes one entry: the second activation sees the live ?c', () => {
    let live: string | null = null
    const writes = ['Sch3.10', 'Sch3.10'].map((ref) => {
      const w = openWrite(live, ref)
      if (w) live = ref
      return w
    })
    expect(writes).toEqual(['push', null])
  })

  it('closes only while the live ?c is the claim the drawer was last pointed at, and once per close', () => {
    // Open on X, nothing closing.
    expect(canClose('X', 'X', null)).toBe(true)
    // Esc right after j / k: the live ?c and the drawer's ref are already Y while the rendered ?c is still X (parked T5(b)).
    expect(canClose('Y', 'Y', null)).toBe(true)
    // The same Esc reported twice in one tick: the first set the guard, Back lands later.
    expect(canClose('X', 'X', 'X')).toBe(false)
    // Back already took ?c away (it lands before the render commits).
    expect(canClose(null, 'X', null)).toBe(false)
    // ?c moved somewhere the drawer was not pointed at (a traversal not yet rendered).
    expect(canClose('Z', 'X', null)).toBe(false)
    // After Back lands on another entry with the same ?c, popstate clears the guard and the next Esc closes again.
    expect(canClose('X', 'X', null)).toBe(true)
  })
})
