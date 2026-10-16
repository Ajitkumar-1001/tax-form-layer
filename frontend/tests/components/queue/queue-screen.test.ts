// The queue keeps exactly one h1 now that the Overview owns / (spec 2026-10-15 §8: one h1 on / and /queue), with or without
// a selected claim: the claim drawer portals out of this render, and its body's title is an h2 (claim-drawer.test.ts), while
// the full trace page keeps it as its h1.
// Server-rendered against the masked packet with an empty log, as masked-render.test.ts does; the navigation hooks are mocked.
// Also the worklist of the queue spec (2026-10-15 §2-3): toolbar, explanations, and the pure helpers behind the bulk bar.
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { ClaimPane } from '@/components/trace/claim-pane'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { Act, ActInput } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { AREAS } from '@/lib/model/ids'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { type Filters, GROUPS, buildQueue } from '@/components/queue/queue-model'
import {
  AREA_OPTIONS, HIDE_EXPLAIN_KEY, QueueScreen, acceptRefusal, clipPlain, cursorFrom, cursorIndex, pickState, postText, splitTied, stepCursor,
  visiblePicked,
} from '@/components/queue/queue-screen'

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

const render = (el: ReactElement, query = '', value: Workspace = ws) => {
  nav.query = query
  return renderToString(h(WorkspaceContext, { value }, el))
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  it.each(['F8949.B.N1', 'area:intake_and_engagement', 'act:12', 'no-such-ref'])('keeps its one h1 with ?c=%s selected', (ref) => {
    const html = render(h(QueueScreen), `c=${encodeURIComponent(ref)}`)
    expect(h1s(html)).toEqual(QUEUE_H1)
    // The screen read ?c: from xl the list makes room for the drawer, and the old side pane is gone.
    expect(html).toContain('xl:pr-[min(36rem,45vw)]')
    expect(html).not.toContain('aria-label="Selected claim"')
  })

  it('makes no room for the drawer when nothing is selected', () => {
    expect(render(h(QueueScreen))).not.toContain('xl:pr-[')
  })

  // From lg to xl the drawer overlays the list's right side: the rows stay reachable by scrolling and j / k, but the
  // controls at the right end of the toolbar, the explanations row and each tied block would sit under it, so they make
  // room from lg. Only up to xl: from xl the section's own padding makes room for everything (no double padding).
  it('moves the toolbar, the explanations row and each tied block out from under the open drawer from lg to xl', () => {
    const ROOM = 'lg:max-xl:pr-[min(36rem,45vw)]'
    const html = render(h(QueueScreen), 'c=F8949.B.N1')
    const tied = buildQueue(model, state, 0, ALL).tied.length
    expect(tied).toBeGreaterThan(0)
    // The toolbar row, the explanations row and every tied <li>; the bulk bar is not rendered without picks.
    expect(html.split(ROOM).length - 1).toBe(2 + tied)
    expect(html).toMatch(new RegExp(`<div class="[^"]*${esc(ROOM)}[^"]*"><div class="relative min-w-48 flex-1">`))
    expect(html.match(/<li class="[^"]*"/g)!.filter((li) => li.includes(ROOM))).toHaveLength(tied)
    // The list rows keep their full width below xl.
    for (const row of html.match(/<button type="button" data-row="[^"]*"/g)!.slice(0, 3)) expect(row).not.toContain('pr-[')
    expect(render(h(QueueScreen))).not.toContain(ROOM)
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

  // After filing is accepted the return is frozen, so authorize() refuses every verify even for a reviewer: the tied
  // Accept N is disabled with that reason as text, not left enabled to end in a "Nothing accepted" toast (spec §3).
  it('disables a tied Accept N with authorize()\'s reason when the role is right but the act is refused (frozen)', () => {
    const [filed] = actsOf(model, [['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal', 'california'] } }]])
    const result = (seq: number, jurisdiction: 'federal' | 'california'): Act => ({
      ...filed, seq, id: `t-${seq}`, actor: 'system', actor_role: 'system', type: 'agency_result', target: 'act:1', refs: ['act:1'],
      body: { jurisdiction, status: 'accepted', errors: [], rule: 'test' }, derived: {}, hash: `h${seq}`, prev_hash: `h${seq - 1}`,
    })
    const reviewer = viewerOf(masked, 'st-02')
    const frozen = project(model, [filed, result(2, 'federal'), result(3, 'california')], reviewer)
    expect(frozen.frozen).toEqual({ federal: true, california: true })
    const html = render(h(QueueScreen), '', { ...ws, state: frozen, viewer: reviewer, can: (i) => authorize(model, frozen, i, reviewer) })
    const accept = html.match(/<button[^>]*>Accept 13<\/button>/)?.[0] ?? ''
    expect(accept).toMatch(/\sdisabled=""/)
    expect(html).toMatch(/>Return filed [0-9-]+ \((federal|California)\); open an amendment\.<\/span>/)
    expect(html).not.toContain('Accepting a tied check is a reviewer or partner act.')
  })

  it('leaves a tied Accept N enabled for a reviewer at the empty log', () => {
    const reviewer = viewerOf(masked, 'st-02')
    const s = project(model, [], reviewer)
    const html = render(h(QueueScreen), '', { ...ws, state: s, viewer: reviewer, can: (i) => authorize(model, s, i, reviewer) })
    expect(html.match(/<button[^>]*>Accept 13<\/button>/)?.[0]).not.toMatch(/\sdisabled=""/)
    expect(html).not.toContain('open an amendment.')
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

describe('queue cursor (spec §5)', () => {
  // The same ref in two groups, as a claim can be (Row.key is unique, Row.ref is not).
  const rows = [
    { key: 'blocks:a', ref: 'X' },
    { key: 'contradicted:b', ref: 'Y' },
    { key: 'new:c', ref: 'X' },
  ]

  it('resolves to its row, or to the row now at its index once its row leaves the list', () => {
    expect(cursorIndex(rows, null)).toBe(-1)
    expect(cursorIndex([], { key: 'blocks:a', index: 0 })).toBe(-1)
    expect(cursorIndex(rows, { key: 'new:c', index: 0 })).toBe(2)
    expect(cursorIndex(rows, { key: 'gone', index: 1 })).toBe(1)
    expect(cursorIndex(rows, { key: 'gone', index: 7 })).toBe(2)
  })

  it('follows ?c to the first row showing it, stays on a row that already shows it, and stays when no row does', () => {
    expect(cursorFrom(rows, 'X', null)).toEqual({ key: 'blocks:a', index: 0 })
    expect(cursorFrom(rows, 'X', { key: 'new:c', index: 2 })).toEqual({ key: 'new:c', index: 2 })
    expect(cursorFrom(rows, 'Y', { key: 'new:c', index: 2 })).toEqual({ key: 'contradicted:b', index: 1 })
    expect(cursorFrom(rows, 'act:99', { key: 'new:c', index: 2 })).toEqual({ key: 'new:c', index: 2 })
    expect(cursorFrom(rows, null, { key: 'new:c', index: 2 })).toEqual({ key: 'new:c', index: 2 })
  })

  it('moves with j and k and stops at the ends', () => {
    expect(stepCursor(3, -1, 1)).toBe(0)
    expect(stepCursor(3, -1, -1)).toBe(2)
    expect(stepCursor(3, 0, 1)).toBe(1)
    expect(stepCursor(3, 2, -1)).toBe(1)
    expect(stepCursor(3, 2, 1)).toBeNull()
    expect(stepCursor(3, 0, -1)).toBeNull()
    expect(stepCursor(0, -1, 1)).toBeNull()
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
    const groups = buildQueue(model, state, 0, ALL).groups
    expect(groups.map((g) => g.key)).toEqual(GROUPS.filter((g) => g.key !== 'tied').map((g) => g.key))
    expect(groups).toHaveLength(6)
    for (const g of groups) {
      const { claims, skipped } = splitTied(g.rows, state.claims)
      expect(claims, g.key).toEqual([])
      expect(skipped, g.key).toHaveLength(g.rows.length)
    }
    expect(groups.find((g) => g.key === 'contradicted')!.rows).toHaveLength(29)
  })
})

// A refusal whose reason quotes a token, as authorize.ts's verify "is now … not …" does for a sensitive claim.
const theoToken = () => masked.household.people.find((p) => p.id === 'theo')!.ssn
const refused = () => ({ ok: false as const, reason: `household:theo#ssn is now "${theoToken()}", not "x"` })
const input = (target: string): ActInput => ({ type: 'note', target, body: { kind: 'memo', text: 'n', blocking: false } })

describe('acceptRefusal (tied Accept N and the bulk bar, spec §3)', () => {
  const ok = () => ({ ok: true as const })

  it('is the role sentence without the role, authorize()\'s reason in display form when refused, else null', () => {
    expect(acceptRefusal(null, input('SchC.8'), ok)).toBe('Accepting a tied check is a reviewer or partner act.')
    expect(acceptRefusal('reviewer', input('SchC.8'), ok)).toBeNull()
    const why = acceptRefusal('partner', input('SchC.8'), refused)!
    expect(why).toContain('•••-••-3309')
    expect(why).not.toContain('«')
  })

  it('judges nothing when there is no tied claim to accept (the toast says why)', () => {
    expect(acceptRefusal('reviewer', undefined, refused)).toBeNull()
    expect(acceptRefusal(null, undefined, refused)).toBe('Accepting a tied check is a reviewer or partner act.')
  })
})

describe('postText (bulk toasts and the undo label)', () => {
  it('masks a refusal in the undo label of a partly refused batch, and keeps the note', () => {
    const t = postText([{ input: input('a'), auth: { ok: true } }, { input: input('b'), auth: refused() }], 'Accepted', [], 'skipped 2 not tied by a check')
    expect(t.allowed.map((i) => i.target)).toEqual(['a'])
    expect(t.tail).toBe('; skipped 2 not tied by a check · 1 skipped (household:theo#ssn is now "•••-••-3309", not "x")')
    expect(t.tail).not.toContain('«')
  })

  it('joins the note and the first reason when authorize() refuses every input', () => {
    const t = postText([{ input: input('a'), auth: refused() }, { input: input('b'), auth: refused() }], 'Accepted', [], 'skipped 2 not tied by a check')
    expect(t.allowed).toEqual([])
    expect(t.none).toBe('Accepted 0; skipped 2 not tied by a check · household:theo#ssn is now "•••-••-3309", not "x"')
    expect(t.none).not.toContain('«')
  })

  it('says the note alone, the reason alone, or that nothing can take the act', () => {
    expect(postText([], 'Accepted', [], 'skipped 3 not tied by a check').none).toBe('Accepted 0; skipped 3 not tied by a check')
    expect(postText([{ input: input('a'), auth: refused() }], 'Disposed').none).toBe('household:theo#ssn is now "•••-••-3309", not "x"')
    expect(postText([], 'Disposed', ['W-2 is cleared where it lives']).none).toBe('W-2 is cleared where it lives')
    expect(postText([], 'Disposed').none).toBe('Nothing selected can take this act.')
    expect(postText([{ input: input('a'), auth: { ok: true } }], 'Disposed').tail).toBe('')
  })

  it("gives undo's refusal (one input) its reason in display form", () => {
    const t = postText([{ input: input('act:7'), auth: refused() }], 'Undone')
    expect(t.allowed).toEqual([])
    expect(t.none).toContain('•••-••-3309')
    expect(t.none).not.toContain('«')
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
