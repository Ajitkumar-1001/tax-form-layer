// Server-render tests of /filing as a checklist (spec 3, §13) over the MASKED model the browser uses: the anchors, each
// viewer's status line, Sign buttons and filing buttons, blockers listed once, refusals in visible text, no raw ids,
// masking, type and colour, the partner desk and the record. No jsdom here: renderToString inside WorkspaceContext.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readPacket } from '../records/fixture'
import { partnerDesk } from '@/components/filing/filing-logic'
import { FilingPage } from '@/components/filing/filing-page'
import { labelOf, plainWhat } from '@/components/filing/filing-status'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { type Act, type ActInput, refsOf } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { deriveFor } from '@/lib/model/derive'
import { AREAS } from '@/lib/model/ids'
import { displayMasked, makeToken, parseToken, plainMasked } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import type { Reason, State } from '@/lib/model/state'
import { identities, viewerOf } from '@/lib/model/viewer'
import { EFILE_RULE } from '@/lib/server/agency'
import { maskPacket } from '@/lib/server/mask'

const packet = maskPacket(readPacket()).masked
const model = buildModel(packet)
const people = identities(packet)
const role = (id: string) => people.find((v) => v.id === id)?.role ?? 'system'
const STAFF = ['st-01', 'st-02', 'st-03', 'st-04', 'st-05', 'st-06']

// ── Logs and workspaces (log, agency and ws copied from screens-render.test.ts:37-73) ──────────────────────────────────

type Step = [string, ActInput] | Act

/** Derive like the server (without authorize); raw Act entries (agency results) are appended as given. */
function log(steps: Step[]): Act[] {
  const acts: Act[] = []
  for (const s of steps) {
    const seq = acts.length + 1
    if (!Array.isArray(s)) {
      acts.push({ ...s, seq })
      continue
    }
    const [actor, input] = s
    const state = project(model, acts, viewerOf(packet, 'st-03'))
    acts.push({
      seq, id: `t-${seq}`, engagement: 'test', recorded_at: '2026-10-14T12:00:00Z', season_at: state.clock, actor, actor_role: role(actor),
      type: input.type, target: input.target, refs: refsOf(input), body: input.body as Record<string, unknown>,
      derived: deriveFor(model, state, input), batch_id: null, hash: `h${seq}`, prev_hash: '',
    })
  }
  return acts
}

const agency = (fileSeq: number, jurisdiction: 'federal' | 'california', status: 'accepted' | 'rejected' | 'held', errors: { code: string; message: string }[] = []): Act => ({
  seq: 0, id: 'a', engagement: 'test', recorded_at: '2026-10-14T12:00:00Z', season_at: '2026-07-14T16:22:00Z', actor: 'system', actor_role: 'system',
  type: 'agency_result', target: `act:${fileSeq}`, refs: [`act:${fileSeq}`], body: { jurisdiction, status, errors, rule: EFILE_RULE },
  derived: status === 'accepted' ? { retain_until: '2033-07-14T16:22:00Z' } : {}, batch_id: null, hash: 'x', prev_hash: '',
})

