// Server-render smoke test of the Overview (spec §4.2-4.5, 4.8) on the MASKED model the browser uses, with an empty
// log at the packet's "now". No jsdom here, so no clicks: the numbers are pinned in overview-model.test.ts.
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
import { NextStepsSection } from '@/components/overview/next-steps'
import { type NextItem, type NextSteps, summarize } from '@/components/overview/overview-model'
import { OverviewScreen } from '@/components/overview/overview-screen'

// For the replay cursor (spec §5.4), which reads ?at= through useSearchParams once it lands; a live render has no ?at=.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/overview',
}))

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

/** Renders, and fails the test if the HTML carries a raw mask token. */
function render(w: Workspace): string {
  const html = renderToString(h(WorkspaceContext, { value: w }, h(OverviewScreen)))
  expect(html).not.toMatch(/«/)
  return html
}
const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
/** The inner HTML of the section headed by `id` (sections do not nest). */
const section = (html: string, id: string) => html.match(new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? ''

describe('overview screen', () => {
  it('renders for Priya with one h1 and the summary sentence', () => {
    const w = ws('st-01')
    const html = render(w)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(text(html)).toContain(summarize(model, w.state, w.viewer).sentence)
  })

  it('shows the required steps done out of 12, one mark each, and the claim words', () => {
    const html = section(render(ws('st-01')), 'ov-where')
    expect(html.match(/ title="\d+\. /g)).toHaveLength(12)
    const t = text(html)
    expect(t).toContain('0 of 12 required steps')
    expect(t).toContain('Has an open issue')
    expect(t).toContain('Not checked yet')
  })

  // Three, not five (spec §4.3): with five, "Money at stake" started below a 1440x900 first screen (spec §8).
  it('shows the first three blockers in step order with who acts, and See all 12', () => {
    const w = ws('st-01')
    const { items } = summarize(model, w.state, w.viewer).blockers
    const html = section(render(w), 'ov-blockers')
    expect(html.match(/<li/g)).toHaveLength(3)
    const t = text(html)
    const at = items.slice(0, 3).map((b) => t.indexOf(b.text))
    expect(Math.min(...at)).toBeGreaterThan(-1)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(t).not.toContain(items[3].text)
    expect(t).toContain(`Step 1: ${packet.firm.starter_standards.required_steps[0]}`)
    expect(t).toContain('Who acts: Priya Raman')
    expect(t).toContain('See all 12')
    expect(html).toContain('href="/filing#steps"')
    // Each title is a link that reads as one at rest (pen blue), not only on hover.
    const titles = html.match(/<a[^>]*>Step \d+:[^<]*<\/a>/g) ?? []
    expect(titles).toHaveLength(3)
    for (const a of titles) expect(a).toMatch(/class="[^"]*\btext-primary\b/)
  })

  it('gives Priya her top step with one act button, then her checklist', () => {
    const w = ws('st-01')
    const { next } = summarize(model, w.state, w.viewer)
    const html = section(render(w), 'ov-next')
    const t = text(html)
    expect(t).toContain('Done when:')
    expect(html).toMatch(/<button(?![^>]* disabled="")[^>]*>Start<\/button>/) // she may record her own adjustment
    expect(next.items.length).toBeGreaterThan(0)
    for (const item of next.items) expect(t).toContain(item.text)
  })

  it('names the top step\'s button by its subject: a group labelled by the "what" line', () => {
    const w = ws('st-01')
    const { next } = summarize(model, w.state, w.viewer)
    const html = section(render(w), 'ov-next')
    // The first group in the section is the top step (the Item rows follow it).
    const open = html.match(/<div[^>]*role="group"[^>]*>/)?.[0] ?? ''
    const labelledBy = open.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledBy).toBeTruthy()
    const label = html.match(new RegExp(`<p[^>]*id="${labelledBy}"[^>]*>([\\s\\S]*?)</p>`))?.[1] ?? ''
    expect(text(label).trim()).toContain(text(next.top!.what).trim().slice(0, 30))
    // The Start button sits inside that group, which ends where the Item list begins.
    expect(next.items.length).toBeGreaterThan(0)
    expect(html.slice(html.indexOf(open), html.indexOf('<ul'))).toMatch(/<button[^>]*>Start<\/button>/)
  })

  it('says how many next steps there are when the list is cut, with the queue link for her checklist', () => {
    const w = ws('st-01')
    const { next } = summarize(model, w.state, w.viewer)
    expect(next.total).toBeGreaterThan(next.items.length)
    const t = text(section(render(w), 'ov-next'))
    expect(t).toContain(`Showing ${next.items.length} of ${next.total}`)
    expect(t).toContain('See all in the queue')
  })

  it('shows a refused top action with its reason in words, tied to the disabled button', () => {
    const w: Workspace = { ...ws('st-01'), can: () => ({ ok: false as const, reason: 'Test refusal reason.' }) }
    const html = section(render(w), 'ov-next')
    const button = html.match(/<button[^>]*>Start<\/button>/)?.[0] ?? ''
    expect(button).toContain('disabled=""')
    const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${describedBy}"`)
    expect(text(html)).toContain('Test refusal reason.')
  })

  describe('the count under a cut list', () => {
    const view = (next: NextSteps) => text(renderToString(h(WorkspaceContext, { value: ws('st-03') }, h(NextStepsSection, { next }))))
    const row = (kind: 'checklist' | 'over_budget', i: number): NextItem => ({ kind, text: `Row ${i}`, context: 'return', href: '/firm#time' })
    const rows = (kind: 'checklist' | 'over_budget') => [1, 2, 3, 4, 5].map((i) => row(kind, i))

    it('says "Showing 5 of 7" for any role, and links the queue only when the rows are a checklist', () => {
      const other = view({ top: null, total: 7, items: rows('over_budget') })
      expect(other).toContain('Showing 5 of 7')
      expect(other).not.toContain('See all in the queue')
      const checklist = view({ top: null, total: 7, items: rows('checklist') })
      expect(checklist).toContain('Showing 5 of 7')
      expect(checklist).toContain('See all in the queue')
    })

    it('says nothing when five is all there is, however many of them are checklist items', () => {
      const t = view({ top: null, total: 5, items: rows('checklist') })
      expect(t).toContain('Row 5')
      expect(t).not.toContain('Showing')
      expect(t).not.toContain('See all')
    })
  })

  it('sends a client to the portal', () => {
    const t = text(section(render(ws('cu-01')), 'ov-next'))
    expect(t).toContain('Clients use the client portal')
    expect(t).not.toContain('Done when:')
  })

  // A row's opener unmounts once its act lands, so the always-rendered section is the focus return (act-host.tsx,
  // returnFocusTo). Not the <ul>: it goes with its last row.
  it('marks Your next steps as a focus return', () => {
    const open = render(ws('st-02')).match(/<section[^>]*aria-labelledby="ov-next"[^>]*>/)?.[0] ?? ''
    expect(open).toContain(' data-focus-return="true"')
    expect(open).toContain(' tabindex="-1"')
    expect(open).toContain('focus-visible:ring-2')
  })
})
