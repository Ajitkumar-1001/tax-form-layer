// The rail's width and the top bar's title follow <html data-rail> through the rail-wide variant (globals.css), so the
// server render carries no choice and nothing to mismatch: the rail is 64 px, 240 px when rail-wide; the top bar's title
// hides when rail-wide, and the rail's copy shows at its labelled width. The toggles render in the browser only.
import { createElement as h, type ReactElement } from 'react'
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
import { AppShell } from '@/components/shell/app-shell'
import { Rail } from '@/components/shell/rail'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => '/documents',
}))

const { masked } = maskPacket(readPacket())
const model = buildModel(masked)
const viewer = viewerOf(masked, 'st-01')
const state = project(model, [], viewer)
const ws: Workspace = {
  model, state, viewer, identities: identities(masked), engagement: 'main', packetSha: 'sha-test',
  post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
  reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
}
const render = (el: ReactElement) => renderToString(h(WorkspaceContext, { value: ws }, el))
const name = masked.packet.name

describe('Rail', () => {
  it('is the element the toggles control, 64 px wide and 240 px when rail-wide', () => {
    expect(render(h(Rail))).toMatch(/<aside id="rail" class="[^"]*\bw-16\b[^"]*\brail-wide:w-60\b/)
  })

  it('has no viewport breakpoint at xl inside it (it follows its own width)', () => {
    expect(render(h(Rail))).not.toMatch(/[\s"](max-)?xl:/)
  })
})

describe('AppShell', () => {
  const html = render(h(AppShell, null, 'page'))

  it('hides the top bar title exactly when the rail is labelled, so the name shows once', () => {
    // The title block: a div whose first child is the home link carrying the return's name.
    expect(html).toMatch(new RegExp(`<div class="[^"]*\\brail-wide:hidden\\b[^"]*"><a [^>]*href="/about"[^>]*><span[^>]*>${name}</span>`))
    // The rail's copy, shown only at the rail's labelled width (its own width, or rail-wide).
    expect(html).toMatch(new RegExp(`<p class="hidden [^"]*(@min-\\[12rem\\]|rail-wide):block"[^>]*>${name}</p>`))
    expect(html).not.toMatch(/[\s"]xl:hidden/)
  })

  it('has no toggle in the server render', () => {
    expect(html).not.toContain('aria-controls="rail"')
  })

  it("lands the skip link's target below the sticky header", () => {
    const classes = /<main id="main"[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? []
    expect(classes).toContain('scroll-mt-44')
    expect(classes).toContain('lg:scroll-mt-20')
  })
})