function ws(viewerId: string, acts: Act[] = []): Workspace {
  const viewer = viewerOf(packet, viewerId)
  const state = project(model, acts, viewer)
  return {
    model, state, viewer, identities: people, engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

/** ws() over an overridden state (§13 "Test setup"): its `can` judges that same state. */
const wsOn = (viewerId: string, state: State): Workspace => ({ ...ws(viewerId), state, can: (i) => authorize(model, state, i, viewerOf(packet, viewerId)) })

const request: [string, ActInput] = ['st-03', { type: 'request_approval', target: 'return', body: {} }]
const approve = (who: string): [string, ActInput] => [who, { type: 'client_approve', target: 'act:1', body: { pin: '12345' } }]
const submit: [string, ActInput] = ['st-03', { type: 'file', target: 'return', body: { kind: 'submit', jurisdictions: ['federal', 'california'] } }]
const LOGS = {
  empty: [] as Act[],
  filed: log([request, approve('cu-01'), approve('cu-02'), submit, agency(4, 'federal', 'accepted'), agency(4, 'california', 'accepted'),
    ['st-03', { type: 'clock', target: 'season', body: { to: '2028-01-27T00:00:00Z' } }]]),
  rejected: log([submit, agency(1, 'federal', 'rejected', [{ code: 'R0000-504-02', message: 'Dependent TIN mismatch' }]), agency(1, 'california', 'held', [{ code: 'STATE-HOLD', message: 'held' }])]),
}
type LogName = keyof typeof LOGS
const LOG_NAMES = Object.keys(LOGS) as LogName[]

// ── Rendering and reading the HTML ─────────────────────────────────────────────────────────────────────────────────────

const SSN = /\b\d{3}-\d{2}-\d{4}\b/
/** Renders, and fails the test if the HTML (text or attributes) carries a raw mask token or a dashed SSN. */
const render = (el: ReactElement, w: Workspace) => {
  const html = renderToString(h(WorkspaceContext, { value: w }, el))
  expect(html).not.toMatch(/«/)
  expect(html).not.toMatch(SSN)
  return html
}
const pages = new Map<string, string>()
/** FilingPage as `viewerId` on one of the three logs, rendered once per file. */
function page(viewerId: string, name: LogName = 'empty'): string {
  const key = `${viewerId} ${name}`
  if (!pages.has(key)) pages.set(key, render(h(FilingPage), ws(viewerId, LOGS[name])))
  return pages.get(key)!
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** A space per tag (as screens-render.test.ts:83), after dropping React's `<!-- -->` text separators, which are not tags. */
const text = (html: string) => decode(html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
/** Tags removed with nothing in their place, entities decoded: for exact comparisons. */
const plain = (html: string) => decode(html.replace(/<[^>]+>/g, '')).trim()
const count = (hay: string, needle: string) => hay.split(needle).length - 1

/** The element whose opening tag starts at `start`, through its matching close tag (nested tags of its own name counted). */
function elementAt(html: string, start: number): string {
  const name = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start))?.[1]
  if (!name) throw new Error(`no tag at ${start}`)
  const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g')
  tag.lastIndex = start
  let depth = 0
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (m[0].endsWith('/>')) {
      if (depth === 0) return m[0]
      continue
    }
    depth += m[1] ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  throw new Error(`<${name}> at ${start} is never closed`)
}
/** The one element whose opening tag holds `needle` (an attribute such as ` id="steps"`, or a tag start). */
function only(html: string, needle: string): string {
  const at = html.indexOf(needle)
  expect(at, needle).toBeGreaterThan(-1)
  expect(html.indexOf(needle, at + 1), `${needle} occurs twice`).toBe(-1)
  return elementAt(html, html.lastIndexOf('<', at))
}
const byId = (html: string, id: string) => only(html, ` id="${id}"`)
/** Removes each element marked data-refusal with its whole subtree (MaskedText nests spans, so tags are counted). */
function strip(html: string): string {
  for (let at = html.indexOf(' data-refusal'); at !== -1; at = html.indexOf(' data-refusal')) {
    const start = html.lastIndexOf('<', at)
    html = html.slice(0, start) + html.slice(start + elementAt(html, start).length)
  }
  return html
}
/** Every <button>: its opening tag and its plain() text. */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => ({ tag: m[0], label: plain(elementAt(html, m.index)) }))
/** The opening tag of the one button labelled exactly `label`. */
function button(html: string, label: string): string {
  const found = buttons(html).filter((b) => b.label === label)
  expect(found.map((b) => b.label), label).toEqual([label])
  return found[0].tag
}
/** Disabled, in either form: `disabled=""` (not `data-disabled=""`) or `aria-disabled="true"`. */
const DISABLED = /\sdisabled=""|\saria-disabled="true"/
const NATIVE_DISABLED = /\sdisabled=""/
/** The plain text of the element a button's aria-describedby names, matched literally by id. */
function described(html: string, tag: string): string {
  const id = /\saria-describedby="([^"]+)"/.exec(tag)?.[1]
  expect(id, tag).toBeTruthy()
  return plain(byId(html, id!))
}

