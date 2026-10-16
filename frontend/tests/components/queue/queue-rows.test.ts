// Queue rows and group headers (queue spec 2026-10-15 §3, §4.1, §4.2), server-rendered against the masked packet:
// at most two lines, money only when something is at stake, one "Blocks filing" chip outside the blocks group, the
// ref in the row's title only, and masked tokens as •••-••-NNNN, never raw.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { type Filters, GROUPS, type Row, buildQueue } from '@/components/queue/queue-model'
import { GroupView, RowView, countLabel } from '@/components/queue/queue-rows'
import type { Act, ActInput } from '@/lib/model/acts'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

const masked = maskPacket(readPacket()).masked
const model = buildModel(masked)
const ALL: Filters = { area: null, mine: false, q: '' }
// The token's eq tag is an HMAC keyed by MASK_SECRET, so it is read from the packet; only its display form is pinned.
const theo = masked.household.people.find((p) => p.id === 'theo')!.ssn
const THEO = '•••-••-3309'

const noop = () => {}
const on = { onSelect: noop, onOpen: noop, onPick: noop, onCursor: noop }

function queueOf(acts: Act[]) {
  const state = project(model, acts, viewerOf(masked, 'st-01'))
  return { state, rows: buildQueue(model, state, 0, ALL).groups.flatMap((g) => g.rows) }
}
const empty = queueOf([])

function renderRow(find: (r: Row) => boolean, q = empty, selected = false) {
  const row = q.rows.find(find)
  if (!row) throw new Error('no such row')
  const html = renderToString(h(RowView, { row, model, state: q.state, selected, cursor: false, picked: false, on }))
  return { row, state: q.state, html }
}
const byKey = (key: string) => (r: Row) => r.key === key

/** The row button's top-level spans, i.e. its lines. */
function lines(html: string): string[] {
  const button = html.indexOf('<button type="button" data-row=')
  if (button < 0) throw new Error('no row button in this html')
  const start = html.indexOf('>', button) + 1
  const body = html.slice(start, html.indexOf('</button>', start))
  const out: string[] = []
  let depth = 0
  let from = 0
  for (const m of body.matchAll(/<(\/?)span\b[^>]*>/g)) {
    if (m[1]) {
      depth--
      if (depth === 0) out.push(body.slice(from, m.index! + m[0].length))
    } else {
      if (depth === 0) from = m.index!
      depth++
    }
  }
  return out
}
const text = (html: string) => html.replace(/<[^>]+>/g, '')

// Token-bearing acts: a blocking review note quoting Theo's SSN token on a line and on the return, and an agency
// rejection whose message quotes it.
const note = (target: string): [string, ActInput] => [
  'st-02', { type: 'note', target, body: { kind: 'review_note', to: 'st-01', text: `Check Theo ${theo} before filing`, blocking: true } },
]
function withRejection(steps: [string, ActInput][]): Act[] {
  const acts = actsOf(model, [...steps, ['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal'] } }]])
  const filed = acts[acts.length - 1]
  const seq = filed.seq + 1
  const result: Act = {
    ...filed, seq, id: `t-${seq}`, actor: 'system', actor_role: 'system', type: 'agency_result', target: `act:${filed.seq}`, refs: [`act:${filed.seq}`],
    body: { jurisdiction: 'federal', status: 'rejected', errors: [{ code: 'IND-180', message: `Dependent SSN ${theo} was already claimed` }], rule: 'test' },
    derived: {}, hash: `h${seq}`, prev_hash: filed.hash,
  }
  return [...acts, result]
}
const tokens = queueOf(withRejection([note('F1040.26'), note('return')]))

