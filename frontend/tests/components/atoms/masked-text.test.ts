// MaskedText holds a reveal (or a refusal) in component state, which is the viewer's authority, not the page's: it must
// not outlive an identity switch, and its Reveal button must stay a focusable, named control. Server-rendered with
// renderToString, so what a click or a screen reader does after is left to the browser check.
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readPacket } from '../records/fixture'
import { MaskedText } from '@/components/atoms/masked-text'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { makeToken } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

const { masked } = maskPacket(readPacket())
const model = buildModel(masked)

function ws(viewerId: string): Workspace {
  const viewer = viewerOf(masked, viewerId)
  const state = project(model, [], viewer)
  return {
    model, state, viewer, identities: identities(masked), engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const render = (el: ReactElement, viewerId = 'st-01') => renderToString(h(WorkspaceContext, { value: ws(viewerId) }, el))

describe('MaskedText', () => {
  it('keys each masked token on the viewer, so an identity switch remounts it', () => {
    const text = `Theo ${makeToken('ssn', '3309', 'abc')} per D06`
    function keysFor(viewerId: string): string[] {
      const keys: string[] = []
      // MaskedText reads the workspace with use(), so it is called inside a component rendered under the context.
      function Probe() {
        const span = MaskedText({ text, context: 'household:theo#ssn' }) as ReactElement<{ children: ReactNode[] }>
        for (const child of span.props.children) if (isValidElement(child)) keys.push(String(child.key))
        return null
      }
      render(h(Probe), viewerId)
      return keys
    }
    const [a0, a1, a2] = keysFor('st-01')
    const [b0, b1, b2] = keysFor('st-04')
    expect([a0, a2, b0, b2]).toEqual(['0', '2', '0', '2'])
    expect(a1).not.toBe(b1)
    expect(a1).toContain('st-01')
    expect(b1).toContain('st-04')
  })

  it('keeps Reveal focusable when it cannot act and gives results a live region', () => {
    const token = makeToken('ssn', '3309', 'abc')
    // No provider: Reveal cannot act, but stays in the tab order and says so (a natively disabled button drops focus).
    const bare = renderToString(h(MaskedText, { text: token, context: 'x' }))
    expect(bare).toContain('aria-disabled="true"')
    expect(bare).not.toContain(' disabled=""')
    // Inside a workspace it can act: not disabled, the revealed value and the refusal are announced.
    const html = render(h(MaskedText, { text: token, context: 'x' }))
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).not.toContain(' disabled=""')
  })

  it('names each Reveal by the kind and last four of its value', () => {
    const text = `${makeToken('ssn', '3309', 'a')} vs ${makeToken('ssn', '3390', 'b')}`
    const html = render(h(MaskedText, { text, context: 'x' }))
    expect(html).toContain('aria-label="Reveal ssn ending 3309"')
    expect(html).toContain('aria-label="Reveal ssn ending 3390"')
    // No last four: the name is the kind alone, with its underscore read as a space.
    expect(render(h(MaskedText, { text: makeToken('ip_pin', '', 'c'), context: 'x' }))).toContain('aria-label="Reveal ip pin"')
  })
})