const E49 = 'You prepared Sch3.10 (timeline:extension-2026-04-14). Route to another reviewer or the partner.'
const RAW = /\b(?:chk|diag|area|py|agency|timeline|household|act|batch):|\bwhat_if\.|\(st-0\d\)|\bcu-0\d\b|\bqa-\d\d\b|«|\bD or T\b/
const PALETTE = /\b(?:bg|text|border|ring)-(?:red|orange|amber|emerald|green|slate|yellow)-\d/
const TOUCHED = ['filing-page', 'required-steps', 'item-list', 'filing-act', 'approval-submit', 'signoff-matrix', 'partner-desk', 'filings-record', 'season-panels']
const source = (file: string) => readFileSync(path.join(process.cwd(), 'src/components/filing', `${file}.tsx`), 'utf8')

// ── Cases ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('anchors', () => {
  it('keeps the literal steps section and every id a link lands on, under one h1', () => {
    const html = page('st-01')
    expect(only(html, '<section aria-labelledby="steps"')).toContain('<h2 id="steps"')
    // Links land below the sticky header (two rows below lg, one from lg) only through these scroll margins.
    const landsClear = (el: string) => {
      const open = /^<[^>]*>/.exec(el)![0]
      expect(open).toContain('scroll-mt-44')
      expect(open).toContain('lg:scroll-mt-20')
    }
    landsClear(only(html, '<h2 id="steps"'))
    for (const id of ['matrix', 'approval', 'desk', 'record', 'filings', 'extension', 'season', ...Array.from({ length: 12 }, (_, i) => `step-${i + 1}`)]) landsClear(byId(html, id))
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).not.toContain(' id="submit"')
  })

  // Loose-ends brief §B: a closed act dialog whose opener is gone or disabled hands focus to the nearest marker.
  it('marks each sign-off row and each headed section but Required steps as a focusable focus return', () => {
    const html = page('st-03')
    const openTag = (el: string) => el.slice(0, el.indexOf('>') + 1)
    const rows = [...AREAS, 'return'].map((k) => byId(html, `signoff-${k}`))
    const ids = ['approval', 'matrix', 'desk', 'record', 'filings', 'extension', 'season']
    const sections = ids.map((id) => only(html, `<section aria-labelledby="${id}"`))
    for (const el of [...rows, ...sections]) {
      const tag = openTag(el)
      expect(tag).toContain(' data-focus-return="true"')
      expect(tag).toContain(' tabindex="-1"')
      expect(tag).toContain('focus-visible:ring-2')
    }
    expect(openTag(only(html, '<section aria-labelledby="steps"'))).not.toContain('data-focus-return')
    expect(count(html, ' data-focus-return=')).toBe(rows.length + sections.length)
  })
})