describe('row', () => {
  it('puts the label on line 1 and the reason on line 2', () => {
    const { html } = renderRow(byKey('blocks:step:1'))
    const [one, two, ...rest] = lines(html)
    expect(rest).toEqual([])
    expect(text(one)).toBe('Engagement letter and consents signed')
    expect(text(two)).toBe('Step 1 · Engagement letter and consents signed: Not verified to the signed document: D01, D02')
  })

  // Run over the empty log and over a log whose acts quote a token, so "no raw token" can fail: some rows there carry
  // one in their title or reason.
  it.each([
    ['the empty log', empty],
    ['a log with token-bearing acts', tokens],
  ] as const)('renders every row of %s in at most two lines, with no pill, letters, mono ref, initials or raw token', (_, q) => {
    if (q === empty) expect(q.rows).toHaveLength(134)
    else expect(q.rows.filter((r) => `${r.title} ${r.reason ?? ''}`.includes('«')).length).toBeGreaterThanOrEqual(3)
    for (const row of q.rows) {
      const { html } = renderRow((r) => r === row, q)
      expect(lines(html).length, row.key).toBeLessThanOrEqual(2)
      expect(html, row.key).not.toMatch(/>(Open|Adjusted|Verified|Accepted|Read OK|Unreviewed)</)
      expect(html, row.key).not.toMatch(/>[DRCPT]<\/span>/)
      expect(html, row.key).not.toMatch(/>(Needs partner|Reopened|Stale|Not yet in file|Frozen)</)
      expect(html, row.key).not.toContain('font-mono')
      expect(html, row.key).not.toContain('Assigned to')
      expect(html, row.key).not.toContain('«')
      expect(html, row.key).toContain(`title="${row.ref}"`)
      expect(html, row.key).not.toContain(`>${row.ref}<`)
    }
  })

  it('marks the selected row with bg-muted and drops the hover tint, and only that row', () => {
    const li = (html: string) => html.match(/^<li class="([^"]*)"/)![1].split(' ')
    const on = li(renderRow(byKey('contradicted:F8949.B.N1'), empty, true).html)
    expect(on).toContain('bg-muted')
    expect(on).not.toContain('hover:bg-muted/50')
    const off = li(renderRow(byKey('contradicted:F8949.B.N1')).html)
    expect(off).toContain('hover:bg-muted/50')
    expect(off).not.toContain('bg-muted')
    expect(renderRow(byKey('contradicted:F8949.B.N1'), empty, true).html).toContain('aria-current="true"')
  })

  it('finds no lines where there is no row button', () => {
    expect(() => lines('<li><span>no button</span></li>')).toThrow('no row button')
  })

  it('keeps the ref out of the row text: it is the title attribute only', () => {
    const { html } = renderRow(byKey('contradicted:F8949.B.N1'))
    expect(html).toContain('title="F8949.B.N1"')
    // The finding's own sentence names the line; what goes is the ref as an element of its own.
    expect(html).not.toContain('>F8949.B.N1<')
    expect(html).toContain(`aria-label="Select ${model.claims['F8949.B.N1'].label}"`)
    expect(html).toMatch(/<button type="button" data-row="contradicted:F8949.B.N1"[^>]*class="[^"]*cursor-pointer/)
  })

  it('shows the money at stake on line 1 only when there is some', () => {
    const [one] = lines(renderRow(byKey('contradicted:F8949.B.N1')).html)
    expect(text(one)).toContain('Fed 6,647CA 1,222 at stake')
    expect(one).toContain('<span class="sr-only"> at stake</span>')
    const zero = renderRow(byKey('blocks:step:1')).html
    expect(zero).not.toContain('at stake')
    expect(zero).not.toContain('—')
  })

  it('shows "+N more" and "explains N totals above" on line 2', () => {
    expect(text(lines(renderRow(byKey('contradicted:F8949.B.N1')).html)[1])).toContain('+1 more')
    const root = renderRow(byKey('contradicted:SchB.1.6'))
    expect(root.row.downstream).toBe(1)
    expect(text(lines(root.html)[1])).toContain('explains 1 total above')
  })

  it('shows an uncorrected number, hides an uncorrected text value, and shows a correction as was / now', () => {
    const before = renderRow(byKey('contradicted:F1040.26')).html
    expect(text(lines(before)[1])).toContain('13,000')
    expect(before).not.toContain('<s>')
    expect(text(renderRow(byKey('contradicted:household:theo#ssn')).html)).not.toContain('•••')

    const adjusted = queueOf(actsOf(model, [['st-01', { type: 'adjust', target: 'F1040.26', body: { field: 'value', to: 12900, reason: 'Matches the IRS transcript payments', evidence: [] } }]]))
    expect(adjusted.state.claims['F1040.26']).toMatchObject({ original: 13000, effective: 12900 })
    const two = lines(renderRow(byKey('contradicted:F1040.26'), adjusted).html)[1]
    expect(two).toMatch(/<span class="sr-only">was <\/span><s>.*13,000.*<\/s><span class="sr-only"> now <\/span>.*12,900/)
    expect(text(two)).toContain('was 13,000 now 12,900')
  })

  it('shows one "Blocks filing" chip on a blocking claim outside the blocks group, none inside it', () => {
    for (const key of ['blocks:F8867.status', 'blocks:Sch3.10', 'blocks:step:2']) {
      const { row, state, html } = renderRow(byKey(key))
      expect(state.claims[row.claim!].flags, key).toContain('blocks_filing')
      expect(html, key).not.toContain('Blocks filing')
    }
    for (const key of ['contradicted:SchC.1', 'contradicted:F1040.26', 'contradicted:household:theo#ssn']) {
      expect(renderRow(byKey(key)).html.match(/>Blocks filing</g), key).toHaveLength(1)
    }
    expect(renderRow(byKey('contradicted:F8949.B.N1')).html).not.toContain('Blocks filing')
  })
})

