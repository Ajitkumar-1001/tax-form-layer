// Server render of the rail against the masked packet at the packet's "now": its foot shows the claims in the file
// (812, not the 818 that include claims the season clock has not reached) in the spectrum's plain words.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readPacket } from '../records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { Rail } from '@/components/shell/rail'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/overview',
}))

const packet = maskPacket(readPacket()).masked
const model = buildModel(packet)

function ws(): Workspace {
  const viewer = viewerOf(packet, 'st-01')
  const state = project(model, [], viewer)
  return {
    model, state, viewer, identities: identities(packet), engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('the rail foot', () => {
  const html = renderToString(h(WorkspaceContext, { value: ws() }, h(Rail)))

  it('counts the 812 claims in the file', () => {
    expect(text(html)).toContain('182 open · 0 of 812 reviewed')
  })

  it('labels the claim bar in plain words and draws only the parts that have claims', () => {
    expect(html).toContain('aria-label="Claims: Checked by staff 0, Corrected 0, Matches the page (automatic) 350, Not checked yet 280, Has an open issue 182"')
    expect(html.match(/min-w-px basis-0/g)).toHaveLength(3)
  })
})