describe('per viewer, on the empty log', () => {
  const EMPTY: Record<string, { status: string; sign: number; request: string; submit: string }> = {
    'st-01': {
      status: 'Filing is blocked: 0 of 12 required steps done. Your next step for filing: step 1, Engagement letter and consents signed.',
      sign: 10,
      request: 'Requesting client approval is a reviewer or partner act. Also blocked by 11 open steps.',
      submit: 'Only the partner (the paid preparer) can file. Also blocked by 12 open steps.',
    },
    'st-02': {
      status: 'Filing is blocked: 0 of 12 required steps done. No review sign-off is owed yet: waiting for preparer sign-offs (9 areas).',
      sign: 18,
      request: 'Blocked by 11 open steps.',
      submit: 'Only the partner (the paid preparer) can file. Also blocked by 12 open steps.',
    },
    'st-03': {
      status: 'Filing is blocked: 0 of 12 required steps done. Nothing for filing needs you yet: the reviewer signs every area first (step 10).',
      sign: 30,
      request: 'Blocked by 11 open steps.',
      submit: 'Blocked by 12 open steps.',
    },
    'st-04': {
      status: 'Filing is blocked: 0 of 12 required steps done. Nothing for filing is assigned to you: Priya Raman clears step 1 first.',
      sign: 10,
      request: 'Requesting client approval is a reviewer or partner act. Also blocked by 11 open steps.',
      submit: 'Only the partner (the paid preparer) can file. Also blocked by 12 open steps.',
    },
    'st-05': {
      status: 'Filing is blocked: 0 of 12 required steps done. Nothing for filing is yours: the firm administrator is read-only on the return.',
      sign: 0,
      request: 'Jo Kimura is the firm administrator: read-only on return claims (no value changes or sign-offs). Also blocked by 11 open steps.',
      submit: 'Jo Kimura is the firm administrator: read-only on return claims (no value changes or sign-offs). Also blocked by 12 open steps.',
    },
    'st-06': {
      status: 'Filing is blocked: 0 of 12 required steps done. You are not active until 2027-01-04; your actions are refused until then.',
      sign: 0,
      request: 'Sam Adeyemi is active from 2027-01-04. Also blocked by 11 open steps.',
      submit: 'Sam Adeyemi is active from 2027-01-04. Also blocked by 12 open steps.',
    },
  }

  for (const [id, want] of Object.entries(EMPTY)) {
    it(`${id}: the status line, the Sign buttons, both filing buttons with their reasons, and who acts on every red row`, () => {
      const html = page(id)
      expect(plain(only(html, ' data-filing-status'))).toBe(want.status)
      expect(buttons(html).filter((b) => /^Sign\b/.test(b.label))).toHaveLength(want.sign)
      const filingButtons: [string, string][] = [['Request approval', want.request], ['Submit federal and California', want.submit]]
      for (const [label, reason] of filingButtons) {
        const tag = button(html, label)
        expect(tag, label).toContain('aria-disabled="true"')
        expect(tag, label).not.toMatch(NATIVE_DISABLED)
        expect(described(html, tag), label).toBe(reason)
      }
      for (const s of ws(id).state.steps) if (!s.ok) expect(plain(byId(html, `step-${s.n}`)), `step ${s.n}`).toContain('Who acts: ')
    })
  }

  it("st-01: the next step links to the step's row", () => {
    expect(only(page('st-01'), ' data-filing-status')).toMatch(/<a\b[^>]*\shref="#step-1"[^>]*>step 1, Engagement letter and consents signed<\/a>/)
  })

  it("st-02: Daniel's E49 refusal is text in his reviewer cells on Payments & filing and the Whole return, and nowhere else", () => {
    const html = page('st-02')
    for (const row of ['signoff-payments_and_filing', 'signoff-return']) {
      const li = byId(html, row)
      expect(li.startsWith('<li'), row).toBe(true)
      expect(plain(li), row).toContain(E49)
      expect(plain(li), row).toContain('Not signed; Helen Strand signs')
    }
    expect(count(text(html), E49)).toBe(2)
  })

  it("st-01: Priya's reviewer cells name who signs (Daniel Ortiz, or Helen Strand on Payments & filing and the Whole return)", () => {
    const html = page('st-01')
    for (const key of [...AREAS, 'return']) {
      const row = plain(byId(html, `signoff-${key}`))
      const helen = key === 'payments_and_filing' || key === 'return'
      expect(count(row, 'Not signed; Daniel Ortiz signs'), key).toBe(helen ? 0 : 1)
      expect(count(row, 'Not signed; Helen Strand signs'), key).toBe(helen ? 2 : 1)
    }
  })

  it('st-05 and st-06: one refusal line in Sign-offs and none per cell', () => {
    const notes: [string, string][] = [
      ['st-05', 'You cannot sign off here: Jo Kimura is the firm administrator: read-only on return claims (no value changes or sign-offs).'],
      ['st-06', 'You cannot sign off here: Sam Adeyemi is active from 2027-01-04.'],
    ]
    for (const [id, note] of notes) {
      const matrix = only(page(id), '<section aria-labelledby="matrix"')
      expect(count(matrix, ' data-refusal'), id).toBe(1)
      expect(plain(only(matrix, ' data-refusal')), id).toBe(note)
    }
    expect(count(plain(only(page('st-05'), '<section aria-labelledby="matrix"')), 'Not signed; Priya Raman or Marcus Bell signs')).toBe(10)
  })
})

describe('caution', () => {
  it('gives st-03 an enabled, outlined "Request approval again" described by the caution while a current request waits', () => {
    const s = project(model, log([request]), viewerOf(packet, 'st-03'))
    const state: State = { ...s, gates: { request_approval: { ok: true, reasons: [] }, submit: { ok: true, reasons: [] } } }
    const html = render(h(FilingPage), wsOn('st-03', state))
    const tag = button(html, 'Request approval again')
    expect(tag).not.toMatch(DISABLED)
    expect(tag).toMatch(/\sclass="[^"]*\bborder-border\b/) // the outline variant
    expect(described(html, tag)).toBe("The request is still current; requesting again restarts both clients' approval.")
  })
})