describe('masked tokens in rows', () => {
  it('masks a blocking note on a line: its title is line 2', () => {
    const { html } = renderRow((r) => r.kind === 'note', queueOf(actsOf(model, [note('F1040.26')])))
    const [one, two] = lines(html)
    expect(text(one)).toContain('2025 estimated tax payments')
    expect(two).toContain(`>Blocking review note by Daniel Ortiz: Check Theo ${THEO} before filing</span>`)
    expect(text(two)).toContain('13,000')
    expect(html).toContain('aria-label="Select 2025 estimated tax payments"')
    expect(html).not.toContain('«')
  })

  it('masks a blocking note on the return: label, reason and checkbox label', () => {
    const { html } = renderRow((r) => r.kind === 'note', queueOf(actsOf(model, [note('return')])))
    const [one, two] = lines(html)
    expect(text(one)).toBe(`Blocking review note by Daniel Ortiz: Check Theo ${THEO} before filing`)
    expect(text(two)).toBe(`Check Theo ${THEO} before filing`)
    expect(html).toContain(`aria-label="Select Blocking review note by Daniel Ortiz: Check Theo ${THEO} before filing"`)
    expect(html).not.toContain('«')
  })

  it('masks an agency rejection that quotes an SSN', () => {
    const [filed] = actsOf(model, [['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal'] } }]])
    const result: Act = {
      ...filed, seq: 2, id: 't-2', actor: 'system', actor_role: 'system', type: 'agency_result', target: 'act:1', refs: ['act:1'],
      body: { jurisdiction: 'federal', status: 'rejected', errors: [{ code: 'IND-180', message: `Dependent SSN ${theo} was already claimed` }], rule: 'test' },
      derived: {}, hash: 'h2', prev_hash: 'h1',
    }
    const { html } = renderRow(byKey('blocks:agency:2'), queueOf([filed, result]))
    const [one, two] = lines(html)
    expect(text(one)).toBe(`IRS rejected the filing: IND-180 Dependent SSN ${THEO} was already claimed`)
    expect(text(two)).toMatch(new RegExp(`Dependent SSN ${THEO} was already claimed$`))
    expect(html).not.toContain('«')
  })
})

describe('group header', () => {
  const [blocks, contradicted] = GROUPS
  const render = (props: Partial<Parameters<typeof GroupView>[0]> = {}) =>
    renderToString(h(GroupView, { group: blocks, count: 12, open: true, onToggle: noop, children: h('ul'), ...props }))
  const summary = (html: string) => html.match(/<summary class="([^"]*)"/)![1]
  const box = (html: string) => html.match(/<span[^>]*aria-label="Select all in Blocks filing"[^>]*>/)?.[0]

  it('counts with a unit: items, or claims for the tied group', () => {
    expect([countLabel({ key: 'blocks' }, 12), countLabel({ key: 'weak' }, 1), countLabel({ key: 'new' }, 0), countLabel({ key: 'tied' }, 350), countLabel({ key: 'tied' }, 1)])
      .toEqual(['12 items', '1 item', '0 items', '350 claims', '1 claim'])
  })

  it('shows the count label when given, the bare count by default', () => {
    expect(render({ countLabel: '12 items' })).toContain('>12 items</span></summary>')
    expect(render()).toContain('>12</span></summary>')
  })

  it('shows the explanation under the header only when the group has rows', () => {
    const line = '<p class="px-3 pt-1.5 text-xs text-muted-foreground">Why these rows are here.</p>'
    expect(render({ explanation: 'Why these rows are here.' })).toContain(`</summary>${line}`)
    expect(render({ explanation: 'Why these rows are here.', count: 0 })).not.toContain('Why these rows are here.')
    expect(render({ explanation: null })).not.toContain('<p')
    expect(render()).not.toContain('<p')
  })

  it('puts the select-all box outside the summary, in its gutter, with its state', () => {
    const html = render({ selectAll: { state: 'some', enabled: true, onToggle: noop } })
    expect(html.indexOf('aria-label="Select all in Blocks filing"')).toBeGreaterThan(-1)
    expect(html.indexOf('aria-label="Select all in Blocks filing"')).toBeLessThan(html.indexOf('<summary'))
    expect(box(html)).toContain('aria-checked="mixed"')
    // Placed in the header's gutter over the wrapper (relative), so the Checkbox's own relative is merged away, and it
    // comes before the <details>, outside the <summary>.
    const cls = box(html)!.match(/class="([^"]*)"/)![1]
    expect(cls).toContain('absolute top-2 left-3')
    expect(cls.split(' ')).not.toContain('relative')
    expect(html.indexOf('aria-label="Select all in Blocks filing"')).toBeLessThan(html.indexOf('<details'))
    expect(summary(html)).toContain('pl-9')
    expect(box(render({ selectAll: { state: 'all', enabled: true, onToggle: noop } }))).toContain('aria-checked="true"')
    expect(box(render({ selectAll: { state: 'none', enabled: false, onToggle: noop } }))).toMatch(/aria-checked="false".*aria-disabled="true"|aria-disabled="true".*aria-checked="false"/)
  })

  it('keeps the gutter without a box for null, and today\'s header without selectAll', () => {
    const none = render({ selectAll: null })
    expect(none).not.toContain('Select all')
    expect(summary(none)).toContain('pl-9')
    expect(summary(render())).not.toContain('pl-9')
  })

  it('accents only the blocks group header', () => {
    expect(summary(render())).toContain('border-l-2 border-danger')
    expect(render({ group: contradicted })).not.toContain('border-danger')
  })

  // The guided tour rings the first visible match, so every group's root <details> carries the hook.
  it('marks every group\'s <details> as a tour stop', () => {
    for (const group of GROUPS) {
      expect(render({ group }), group.key).toMatch(/<details[^>]*\sdata-tour="queue-group"/)
    }
  })
})
