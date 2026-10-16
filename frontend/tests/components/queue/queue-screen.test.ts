// The queue keeps exactly one h1 now that the Overview owns / (spec 2026-10-15 §8: one h1 on / and /queue), with or without
// a selected claim: the compact claim pane's title steps down to h2, while the full trace page keeps it as its h1.
// Server-rendered against the masked packet with an empty log, as masked-render.test.ts does; the navigation hooks are mocked.
// Also the worklist of the queue spec (2026-10-15 §2-3): toolbar, explanations, and the pure helpers behind the bulk bar.
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { ClaimPane } from '@/components/trace/claim-pane'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { AREAS } from '@/lib/model/ids'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { type Filters, GROUPS, buildQueue } from '@/components/queue/queue-model'
import { AREA_OPTIONS, HIDE_EXPLAIN_KEY, QueueScreen, clipPlain, pickState, splitTied, visiblePicked } from '@/components/queue/queue-screen'

const nav = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/queue',
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

const render = (el: ReactElement, query = '') => {
  nav.query = query
  return renderToString(h(WorkspaceContext, { value: ws }, el))
}
const h1s = (html: string) => html.match(/<h1[\s>][\s\S]*?<\/h1>/g)
const QUEUE_H1 = ['<h1 class="sr-only">Queue</h1>']
const ALL: Filters = { area: null, mine: false, q: '' }
// The screen reads the preference in a lazy useState initialiser, which runs under renderToString.
const storage = (hidden: boolean) => ({ getItem: (k: string) => (hidden && k === HIDE_EXPLAIN_KEY ? '1' : null), setItem: () => {}, removeItem: () => {} })
const FIRST_LINE = 'Click a row to open it beside the list. Press ? for shortcuts.'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('queue screen', () => {
  it('has exactly one h1, visually hidden, when nothing is selected', () => {
    expect(h1s(render(h(QueueScreen)))).toEqual(QUEUE_H1)
  })

  // A claim, an area, an act missing from the log (ActView's nested NotFound) and an unknown ref: every view's title.
  it.each([
    ['F8949.B.N1', model.claims['F8949.B.N1'].label],
    ['area:intake_and_engagement', 'Intake &amp; identity'],
    ['act:12', 'Nothing here'],
    ['no-such-ref', 'Nothing here'],
  ])('keeps its one h1 with ?c=%s selected: the pane title is an h2', (ref, title) => {
    const html = render(h(QueueScreen), `c=${encodeURIComponent(ref)}`)
    expect(h1s(html)).toEqual(QUEUE_H1)
    // Proof the pane rendered, so the h1 count is not vacuous.
    expect(html).toContain('aria-label="Close the claim pane"')
    expect(html).toMatch(new RegExp(`<h2 class="text-lg[^"]*">${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>`))
  })

  it('has no Next card, area tiles, key-hint row, Learn switch or area chip, with or without an area filter', () => {
    for (const query of ['', 'area=business&mine=0']) {
      const html = render(h(QueueScreen), query)
      for (const gone of ['aria-label="Next"', 'aria-label="Areas"', 'aria-label="Keyboard shortcuts"', 'Learn mode', 'Clear the area filter', 'Last looked at act']) {
        expect(html, `${query} · ${gone}`).not.toContain(gone)
      }
      expect(html).toContain('New since you last marked the log seen.')
    }
  })

  it('filters by area with a Select that reads All areas, or the chosen area', () => {
    expect(render(h(QueueScreen))).toMatch(/data-slot="select-value"[^>]*>All areas</)
    expect(render(h(QueueScreen), 'area=business&mine=0')).toMatch(/data-slot="select-value"[^>]*>Business \(Sch C\)</)
  })

  it('counts with a unit and offers Accept N on each tied block, with the refusal as text beside it', () => {
    const html = render(h(QueueScreen))
    expect(html).toContain('14 items') // blocks
    expect(html).toContain('350 claims') // tied
    expect(html).toContain('>Accept 13</button>') // business: 13 tied claims
    expect(html).toContain('>Accepting a tied check is a reviewer or partner act.</span>') // st-01 is a preparer
    expect(html).not.toContain('Accept all')
    // Every header keeps the select-all gutter, the tied group's too (selectAll null: no box), so the seven labels line up.
    const summaries = html.match(/<summary class="[^"]*"/g) ?? []
    expect(summaries).toHaveLength(7)
    for (const s of summaries) expect(s).toContain('pl-9')
    expect(html).not.toContain('aria-label="Select all in Tied by checks"')
  })

  it('shows the explanations by default: the first line, each open group\'s sentence, the tied block\'s, and Hide explanations', () => {
    vi.stubGlobal('localStorage', storage(false))
    const html = render(h(QueueScreen))
    expect(html).toContain(FIRST_LINE)
    expect(html).toContain(GROUPS.find((g) => g.key === 'blocks')!.learn)
    expect(html).toContain('A check has already tied these out against their sources; accept them in bulk once you agree.')
    expect(html).toContain('>Hide explanations</button>')
    expect(html).not.toContain('Show explanations')
  })

  it('hides every explanation when wp:hide-explain is 1, leaving the one Show explanations button', () => {
    expect(HIDE_EXPLAIN_KEY).toBe('wp:hide-explain')
    vi.stubGlobal('localStorage', storage(true))
    const html = render(h(QueueScreen))
    expect(html).not.toContain(FIRST_LINE)
    for (const g of GROUPS) expect(html, g.key).not.toContain(g.learn)
    expect(html).toContain('>Show explanations</button>')
    expect(html).not.toContain('Hide explanations')
  })
})