describe('criterion 2: every blocker once', () => {
  /** §4.3: what a step reason shows before its disclosure is opened. */
  const summaryOf = (r: Reason): string => {
    const what = plainWhat(r.what ?? r.text)
    const refs = r.refs ?? []
    if (refs.length === 0) return what
    if (refs.length === 1) return refs[0] === 'return' ? what : `${what}: ${plainMasked(labelOf(model, refs[0]))}`.replace(/\s+/g, ' ')
    return `${what}: ${refs.length} items`
  }

  for (const id of STAFF) {
    it(`${id}: each step reason's summary occurs once, and the old gate lists are gone`, () => {
      const t = text(page(id))
      const summaries = ws(id).state.steps.flatMap((s) => s.reasons.map(summaryOf))
      for (const s of ['Not verified to the signed document: 2 items', 'Not disposed: 11 items', 'No valid partner sign-off on the return']) expect(summaries).toContain(s)
      for (const s of summaries) expect(count(t, s), s).toBe(1)
      expect(t).not.toContain('Cannot request approval yet')
      expect(t).not.toContain('Filing blocked:')
    })
  }

  it('links the reasons that have one target on this page', () => {
    const html = page('st-01')
    expect(html).toMatch(/<a\b[^>]*\shref="#signoff-return"[^>]*>No valid partner sign-off on the return<\/a>/)
    expect(html).toMatch(/<a\b[^>]*\shref="#approval"[^>]*>Client approval not requested<\/a>/)
  })

  it("with two blocking review notes (one quoting Theo's SSN), Required steps has 14 danger rows and shows the note masked", () => {
    const token = model.packet.household.people.find((p) => p.id === 'theo')!.ssn
    const shown = displayMasked(parseToken(token)!)
    expect(shown).toBe('•••-••-3309')
    const note = `The dependent SSN on the return does not match the card in D05; confirm ${token} with the client.`
    const w = ws('st-01', log([
      ['st-02', { type: 'note', target: 'F8949.B.N1', body: { kind: 'review_note', text: note, blocking: true } }],
      ['st-02', { type: 'note', target: 'return', body: { kind: 'review_note', to: 'st-04', text: 'Tie the extension payment to the IRS transcript.', blocking: true } }],
    ]))
    expect(w.state.gates.submit.reasons).toHaveLength(14)
    const steps = only(render(h(FilingPage), w), '<section aria-labelledby="steps"')
    expect(steps.match(/<svg\b[^>]*\btext-danger\b[^>]*>/g)).toHaveLength(14)
    expect(text(steps)).toContain(shown)
  })
})

describe('criteria 3, 4 and 6 in every render (st-01 to st-06 on the empty, filed and rejected logs)', () => {
  for (const name of LOG_NAMES) {
    for (const id of STAFF) {
      it(`${id}, ${name} log`, () => {
        const html = page(id, name)
        // 3: every disabled button is described by visible text, and no title wraps a button.
        for (const b of buttons(html)) if (DISABLED.test(b.tag)) expect(described(html, b.tag), `criterion 3: ${b.label}`).not.toBe('')
        expect(html, 'criterion 3').not.toMatch(/<span\b[^>]*\stitle="[^"]*"[^>]*><button\b/)
        // 4: no raw id, packet path or token outside the quoted refusals.
        const t = text(strip(html))
        const hit = RAW.exec(t)
        expect(hit && t.slice(Math.max(0, hit.index - 60), hit.index + 60), 'criterion 4').toBeNull()
        // 6: no text under 11 px from these classes.
        expect(html, 'criterion 6').not.toContain('text-[0.9em]')
        expect(html, 'criterion 6').not.toContain('text-[10px]')
      })
    }
  }
})

