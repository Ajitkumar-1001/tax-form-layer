// Server-render tests of the overview's replay-safe building blocks against the masked model the browser uses.
// No jsdom here, so no clicks. ActButton's act host needs no provider: its context defaults to a no-op opener.
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readPacket } from '@/components/records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { displayMasked, isMasked, parseToken } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { OvAct, OvMasked, ReplayContext } from './replay-safe'

const packet = maskPacket(readPacket()).masked
const model = buildModel(packet)

function ws(viewerId: string): Workspace {
  const viewer = viewerOf(packet, viewerId)
  const state = project(model, [], viewer)
  return {
    model, state, viewer, identities: identities(packet), engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const render = (el: ReactElement, viewerId: string, replay = false) =>
  renderToString(h(WorkspaceContext, { value: ws(viewerId) }, h(ReplayContext, { value: replay }, el)))

// The same request, allowed for the firm administrator (st-05) and refused for the preparer (st-01).
const assign: OpenActRequest = { type: 'assign', target: 'area:business' }
const REFUSED = 'Assigning work is a reviewer, partner or administrator act.'
const act = (whenRefused: 'explain' | 'hide') => h(OvAct, { request: assign, whenRefused, size: 'sm', children: 'Reassign' })

const ssn = packet.household.people.map((p) => p.ssn).find(isMasked)!
const shown = displayMasked(parseToken(ssn)!)
const masked = h(OvMasked, { text: `SSN ${ssn} on the W-2`, context: 'D06' })

describe('OvAct', () => {
  it('live and allowed: an enabled act button', () => {
    const html = render(act('explain'), 'st-05')
    expect(html).toMatch(/<button[^>]*>Reassign<\/button>/)
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain(REFUSED)
  })

  it('live and refused, explain: a disabled button described by the visible reason', () => {
    const html = render(act('explain'), 'st-01')
    const button = /<button[^>]*>Reassign<\/button>/.exec(html)?.[0] ?? ''
    expect(button).toContain('disabled=""')
    const id = /aria-describedby="([^"]+)"/.exec(button)?.[1]
    expect(id).toBeTruthy()
    expect(html).toMatch(new RegExp(`id="${id}"[^>]*>(<[^>]+>)*${REFUSED.replace(/\./g, '\\.')}`))
  })

  it('live and refused, hide: nothing', () => {
    expect(render(act('hide'), 'st-01')).toBe('')
  })

  it('replaying: nothing, even when the viewer may act', () => {
    expect(render(act('explain'), 'st-05', true)).toBe('')
    expect(render(act('explain'), 'st-01', true)).toBe('')
  })
})

describe('OvMasked', () => {
  it('live: the masked form with a Reveal button', () => {
    const html = render(masked, 'st-03')
    expect(html).toContain(shown)
    expect(html).toContain('Reveal')
    expect(html).not.toContain('«')
  })

  it('replaying: the masked display string and no Reveal', () => {
    const html = render(masked, 'st-03', true)
    expect(html).toBe(`<span>SSN ${shown} on the W-2</span>`)
    expect(html).not.toContain('Reveal')
    expect(html).not.toContain('<button')
  })
})
