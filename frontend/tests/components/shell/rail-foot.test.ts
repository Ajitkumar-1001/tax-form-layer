// Server render of the rail against the masked packet at the packet's "now": its foot shows the claims in the file
// (812, not the 818 that include claims the season clock has not reached) in the spectrum's plain words, and its gate
// link's title masks a blocking note that quotes an SSN.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { Act } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { displayMasked, parseToken } from '@/lib/model/mask-token'
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

function ws(acts: Act[] = []): Workspace {
  const viewer = viewerOf(packet, 'st-01')
  const state = project(model, acts, viewer)
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

  it('masks the gate link title, so a blocking note that quotes an SSN shows only its last four digits', () => {
    const token = packet.household.people.find((p) => p.id === 'theo')!.ssn
    const digits = displayMasked(parseToken(token)!)
    expect(digits).toBe('•••-••-3309')
    const note = `The dependent SSN on the return does not match the card in D05; confirm ${token} with the client.`
    const acts = actsOf(model, [
      ['st-02', { type: 'note', target: 'F8949.B.N1', body: { kind: 'review_note', text: note, blocking: true } }],
      ['st-02', { type: 'note', target: 'return', body: { kind: 'review_note', to: 'st-04', text: 'Tie the extension payment to the IRS transcript.', blocking: true } }],
    ])
    const withNotes = renderToString(h(WorkspaceContext, { value: ws(acts) }, h(Rail)))
    expect(text(withNotes)).toContain('Filing blocked: 14 reasons')
    const title = [...withNotes.matchAll(/title="([^"]*)"/g)].map((m) => m[1]).find((t) => t.includes('Blocking review note by Daniel Ortiz'))
    expect(title).toBeDefined()
    expect(title).toContain(`confirm ${digits}…`)
    expect(title).not.toContain('«')
    expect(withNotes).not.toContain('«')
  })
})