describe('source scans of the touched filing files', () => {
  it('render every data-refusal element through MaskedText', () => {
    let seen = 0
    for (const file of TOUCHED) {
      const src = source(file)
      for (let at = src.indexOf('data-refusal'); at !== -1; at = src.indexOf('data-refusal', at + 1)) {
        seen++
        const end = src.indexOf('</', at)
        expect(src.slice(at, end === -1 ? undefined : end), `${file}.tsx at ${at}`).toContain('<MaskedText')
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('use no raw palette class (criterion 6)', () => {
    for (const file of TOUCHED) expect(source(file), file).not.toMatch(PALETTE)
  })
})

describe('partner desk', () => {
  it('gives st-03 the toolbar and both items, with no amount on the two process findings', () => {
    const html = page('st-03')
    const desk = only(html, '<section aria-labelledby="desk"')
    const t = text(desk)
    expect(t).toContain('Select uncovered (2)')
    const tag = button(desk, 'Partner sign-off')
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).not.toMatch(NATIVE_DISABLED)
    expect(described(html, tag)).toBe('Select the items to sign.')
    for (const item of partnerDesk(model, ws('st-03').state)) expect(t).toContain(plainMasked(labelOf(model, item.target)))
    expect(t).not.toContain('—')
    expect(t).not.toMatch(/\b(?:Federal|California)\b/)
  })

  it('gives st-01 the refusal line and no checkbox', () => {
    const desk = only(page('st-01'), '<section aria-labelledby="desk"')
    expect(text(desk)).toContain('A preparer cannot sign off at partner level.')
    expect(desk).not.toContain('role="checkbox"')
    expect(desk).not.toContain('Select uncovered')
  })
})

describe('record', () => {
  it('words the extension and counts later season events, naming no next event (empty log)', () => {
    const t = text(page('st-03'))
    expect(t).toContain('Daniel Ortiz filed the extension on 2026-04-14: Form 4868 with 36,000 (federal) and FTB 3519 with 0 (California), sized from return version 2.')
    expect(t).not.toContain('(st-02)')
    expect(t).toContain('12 more packet events later in the season.')
    expect(t).not.toContain('next client message')
    expect(t).not.toContain(' on 2026-06-30')
  })

  it('masks a token in an IRS transcript row: its description renders through MaskedText', () => {
    const token = makeToken('ssn', '3309', 'synthetic0')
    const { tax_agency_records: records } = model.packet
    const irs = records.irs_account_transcript_2025.map((t) => ({
      ...t, transactions: t.transactions.map((x) => ({ ...x, description: `${x.description} for ${token}` })),
    }))
    const w = ws('st-03')
    // render() fails on a raw token or a dashed SSN anywhere in the HTML.
    const html = render(h(FilingPage), { ...w, model: { ...model, packet: { ...model.packet, tax_agency_records: { ...records, irs_account_transcript_2025: irs } } } })
    const extension = text(only(html, '<section aria-labelledby="extension"'))
    expect(extension).toContain('Code 460 is an extension payment; code 670 is an estimated tax payment.')
    expect(extension).toContain(`Estimated tax payment for ${displayMasked({ kind: 'ssn', last4: '3309' })}`)
  })

  it('hides Open amendment for everyone before any freeze', () => {
    for (const id of STAFF) expect(buttons(page(id)).map((b) => b.label), id).not.toContain('Open amendment')
  })

  it('on the filed log: Open amendment refused in words for st-01 and enabled for st-03, one Frozen chip, and the status line links to it', () => {
    const preparer = page('st-01', 'filed')
    const refused = button(preparer, 'Open amendment')
    expect(refused).toContain('aria-disabled="true"')
    expect(refused).not.toMatch(NATIVE_DISABLED)
    expect(described(preparer, refused)).toBe('Only the partner can open an amendment.')
    const html = page('st-03', 'filed')
    expect(button(html, 'Open amendment')).not.toMatch(DISABLED)
    // Outlined like Client copy beside it, enabled or refused (P19).
    for (const tag of [refused, button(html, 'Open amendment')]) expect(tag).toMatch(/\sclass="[^"]*\bborder-border\b/)
    expect(count(text(html), 'Frozen:')).toBe(1)
    expect(only(html, ' data-filing-status')).toMatch(/<a\b[^>]*\shref="#filings"[^>]*>open an amendment<\/a>/)
  })
})
