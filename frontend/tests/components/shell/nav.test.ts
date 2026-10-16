// The overview is the home and the queue lives at /queue (overview spec §3.1): the order of the tabs, which tab is
// current where (rail and phone row), the redirects that keep the queue's old links working, and the phone gate bar,
// which steps aside on / because the overview's blockers section says the same.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readPacket } from '../records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { displayMasked, makeToken } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import nextConfig from '../../../next.config'
import { AppShell } from '@/components/shell/app-shell'
import { isCurrent, NAV } from '@/components/shell/nav'

const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
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

/** The shell at `pathname`, server-rendered with a loaded workspace (no boundary waits). */
function shellAt(pathname: string, w: Workspace = ws): string {
  nav.pathname = pathname
  return renderToString(h(WorkspaceContext, { value: w }, h(AppShell, null, h('p', null, 'the page'))))
}

/** The text of every link marked current, in document order: the rail's first, then the phone row's. */
const currentTabs = (html: string) =>
  [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim())

const GATE_BAR = 'title="Packet sha-256 · chain head · engagement"'

describe('NAV', () => {
  it('leads with the overview, then the queue', () => {
    expect(NAV.map((n) => [n.href, n.label])).toEqual([
      ['/overview', 'Overview'],
      ['/queue', 'Queue'],
      ['/documents', 'Documents'],
      ['/records', 'Records'],
      ['/compare', 'Compare'],
      ['/filing', 'Filing'],
      ['/firm', 'Firm'],
      ['/notice', 'Notice'],
      ['/client', 'Client view'],
      ['/errors', 'Errors'],
      ['/about', 'About'],
    ])
  })
})

describe('isCurrent', () => {
  it('makes /overview current on the overview alone', () => {
    expect(isCurrent('/overview', '/overview')).toBe(true)
    expect(isCurrent('/overview', '/queue')).toBe(false)
    expect(isCurrent('/overview', '/filing')).toBe(false)
  })

  it('makes /queue current on /queue and nowhere else', () => {
    expect(isCurrent('/queue', '/queue')).toBe(true)
    expect(isCurrent('/queue', '/overview')).toBe(false)
    expect(isCurrent('/queue', '/queued')).toBe(false)
  })
})

describe('redirects', () => {
  it("sends the queue's old links on / to /queue, one rule per query key (every has item must match), then / to /about", async () => {
    expect(await nextConfig.redirects?.()).toEqual([
      ...['c', 'area', 'mine', 'q'].map((key) => ({ source: '/', has: [{ type: 'query', key }], destination: '/queue', permanent: false })),
      { source: '/', destination: '/about', permanent: false },
    ])
  })
})

describe('AppShell on /overview and /queue', () => {
  it('marks the overview current in the rail and the phone row on /overview', () => {
    expect(currentTabs(shellAt('/overview'))).toEqual(['Overview', 'Overview'])
  })

  it('marks the queue current on /queue', () => {
    expect(currentTabs(shellAt('/queue'))).toEqual(['Queue', 'Queue'])
  })

  it('masks a token in each form of a phone gate bar reason: plain, linked to a page, linked to a ref', () => {
    const token = makeToken('ssn', '3309', 'synthetic0')
    const shown = displayMasked({ kind: 'ssn', last4: '3309' })
    const reasons = [{ text: `Plain ${token}` }, { text: `Page ${token}`, ref: '/filing' }, { text: `Ref ${token}`, ref: 'act:1' }]
    const html = shellAt('/queue', { ...ws, state: { ...state, gates: { ...state.gates, submit: { ok: false, reasons } } } })
    const at = html.indexOf(GATE_BAR)
    expect(at).toBeGreaterThan(-1)
    const bar = html.slice(html.lastIndexOf('<footer', at), html.indexOf('</footer>', at))
    expect(bar).not.toContain('«')
    expect(bar).toContain(`Plain ${shown}`)
    expect(bar).toMatch(new RegExp(`<a [^>]*href="/filing"[^>]*>Page ${shown}</a>`))
    expect(bar).toMatch(new RegExp(`<a [^>]*href="/r/act%3A1"[^>]*>Ref ${shown}</a>`))
  })

  it('drops the phone gate bar on /overview only', () => {
    expect(shellAt('/overview')).not.toContain(GATE_BAR)
    expect(shellAt('/queue')).toContain(GATE_BAR)
  })
})
