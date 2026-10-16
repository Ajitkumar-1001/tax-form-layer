// Server-render tests of the Money, Team and Recent activity sections (spec §4.6, §4.7, §4.9) against the MASKED model
// the browser uses. No jsdom (as in handin/screens-render.test.ts): every render must carry no mask token and no SSN.
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatMoney, refHref } from '@/components/atoms'
import { actsOf, readPacket } from '../records/fixture'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { Act, ActInput } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import type { AreaKey } from '@/lib/model/ids'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { ActivitySection } from '@/components/overview/activity'
import { MoneySection } from '@/components/overview/money'
import { type Money, summarize } from '@/components/overview/overview-model'
import { ReplayContext } from '@/components/overview/replay-safe'
import { TeamSection } from '@/components/overview/team'

const packet = maskPacket(readPacket()).masked
const model = buildModel(packet)
const people = identities(packet)

function ws(viewerId: string, acts: Act[] = [], lastSeenSeq = 0): Workspace {
  const viewer = viewerOf(packet, viewerId)
  const state = project(model, acts, viewer)
  return {
    model, state, viewer, identities: people, engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq, markSeen: () => {},
  }
}

const SSN = /\b\d{3}-\d{2}-\d{4}\b/
const render = (el: ReactElement, w: Workspace) => {
  const html = renderToString(h(WorkspaceContext, { value: w }, el))
  expect(html).not.toMatch(/«/)
  expect(html).not.toMatch(SSN)
  return html
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const dollars = (n: number) => `$${formatMoney(Math.round(Math.abs(n)))}`
const overview = (w: Workspace) => summarize(model, w.state, w.viewer)

describe('money at stake', () => {
  const w = ws('st-01')
  const { money } = overview(w)

  it('shows the error exposure, its net, unproven, choices and what is already corrected in plain words', () => {
    expect(money.errors.count).toBeGreaterThan(0)
    const t = text(render(h(MoneySection, { money }), w))
    expect(t).toContain('Money at stake')
    expect(t).toContain(`${dollars(money.errors.exposure.fed)} federal and ${dollars(money.errors.exposure.ca)} California at stake if every error is fixed`)
    expect(t).toContain(`Net change if every error is fixed: Federal ${formatMoney(Math.round(money.errors.net.fed), true)} · California ${formatMoney(Math.round(money.errors.net.ca), true)}`)
    expect(t).toContain(`Unproven: ${money.unproven.count} item`)
    expect(t).toContain(`${money.choices} engine alternative`)
    expect(t).toContain('Already corrected: Federal 0 · California 0')
  })

  it('lists the top errors in order, each with its stake and a link to its claim', () => {
    expect(money.errors.top.length).toBeGreaterThan(0)
    const html = render(h(MoneySection, { money }), w)
    const at = money.errors.top.map((p) => html.indexOf(`href="${refHref(p.claim)}"`))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    const t = text(html)
    for (const p of money.errors.top) expect(t).toContain(`Federal ${formatMoney(Math.round(p.fed), true)} · California ${formatMoney(Math.round(p.ca), true)}`)
  })

  it('says so when no money is at stake', () => {
    const none: Money = {
      errors: { count: 0, exposure: { fed: 0, ca: 0 }, net: { fed: 0, ca: 0 }, top: [] },
      unproven: { count: 0, exposure: { fed: 0, ca: 0 } },
      choices: 0,
      adjusted: { fed: 0, ca: 0 },
    }
    const t = text(render(h(MoneySection, { money: none }), w))
    expect(t).toContain('No money at stake in open issues.')
    expect(t).not.toContain('Largest')
    expect(t).not.toContain('engine alternative')
  })
})

describe('team and areas', () => {
  it('is a table with a caption, five column headers and a linked row per area', () => {
    const w = ws('st-05')
    const { team } = overview(w)
    const html = render(h(TeamSection, { team }), w)
    expect(html).toContain('<caption')
    expect(html.match(/<th scope="col"/g)).toHaveLength(5)
    expect(html.match(/<th scope="row"/g)).toHaveLength(9)
    for (const r of team) expect(html).toContain(`href="/queue?area=${r.key}&amp;mine=0"`)
    expect(html).toContain('href="/filing#matrix"')
    expect(html).toContain('href="/firm#time"')
    const t = text(html)
    expect(t).toContain('Priya Raman')
    expect(t).toContain('Not signed')
    expect(t).toContain('0 of 1.5 h') // intake budget
    expect(t).toContain('0 h, no budget set') // payments and filing has no budget line
    // Every number is a link (spec §5.1), and looks like one at rest: pen blue when no colour carries a meaning.
    const links = (href: string) => html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`, 'g')) ?? []
    for (const href of ['/filing#matrix', '/firm#time']) {
      expect(links(href)).toHaveLength(9)
      for (const a of links(href)) expect(a).toMatch(/class="[^"]*\btext-primary\b/)
    }
  })

  it('offers Reassign to the firm administrator on every area and to a preparer on none', () => {
    const admin = ws('st-05')
    expect(text(render(h(TeamSection, { team: overview(admin).team }), admin)).match(/Reassign/g)).toHaveLength(9)
    const preparer = ws('st-01')
    const html = render(h(TeamSection, { team: overview(preparer).team }), preparer)
    expect(html).not.toContain('Reassign')
    expect(html).not.toContain('disabled')
  })

  it('says over budget and an inactive assignee in words', () => {
    const time = (area: AreaKey, hours: number): [string, ActInput] => ['st-01', { type: 'time', target: `area:${area}`, body: { hours } }]
    const acts = actsOf(model, [['st-05', { type: 'assign', target: 'area:california', body: { assignee: 'st-06' } }], time('intake_and_engagement', 2)])
    const w = ws('st-05', acts)
    const html = render(h(TeamSection, { team: overview(w).team }), w)
    const t = text(html)
    expect(t).toContain('Sam Adeyemi not active until 2027-01-04')
    expect(t).toContain('2 of 1.5 h, over')
    // The warning colour stays (it means over budget), with a resting underline so the link still reads as one.
    const over = html.match(/<a[^>]*href="\/firm#time"[^>]*>2 of 1\.5 h, over<\/a>/)?.[0] ?? ''
    expect(over).toMatch(/class="[^"]*\btext-warning\b[^"]*"/)
    expect(over).toMatch(/class="[^"]*(?<![-:])\bunderline\b(?!-)/)
    expect(over).not.toMatch(/\btext-primary\b/)
  })

  it('keeps the success colour on a reviewed area, with a resting underline', () => {
    const acts = actsOf(model, [
      ['st-01', { type: 'signoff', target: 'area:business', body: { level: 'preparer' } }],
      ['st-02', { type: 'signoff', target: 'area:business', body: { level: 'reviewer' } }],
    ])
    const w = ws('st-05', acts)
    const html = render(h(TeamSection, { team: overview(w).team }), w)
    const reviewed = html.match(/<a[^>]*href="\/filing#matrix"[^>]*>Reviewed<\/a>/)?.[0] ?? ''
    expect(reviewed).toMatch(/class="[^"]*\btext-success\b[^"]*"/)
    expect(reviewed).toMatch(/class="[^"]*(?<![-:])\bunderline\b(?!-)/)
  })
})

describe('recent activity', () => {
  it('says No changes yet on an empty log, with no controls', () => {
    const t = text(render(h(ActivitySection), ws('st-03')))
    expect(t).toContain('Recent activity')
    expect(t).toContain('No changes yet.')
    expect(t).not.toContain('Mark all seen')
  })

  // Seqs 1-7 by Priya (st-01), Daniel (st-02) and Helen (st-03); 4 and 5 form one batch; 8 is Daniel revealing a value.
  const time = (actor: string, area: AreaKey): [string, ActInput] => [actor, { type: 'time', target: `area:${area}`, body: { hours: 0.5 } }]
  const log = actsOf(model, [
    time('st-01', 'intake_and_engagement'),
    time('st-01', 'wages_and_stock_compensation'),
    ['st-02', { type: 'note', target: 'D73', body: { kind: 'memo', text: 'Paystub checked against the W-2', blocking: false } }],
    time('st-01', 'business'),
    time('st-01', 'pass_throughs_and_basis'),
    time('st-03', 'california'),
    time('st-03', 'rentals_and_sale'),
  ]).map((a) => (a.seq === 4 || a.seq === 5 ? { ...a, batch_id: 'b-1' } : a))
  const reveal: Act = {
    ...log[0], seq: 8, id: 't-8', actor: 'st-02', actor_role: 'reviewer', type: 'view_sensitive', target: 'household:theo#ssn',
    refs: ['household:theo#ssn'], body: { eq: 'x', kind: 'ssn', context: 'household:theo#ssn', denied: false }, derived: {},
  }
  const acts = [...log, reveal]

  it('lists the latest five batches newest first, marks what others did since I last looked, and leaves out reveals', () => {
    const t = text(render(h(ActivitySection), ws('st-03', acts, 2)))
    // Areas read as their labels (spec §6), never as area:<key>.
    const order = ['Rentals & sale', 'California split', 'Business (Sch C)', 'D73', 'Wages & stock comp'].map((x) => t.indexOf(x))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(t).not.toContain('area:')
    expect(t).not.toContain('Intake & identity') // the sixth batch back
    expect(t).not.toContain('K-1s & basis') // inside the batch, which reads as its first act
    expect(t).toContain('Helen Strand time logged Rentals & sale · 2026-06-23')
    expect(t).toContain('Priya Raman time logged Business (Sch C) (2 changes)')
    expect(t).toContain('Daniel Ortiz note added D73')
    expect(t).not.toContain('viewed')
    // New: Daniel's note (3) and Priya's batch (4-5). Not Helen's own acts, not act 2 (seen), not the reveal.
    expect(t.match(/\bNew\b/g)).toHaveLength(2)
    expect(t).toContain('Since you last looked: 3 changes by others.')
  })

  it('says a sign-off, a revert and a clock move in plain words: an area label, "change N", no "season"', () => {
    const plain = actsOf(model, [
      ['st-01', { type: 'signoff', target: 'area:intake_and_engagement', body: { level: 'preparer' } }],
      ['st-01', { type: 'revert', target: 'act:1', body: { reason: 'Signed too early' } }],
      ['st-03', { type: 'clock', target: 'season', body: { to: '2026-07-14T00:00:00Z' } }],
    ])
    const t = text(render(h(ActivitySection), ws('st-05', plain)))
    expect(t).toContain('Priya Raman signed off Intake & identity · 2026-06-23')
    expect(t).toContain('Priya Raman reverted change 1 · 2026-06-23')
    expect(t).toContain('Helen Strand clock moved · 2026-06-23')
    expect(t).not.toMatch(/area:|act:\d|season ·/)
  })

  it('links See all to the since view and offers Mark all seen', () => {
    const html = render(h(ActivitySection), ws('st-03', acts, 2))
    expect(html).toContain('href="/compare?since=me"')
    expect(text(html)).toContain('Mark all seen')
  })

  it('counts changed numbers and sign-offs changed after signing in plain words', () => {
    const changed = actsOf(model, [
      ['st-01', { type: 'signoff', target: 'area:business', body: { level: 'preparer' } }],
      ['st-01', { type: 'adjust', target: 'SchC.1', body: { field: 'value', to: 151300, reason: 'Paywell 1099-K is already inside the Atlas deposits', evidence: ['D14'] } }],
    ])
    expect(text(render(h(ActivitySection), ws('st-03', changed)))).toContain(
      'Since you last looked: 2 changes by others, 1 number changed (net Federal −4,402, California −384), 1 sign-off changed after signing.',
    )
  })

  it('counts issues the season clock made visible', () => {
    const moved = actsOf(model, [['st-03', { type: 'clock', target: 'season', body: { to: '2026-07-14T00:00:00Z' } }]])
    expect(text(render(h(ActivitySection), ws('st-01', moved)))).toContain('Since you last looked: 1 change by others, 4 issues newly visible.')
  })

  it('renders nothing while the dashboard replays', () => {
    const w = ws('st-03', acts, 2)
    expect(renderToString(h(ReplayContext, { value: true }, h(WorkspaceContext, { value: w }, h(ActivitySection))))).toBe('')
  })
})