describe('full trace page', () => {
  it('keeps the claim title as its one h1', () => {
    const html = render(h(ClaimPane, { claimRef: 'F8949.B.N1' }))
    expect(h1s(html)).toEqual([`<h1 class="text-lg leading-snug font-semibold text-balance">${model.claims['F8949.B.N1'].label}</h1>`])
  })
})

describe('AREA_OPTIONS', () => {
  it('lists All areas, then the nine areas in order', () => {
    expect(AREA_OPTIONS[0]).toEqual({ value: '', label: 'All areas' })
    expect(AREA_OPTIONS.slice(1).map((o) => o.value)).toEqual([...AREAS])
    expect(AREA_OPTIONS.map((o) => o.label)).toEqual([
      'All areas', 'Intake & identity', 'Wages & stock comp', 'Investments & crypto', 'Business (Sch C)', 'Rentals & sale',
      'K-1s & basis', 'Deductions & credits', 'California split', 'Payments & filing',
    ])
  })
})

describe('visiblePicked', () => {
  const reach = (closed: string[], filters: Filters = ALL) =>
    buildQueue(model, state, 0, filters).groups.filter((g) => !closed.includes(g.key)).flatMap((g) => g.rows)
  const picked = ['blocks:step:1', 'contradicted:F8949.B.N1', 'weak:no-such-row']

  it('keeps the picks j/k can reach, in pick order', () => {
    expect(visiblePicked(picked, reach([]))).toEqual(['blocks:step:1', 'contradicted:F8949.B.N1'])
    expect(visiblePicked(['b', 'a'], [{ key: 'a' }, { key: 'b' }])).toEqual(['b', 'a'])
  })

  it('ignores picks in a collapsed group and rows a filter hides, and never prunes the picks themselves', () => {
    expect(visiblePicked(picked, reach(['blocks']))).toEqual(['contradicted:F8949.B.N1'])
    // step:1 is intake_and_engagement and the RSU lot investments_and_digital_assets: neither is business.
    expect(visiblePicked(picked, reach([], { ...ALL, area: 'business' }))).toEqual([])
    expect(picked).toEqual(['blocks:step:1', 'contradicted:F8949.B.N1', 'weak:no-such-row'])
  })
})

describe('pickState', () => {
  it('is none, some or all of a group\'s row keys', () => {
    expect(pickState([], ['a', 'b'])).toBe('none')
    expect(pickState(['b', 'x'], ['a', 'b'])).toBe('some')
    expect(pickState(['b', 'a'], ['a', 'b'])).toBe('all')
    expect(pickState(['a'], [])).toBe('none')
  })
})

describe('bulk accept guard (splitTied)', () => {
  it('accepts only claims a check tied out; a row without a claim and an open claim are skipped', () => {
    const acts = actsOf(model, [
      ['st-02', { type: 'note', target: 'SchC.8', body: { kind: 'memo', text: 'Looked at the advertising receipts', blocking: false } }],
      ['st-02', { type: 'note', target: 'return', body: { kind: 'memo', text: 'Return-level memo', blocking: false } }],
    ])
    const s = project(model, acts, viewer)
    const rows = buildQueue(model, s, 0, ALL).groups.flatMap((g) => g.rows)
    const pick = ['new:act:1', 'new:act:2', 'contradicted:F8949.B.N1'].map((k) => rows.find((r) => r.key === k)!)
    expect(pick.map((r) => r.claim)).toEqual(['SchC.8', undefined, 'F8949.B.N1'])
    const { claims, skipped } = splitTied(pick, s.claims)
    expect(claims).toEqual(['SchC.8'])
    expect(skipped.map((r) => r.key)).toEqual(['new:act:2', 'contradicted:F8949.B.N1'])
  })

  it('accepts a claim once when two picked rows share it', () => {
    expect(splitTied([{ claim: 'SchC.8' }, { claim: 'SchC.8' }], state.claims)).toEqual({ claims: ['SchC.8'], skipped: [] })
  })

  it('skips every row of a select-all at the empty log: nothing in groups 1-6 is tied', () => {
    const rows = buildQueue(model, state, 0, ALL).groups.find((g) => g.key === 'contradicted')!.rows
    const { claims, skipped } = splitTied(rows, state.claims)
    expect(claims).toEqual([])
    expect(skipped).toHaveLength(29)
  })
})

describe('clipPlain', () => {
  // Read at runtime: the token's eq tag depends on MASK_SECRET, so only its display form is pinned.
  const theo = masked.household.people.find((p) => p.id === 'theo')!.ssn

  it('masks before it clips, so a toast never shows a token or half of one', () => {
    expect(`Theo ${theo} has two SSNs on file in D06`.slice(0, 40)).toContain('«') // what the old raw slice showed
    expect(clipPlain(`Theo ${theo} has two SSNs on file in D06 and the 2024 return`)).toBe('Theo •••-••-3309 has two SSNs on file in…')
    expect(clipPlain(`Check Theo ${theo}`)).toBe('Check Theo •••-••-3309')
  })
})
