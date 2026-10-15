// Season replay (spec §5.4): the URL cursor, and the Overview server-rendered at a replay point. While replaying the
// banner shows and nothing can act or reveal: a past state is never acted on, and a reveal is an act.
import { createElement as h, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type * as ActHost from '@/components/acts/act-host'
import { actsOf, readPacket } from '@/components/records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { Act } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { OverviewScreen } from './overview-screen'
import { parseReplayCursor } from './replay-bar'

const nav = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
}))
// ActButton is the one door to an act form: mark it, so a render can be searched for act controls.
vi.mock('@/components/acts/act-host', async (importOriginal) => {
  const { createElement } = await import('react')
  return {
    ...(await importOriginal<typeof ActHost>()),
    ActButton: ({ type, children }: { type: string; children?: ReactNode }) => createElement('button', { type: 'button', 'data-act': type }, children),
  }
})

const { masked, maskText, secrets } = maskPacket(readPacket())
const model = buildModel(masked)
const people = identities(masked)
const name = (id: string) => people.find((v) => v.id === id)!.name

// A blocking review note on Priya's work that carries a masked SSN: live, it is her top next step, with a Reply
// control and a Reveal. A second change lets the cursor sit inside the log.
const log = actsOf(model, [
  ['st-02', { type: 'note', target: 'F1040.1a', body: { kind: 'review_note', text: maskText('Tie the wages to the W-2 for 666-74-3309 before sign-off', secrets), blocking: true } }],
  ['st-01', { type: 'time', target: 'area:wages_and_stock_compensation', body: { hours: 0.5 } }],
])

function ws(viewerId: string, acts: Act[]): Workspace {
  const viewer = viewerOf(masked, viewerId)
  const state = project(model, acts, viewer, 'main')
  return {
    model, state, viewer, identities: people, engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const SSN = /\b\d{3}-\d{2}-\d{4}\b/
function render(query: string, viewerId = 'st-01', acts: Act[] = log): string {
  nav.query = query
  const html = renderToString(h(WorkspaceContext, { value: ws(viewerId, acts) }, h(OverviewScreen)))
  expect(html).not.toMatch(/«/)
  expect(html).not.toMatch(SSN)
  return html
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const q = (s: string) => new URLSearchParams(s)

describe('parseReplayCursor', () => {
  it('names a change of this log by its seq; index counts the acts replayed', () => {
    expect(parseReplayCursor(q('at=1&eng=main'), log, 'main')).toEqual({ index: 1, seq: 1 })
    expect(parseReplayCursor(q('at=2&eng=main'), log, 'main')).toEqual({ index: 2, seq: 2 })
    const gapped = log.map((a, i) => ({ ...a, seq: 40 + i * 7 }))
    expect(parseReplayCursor(q('at=47&eng=main'), gapped, 'main')).toEqual({ index: 2, seq: 47 })
  })

  it('takes 0 as before the first change, also on an empty log', () => {
    expect(parseReplayCursor(q('at=0&eng=main'), log, 'main')).toEqual({ index: 0, seq: 0 })
    expect(parseReplayCursor(q('at=0&eng=main'), [], 'main')).toEqual({ index: 0, seq: 0 })
  })

  it('ignores a point from another engagement, or with no engagement named', () => {
    expect(parseReplayCursor(q('at=1&eng=copy-1a2b3c4d'), log, 'main')).toBeNull()
    expect(parseReplayCursor(q('at=1'), log, 'main')).toBeNull()
  })

  it('ignores a seq that is not in the log', () => {
    expect(parseReplayCursor(q('at=3&eng=main'), log, 'main')).toBeNull()
    expect(parseReplayCursor(q('at=40&eng=main'), log.map((a, i) => ({ ...a, seq: 41 + i })), 'main')).toBeNull()
  })

  it('ignores garbage, and no point at all', () => {
    for (const at of ['', 'abc', '-1', '1.5', '1e2', '0x1', ' 1', '+1', '1234567890123456']) {
      expect(parseReplayCursor(q(`at=${encodeURIComponent(at)}&eng=main`), log, 'main')).toBeNull()
    }
    expect(parseReplayCursor(q('eng=main'), log, 'main')).toBeNull()
    expect(parseReplayCursor(q(''), log, 'main')).toBeNull()
  })
})

describe('Overview season replay (render)', () => {
  it('live: the top next step can act and reveal, Recent activity shows, no banner', () => {
    const html = render('')
    expect(html).toContain('data-act="reply"')
    expect(text(html)).toContain('Reveal')
    expect(text(html)).toContain('Recent activity')
    expect(text(html)).not.toContain('Actions are off')
  })

  it('replay: the banner shows, and no act control, Reveal or Recent activity renders', () => {
    const html = render('at=1&eng=main')
    const t = text(html)
    const did = `${name('st-02')} note added`
    expect(html).toMatch(/role="status"[^>]*>Replaying the dashboard as of change 1 of 2/)
    expect(t).toContain(`Replaying the dashboard as of change 1 of 2 (${did}, 2026-06-23 06:05). Actions are off.`)
    expect(html).toContain(`aria-valuetext="Change 1 of 2: ${did} F1040.1a, 2026-06-23 06:05"`)
    expect(html).not.toContain('data-act')
    expect(t).not.toContain('Reveal')
    expect(t).toContain('•••-••-3309') // the note still reads, masked, with no way to reveal it
    expect(t).not.toContain('Recent activity')
  })

  it('replay at 0: before the first change', () => {
    const t = text(render('at=0&eng=main'))
    expect(t).toContain('Replaying: before the first change. Actions are off.')
    expect(t).toContain('Before the first change')
  })

  it('a point from another engagement renders live', () => {
    const html = render('at=1&eng=copy-1a2b3c4d')
    expect(text(html)).not.toContain('Actions are off')
    expect(html).toContain('data-act="reply"')
  })

  it('at a filing whose agency response comes later, the banner says so', () => {
    const filed = actsOf(model, [
      ['st-03', { type: 'request_approval', target: 'return', body: {} }],
      ['cu-01', { type: 'client_approve', target: 'act:1', body: { pin: '12345' } }],
      ['cu-02', { type: 'client_approve', target: 'act:1', body: { pin: '12345' } }],
      ['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal'] } }],
    ])
    const agency: Act = {
      ...filed[3], seq: 5, id: 't-5', actor: 'system', actor_role: 'system', type: 'agency_result', target: 'act:4', refs: ['act:4'],
      body: { jurisdiction: 'federal', status: 'accepted', errors: [], rule: 'disclosed test rule' },
      derived: { retain_until: '2033-07-14T16:22:00Z' }, hash: 'h5', prev_hash: 'h4',
    }
    const acts = [...filed, agency]
    expect(text(render('at=4&eng=main', 'st-03', acts))).toContain(
      `(${name('st-03')} filed, 2026-06-23 06:05). Actions are off. The agency's response to this filing comes in the next change.`,
    )
    expect(text(render('at=5&eng=main', 'st-03', acts))).not.toContain("The agency's response")
  })
})
