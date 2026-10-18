// The Compare page's what-if panel (compare-view.tsx, WhatIfPanel) on paper: "Adopt…" is screen-only, and a refused one
// prints its authorize() reason beside it (ActButton), so what hides it in print must hold the reason too. Server render of
// CompareView on the masked packet with next/navigation stubbed, as masked-render.test.ts does; no DOM, so the elements
// around the reason are read from the HTML's open tags.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { canOpen } from '@/components/acts/draft'
import { CompareView } from '@/components/records/compare-view'
import { WorkspaceContext } from '@/components/workspace/context'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { readPacket } from './fixture'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('a=v3&b=whatif:standard_deduction'),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/compare',
}))

const masked = maskPacket(readPacket()).masked
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

/** The page's HTML without React's `<!-- -->` text separators. */
const render = (w: Workspace) => renderToString(h(WorkspaceContext, { value: w }, h(CompareView))).replaceAll('<!-- -->', '')

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
/** The opening tags of the elements still open at `at`, outermost first. */
function openAt(html: string, at: number): string[] {
  const open: string[] = []
  for (const m of html.slice(0, at).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    if (m[1]) open.pop()
    else if (!m[3] && !VOID.has(m[2].toLowerCase())) open.push(m[0])
  }
  return open
}
const classesOf = (tag: string) => /\sclass="([^"]*)"/.exec(tag)?.[1].split(' ') ?? []

describe('compare: the what-if panel in print', () => {
  // The panel's own act, as WhatIfPanel's ActButton asks canOpen() for it.
  const adopt: OpenActRequest = { type: 'decide', target: 'whatif:standard_deduction', prefill: { kind: 'election', what_if: 'standard_deduction' } }

  it("hides a refused Adopt… and its reason together: the reason sits inside a print:hidden element", () => {
    // Sam Adeyemi (st-06) is not active until 2027-01-04, so the election is refused him.
    const sam = ws('st-06')
    const { auth } = canOpen(adopt, sam)
    if (auth.ok) throw new Error('Sam Adeyemi is not active yet, so Adopt… is refused him')
    expect(auth.reason).toBe('Sam Adeyemi is active from 2027-01-04.')
    const html = render(sam)
    const button = /<button\b[^>]*>Adopt…<\/button>/.exec(html)?.[0] ?? ''
    expect(button).toContain(' aria-disabled="true"')
    expect(classesOf(button)).toContain('print:hidden') // the button keeps its own
    const at = html.indexOf(`>${auth.reason}<`)
    expect(at).toBeGreaterThan(-1)
    const around = openAt(html, at + 1)
    expect(around.some((t) => / data-refusal="true"/.test(t)), 'the reason is the refusal line').toBe(true)
    expect(around.filter((t) => classesOf(t).includes('print:hidden')), around.join('\n')).toHaveLength(1)
  })
})
