// Server-render smoke test of every act form against the real model (no jsdom in this repo, so no clicks).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTourOpen, TOUR_READ_ONLY_REASON } from '@/components/tour/guard'
import { Dialog } from '@/components/ui/dialog'
import { WorkspaceContext } from '@/components/workspace/context'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import type { Finding } from '@/lib/model/checks/types'
import { displayMasked, makeToken } from '@/lib/model/mask-token'
import type { Packet } from '@/lib/model/packet-types'
import { project, scopeOf } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { ActForm } from '@/components/acts/act-dialog'
import { ActButton, FindingFixButton } from '@/components/acts/act-host'
import { normalizeRequest } from '@/components/acts/draft'
import { actsOf } from '../records/fixture'

// A server render never submits, so what a Save sets cannot change in one: `attempted` (a failed Save), `busy` (a Save in
// flight) and `serverError` (the server's refusal). renderSeeded seeds them for a single render, the way masked-text.test.ts
// seeds a token's state; the rest of the time useState is React's own.
const seed = vi.hoisted(() => ({
  /** The states renderSeeded is seeding, by name, while it renders; null the rest of the time. */
  states: null as { attempted?: boolean; busy?: boolean; serverError?: string } | null,
  /** What each state declared while it did, in order: a lazy initializer shows as 'init'. */
  declared: [] as unknown[],
}))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: (init: unknown) => {
      if (!seed.states) return react.useState(init)
      // A state is named by what it starts as and how many before it started the same (the draft's initializer is lazy):
      // `attempted` is the first that starts false, `busy` the second, `serverError` the first that starts null. Only the
      // states renderSeeded names are seeded; every other state is React's own.
      const before = seed.declared.filter((v) => v === init).length
      const name = init === false ? (['attempted', 'busy'] as const)[before] : init === null && before === 0 ? 'serverError' : undefined
      seed.declared.push(typeof init === 'function' ? 'init' : init)
      return name && name in seed.states ? [seed.states[name], () => {}] : react.useState(init)
    },
  }
})

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const model = buildModel(packet)

function workspace(viewerId: string, can: Workspace['can'] = () => ({ ok: true })): Workspace {
  const viewer = viewerOf(packet, viewerId)
  return {
    model, state: project(model, [], viewer), viewer, identities: identities(packet), engagement: 'main', packetSha: 'test',
    post: async () => ({ ok: true, acts: [] }), can, reveal: async () => ({ ok: false, reason: 'n/a' }),
    switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

/** The provider's can(): the real authorize() on the same state the form reads. */
function real(viewerId: string): Workspace {
  const ws = workspace(viewerId)
  return { ...ws, can: (i) => authorize(model, ws.state, i, ws.viewer) }
}

const render = (req: OpenActRequest, ws = workspace('st-01')) =>
  renderToString(h(Dialog, { open: true }, h(WorkspaceContext, { value: ws }, h(ActForm, { req: normalizeRequest(req), onDone: () => {}, onOpen: () => {} }))))

/** The form as a Save leaves it: the states in `states` seeded, the rest (the draft included) as the form opens. */
function renderSeeded(req: OpenActRequest, ws: Workspace, states: NonNullable<typeof seed.states>): string {
  seed.states = states
  seed.declared = []
  try {
    const html = render(req, ws)
    expect(seed.declared.slice(0, 4), 'ActForm should declare the draft, attempted, busy and serverError, in that order').toEqual(['init', false, false, null])
    return html
  } finally {
    seed.states = null
  }
}

/** The form as a failed Save leaves it: `attempted` set, the draft as opened. */
function renderAttempted(req: OpenActRequest, ws = workspace('st-01')): string {
  return renderSeeded(req, ws, { attempted: true })
}

/** The dialog as a reader sees it: React's text separators and the tags gone, spaces collapsed. */
const plain = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

/** Disabled, in either form: `disabled=""` (not `data-disabled=""`) or `aria-disabled="true"`, the form that stays in the Tab order. */
const DISABLED = /\sdisabled=""|\saria-disabled="true"/

/** A row renders as st-01 unless it names its own viewer: only a role with two levels or more has a Level field. */
const CASES: [OpenActRequest, string, Workspace?][] = [
  [{ type: 'verify', target: 'F1040.19' }, 'Agreed to source document'],
  [{ type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis', to: 19100 } }, 'Routes to partner'],
  [{ type: 'decide', target: 'F8867.status' }, 'Form 8867 paid-preparer due diligence'],
  [{ type: 'decide', target: 'whatif:standard_deduction' }, 'Exact engine result from the packet what-if.'],
  [{ type: 'dispose', target: 'D12' }, 'Save disposition'],
  [{ type: 'note', target: 'F1040.19' }, 'Add note'],
  [{ type: 'reply', target: 'act:1' }, 'Send reply'],
  [{ type: 'resolve', target: 'chk:CHK-01:x' }, 'What was done'],
  [{ type: 'attach', target: 'D11' }, 'Filed against'],
  [{ type: 'signoff', target: 'business' }, 'Business (Sch C)'],
  [{ type: 'revert', target: 'act:1' }, 'the revert is itself logged'],
  [{ type: 'assign', target: 'business' }, 'Assignee'],
  [{ type: 'time', target: 'business' }, 'Hours'],
  [{ type: 'request_approval', target: 'return' }, 'Send for approval'],
  [{ type: 'file', target: 'return' }, 'California (FTB)'],
  [{ type: 'amend_open', target: 'return' }, 'Open amendment'],
  [{ type: 'client_approve', target: 'act:1' }, '5-digit signature PIN'],
  [{ type: 'clock', target: 'season' }, 'Advance clock'],
  // A reviewer who prepared the line is opened below their own level; the real authorize() is what refuses the level above.
  [{ type: 'verify', target: 'Sch3.10', prefill: { level: 'preparer' } }, 'Reviewer level is not open to you', real('st-02')],
]

// The tour flag is module state: whatever a test leaves open would refuse every later form rendered on the shared engagement.
afterEach(() => setTourOpen(false))

describe('act forms render', () => {
  it.each(CASES)('%o shows %s', (req, text, ws) => {
    const html = render(req, ws)
    expect(html).toContain(text)
    expect(html).toContain('type="submit"')
  })

  // The idle form: Base UI writes aria-disabled only on a submit made focusableWhenDisabled, and the class shows its disabled
  // state. The Save in flight itself is seeded at the end of this file; that focus stays on the submit is the browser check's.
  it('builds the idle submit focusable-when-disabled (aria-disabled="false", data-disabled styling, never disabled="")', () => {
    const html = render({ type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis', to: 19100 } })
    const tag = html.match(/<button type="submit"[^>]*>/)?.[0] ?? ''
    expect(tag).toContain('aria-disabled="false"')
    expect(tag).toContain('data-disabled:opacity-50')
    expect(tag).not.toContain(' disabled=""')
  })

  it('a refusal replaces the submit button with the reason', () => {
    const reason = 'You prepared Sch3.10 (timeline:extension-2026-04-14). Route to another reviewer or the partner.'
    const html = render({ type: 'signoff', target: 'payments_and_filing' }, workspace('st-02', () => ({ ok: false, reason })))
    expect(html).toContain(reason)
    expect(html).not.toContain('type="submit"')
  })

  it('the refusal line masks a token: gateText can quote a blocking note that holds one', () => {
    const reason = `Client approval cannot be requested yet: confirm ${makeToken('ssn', '3309', 'synthetic0')}.`
    const html = render({ type: 'request_approval', target: 'return' }, workspace('st-02', () => ({ ok: false, reason })))
    expect(html).not.toContain('«')
    expect(html).toContain(displayMasked({ kind: 'ssn', last4: '3309' }))
    expect(html).not.toContain('type="submit"')
  })

  // The tour is read-only on `main` (tour/guard.ts). The writers refuse a POST, but only after the form is filled in; the form
  // says so as it opens, in the footer, where a refusal takes the submit's place. A fresh copy is where to experiment.
  it('while the tour is open on the shared engagement, a form says so in place of submit', () => {
    const req: OpenActRequest = { type: 'verify', target: 'F1040.19' }
    setTourOpen(true)
    const html = render(req)
    expect(html).toContain(TOUR_READ_ONLY_REASON)
    expect(html).not.toContain('type="submit"')
    const copy = render(req, { ...workspace('st-01'), engagement: 'copy-0a1b2c3d' })
    expect(copy).toContain('type="submit"')
    expect(copy).not.toContain(TOUR_READ_ONLY_REASON)
  })

  it('a request form masks a token in the gate reasons it lists, linked or not', () => {
    const token = makeToken('ssn', '3309', 'synthetic0')
    const shown = displayMasked({ kind: 'ssn', last4: '3309' })
    const ws = workspace('st-02')
    const reasons = [{ text: `Blocking review note: confirm ${token} with the client.`, ref: 'act:1' }, { text: `Step 2 open for ${token}` }]
    const html = render({ type: 'request_approval', target: 'return' }, { ...ws, state: { ...ws.state, gates: { ...ws.state.gates, request_approval: { ok: false, reasons } } } })
    expect(html).not.toContain('«')
    expect(html).toMatch(new RegExp(`<a href="/r/act%3A1"[^>]*>Blocking review note: confirm ${shown} with the client\\.</a>`))
    expect(html).toContain(`Step 2 open for ${shown}`)
  })

  it('the client signing dialog words each balance as the portal does, never signed', () => {
    const acts = actsOf(model, [['st-03', { type: 'request_approval', target: 'return', body: {} }]])
    const w = workspace('cu-01')
    const t = plain(render({ type: 'client_approve', target: `act:${acts[0].seq}` }, { ...w, state: project(model, acts, w.viewer) }))
    expect(t).toContain('$4,220 you owe')
    expect(t).toContain('$8,256 refund to you')
    expect(t).not.toMatch(/balance due|[-−]\d/)
  })

  // The PIN is whatever five digits the client types (post-acts hashes them as the signature) and no code is ever sent, so the
  // field must not carry the one-time-code hint: it makes a phone offer an SMS code that does not exist.
  const PIN_HINT = 'Type any 5 digits you choose; they are your signature on this approval. No code is sent to you.'
  /** The opening tag of the PIN input, the only password input in the signing dialog. */
  const PIN_INPUT = /<input\b[^>]*\stype="password"[^>]*>/
  /** The signing dialog as cu-01 sees it, opened on the request staff sent (the target is the log's own seq). */
  const signing = (): [OpenActRequest, Workspace] => {
    const acts = actsOf(model, [['st-03', { type: 'request_approval', target: 'return', body: {} }]])
    const w = workspace('cu-01')
    return [{ type: 'client_approve', target: `act:${acts[0].seq}` }, { ...w, state: project(model, acts, w.viewer) }]
  }
  /** What a control's aria-describedby names: that element's opening tag and its text, or undefined when it names nothing. */
  const describedLine = (html: string, tag: string) => {
    const id = /\saria-describedby="([^"]+)"/.exec(tag)?.[1]
    const at = id ? html.indexOf(` id="${id}"`) : -1
    if (at < 0) return undefined
    const el = html.slice(html.lastIndexOf('<', at))
    return { open: el.slice(0, el.indexOf('>') + 1), text: plain(el.slice(0, el.indexOf('</'))).trim() }
  }

  it('the PIN field offers no one-time-code autofill and says what the PIN is', () => {
    const [req, ws] = signing()
    const html = render(req, ws)
    const tag = PIN_INPUT.exec(html)?.[0] ?? ''
    expect(tag, 'a password input in the signing dialog').toBeTruthy()
    // React writes the attribute as autoComplete; HTML attribute names are not case-sensitive, so these patterns are not either.
    expect(html).not.toMatch(/\sautocomplete="one-time-code"/i)
    expect(tag).toMatch(/\sautocomplete="off"/i)
    const t = plain(html)
    expect(t).toContain('Your 5-digit signature PIN')
    expect(t).toContain(PIN_HINT)
    // The hint is the line the input is described by, so a screen reader reads it with the field.
    const line = describedLine(html, tag)
    expect(line, `${tag} should name the hint line`).toBeDefined()
    expect(line?.open).toMatch(/^<p\b/)
    expect(line?.text).toBe(PIN_HINT)
  })

  // A failed Save puts the error where the hint was (Field), and the PIN input has to name it or a screen reader never hears it.
  // A server render reaches that state through renderAttempted; no request prefills a PIN, so the form opens with it empty (the
  // other bad entries are draft.test.ts's: "1234" gives the same words).
  it('an empty Approve shows the PIN error and the PIN input is described by it', () => {
    const [req, ws] = signing()
    const html = renderAttempted(req, ws)
    const tag = PIN_INPUT.exec(html)?.[0] ?? ''
    expect(tag, 'a password input in the signing dialog').toBeTruthy()
    const line = describedLine(html, tag)
    expect(line, `${tag} should name the error line`).toBeDefined()
    expect(line?.open).toMatch(/^<p\b[^>]*\sclass="[^"]*text-destructive/)
    expect(line?.text).toBe('Enter 5 digits')
    expect(tag).toContain('aria-invalid="true"')
  })

  // Balances is shared: the staff request dialog keeps the signed "balance due" rows the client one drops.
  it('the staff approval request still reads each side as a balance due', () => {
    const t = plain(render({ type: 'request_approval', target: 'return' }, workspace('st-03')))
    expect(t).toContain('Federal balance due 4,220')
    expect(t).toContain('California balance due')
    expect(t).not.toMatch(/you owe|refund to you/)
  })

  it('the adjust preview strikes the value it replaces and shows the effect', () => {
    const html = render({ type: 'adjust', target: 'F1040.19', prefill: { to: 0 } })
    expect(html).toMatch(/<s[^>]*>400<\/s>/)
    expect(html).toContain('+400')
  })

  it('reviewers are steered to a review note; a partner may sign at reviewer level', () => {
    expect(render({ type: 'adjust', target: 'F1040.19' }, workspace('st-02'))).toContain('Propose it as a review note')
    expect(render({ type: 'note', target: 'F1040.19' }, workspace('st-02'))).toContain('Blocking: approval and filing wait')
    expect(render({ type: 'signoff', target: 'return' }, workspace('st-03'))).toContain('>Level</label>')
  })

  it('sign-off states its scope with the same count the server fingerprints', () => {
    expect(render({ type: 'signoff', target: 'business' })).toContain(`>${scopeOf(model, 'area:business').length.toLocaleString('en-US')}<`)
  })

  // canOpen opens a verify or sign-off at the first level the role may use, so a reviewer who prepared the line lands on
  // preparer. Level then says which level was refused and why, or the form reads as the person's own review.
  it("a form opened below the viewer's own level says why that level is refused", () => {
    const hint = 'Reviewer level is not open to you: You prepared Sch3.10'
    expect(render({ type: 'verify', target: 'Sch3.10', prefill: { level: 'preparer' } }, real('st-02'))).toContain(hint)
    // Sign-off shares the field: payments_and_filing holds the same line st-02 prepared.
    expect(render({ type: 'signoff', target: 'payments_and_filing', prefill: { level: 'preparer' } }, real('st-02'))).toContain(hint)
    // st-02 may verify F1040.19 at reviewer, so a preparer-level form there has nothing to explain.
    expect(render({ type: 'verify', target: 'F1040.19', prefill: { level: 'preparer' } }, real('st-02'))).not.toContain('level is not open to you')
  })

  // The footer already prints the refusal for the level the form is on (the dialog's own rule: a reason is said once), so
  // the field speaks only for a level the form is not on, and only a role with a level above this one has such a level.
  it('the level hint is for the level the form is not on', () => {
    const verify = (level: string) => plain(render({ type: 'verify', target: 'Sch3.10', prefill: { level } }, real('st-02')))
    expect(verify('preparer')).toContain('Reviewer level is not open to you: You prepared Sch3.10')
    const atRefused = verify('reviewer')
    expect(atRefused).not.toContain('level is not open to you')
    expect(atRefused.split('You prepared Sch3.10').length - 1, 'the footer says it once').toBe(1)
    const preparer = plain(render({ type: 'verify', target: 'Sch3.10' }, real('st-01')))
    expect(preparer).toContain('Level: preparer (from your role)')
    expect(preparer).not.toContain('level is not open to you')
  })

  it('the level hint masks a token in the reason, as the footer does', () => {
    const reason = `Confirm ${makeToken('ssn', '3309', 'synthetic0')} before you sign.`
    const ws = workspace('st-02', (i) => (i.type === 'verify' && i.body.level === 'reviewer' ? { ok: false, reason } : { ok: true }))
    const t = plain(render({ type: 'verify', target: 'Sch3.10', prefill: { level: 'preparer' } }, ws))
    expect(t).toContain(`Reviewer level is not open to you: Confirm ${displayMasked({ kind: 'ssn', last4: '3309' })} before you sign.`)
    expect(t).not.toContain('«')
  })

  // A verify attests the value, not the findings on it, so the form names an open high finding it leaves open (the v key
  // opens it straight from the queue, where CHK-23 says Sch1.17 is wrong).
  it('a verify names the open high findings it does not resolve', () => {
    const html = render({ type: 'verify', target: 'Sch1.17' }, real('st-02'))
    expect(html).toContain('Open high finding: Self-employed health insurance of 14,400')
    expect(html).toContain('Verifying does not resolve it')
    // The letter is the support chip's; a screen reader hears the method's name alone ("Agreed to…", not "DAgreed to…").
    expect(html).toMatch(/<span\b[^>]*\saria-hidden="true"[^>]*>D<\/span>/)
    // A lot with two: the first is named and the other counted. One the form addresses is not repeated as left open.
    const [blank, basis] = [model.findingsById['chk:CHK-02:ev-0498'], model.findingsById['chk:CHK-06:F8949.B.N1']]
    expect(plain(render({ type: 'verify', target: 'F8949.B.N1' }, real('st-02'))))
      .toContain(`Open high finding: ${blank.title} (+1 more). Verifying does not resolve it.`)
    expect(plain(render({ type: 'verify', target: 'F8949.B.N1', findings: [blank.id] }, real('st-02'))))
      .toContain(`Open high finding: ${basis.title}. Verifying does not resolve it.`)
  })

  // Only a high finding is named: F1040.1a has an open finding too, a warning (CHK-26), and its Verify says nothing of it.
  it('a verify names no finding when none of those open on the claim is high', () => {
    const ws = real('st-02')
    const open = (ws.state.claims['F1040.1a']?.openFindings ?? []).map((id) => model.findingsById[id]?.severity)
    expect(open.length, 'F1040.1a has an open finding').toBeGreaterThan(0)
    expect(open, 'none of them high').not.toContain('high')
    expect(render({ type: 'verify', target: 'F1040.1a' }, ws)).not.toContain('Open high finding')
  })

  // Rule 5: an attesting field starts unanswered, and what the form filled in says so. The keyboard path is the browser check's.
  it('a verify opens with no method chosen and says when it filled in the evidence', () => {
    const html = render({ type: 'verify', target: 'F1040.19' })
    expect(html).toContain('role="radio"')
    expect(html).not.toContain('aria-checked="true"')
    // F1040.19 rests on no source ref, so its evidence opens empty; Sch1.17's opens with its source, ev-0484.
    expect(html).toContain('>Evidence</label>')
    expect(render({ type: 'verify', target: 'Sch1.17' })).toContain('>Evidence (pre-filled; keep only refs you checked)</label>')
    // A Save with no method chosen says why under the radios.
    expect(plain(renderAttempted({ type: 'verify', target: 'F1040.19' }))).toContain('Choose how you checked it')
  })

  // An untouched Verify fails on its method alone (draft.test.ts), and ActForm.submit then focuses the first
  // [aria-invalid="true"] in the form: the radios carry it and name the error, or focus stays on Save and nothing is heard.
  it('a Save with no method marks the radios invalid, each described by the error, the first of them taking focus', () => {
    const RADIO = /<span\b[^>]*\srole="radio"[^>]*>/g
    const html = renderAttempted({ type: 'verify', target: 'F1040.19' })
    const radios = html.match(RADIO) ?? []
    expect(radios.length, 'the method radios').toBeGreaterThan(0)
    for (const tag of radios) {
      expect(tag).toContain('aria-invalid="true"')
      const line = describedLine(html, tag)
      expect(line, `${tag} should name the error line`).toBeDefined()
      expect(line?.text).toBe('Choose how you checked it')
    }
    // querySelector takes the first match: a radio (role="radio"), not the hidden input Base UI renders beside each.
    const at = html.indexOf('aria-invalid="true"')
    expect(html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)).toMatch(/^<span\b[^>]*\srole="radio"/)
    // Before a Save nothing is flagged.
    const before = render({ type: 'verify', target: 'F1040.19' }).match(RADIO) ?? []
    expect(before.length).toBe(radios.length)
    for (const tag of before) expect(tag).not.toContain('aria-invalid="true"')
  })

  // The v key opens a Verify with focus in the radio group, so the caution is the group's description: heard on the way in.
  it('an open high finding the verify leaves open describes the radio group', () => {
    const GROUP = /<div\b[^>]*\srole="radiogroup"[^>]*>/
    for (const target of ['Sch1.17', 'F8949.B.N1']) {
      const html = render({ type: 'verify', target }, real('st-02'))
      const tag = GROUP.exec(html)?.[0] ?? ''
      const line = describedLine(html, tag)
      expect(line, `${target}: ${tag} should name the caution`).toBeDefined()
      expect(line?.open, target).toMatch(/^<p\b/)
      expect(line?.text, target).toContain('Open high finding')
    }
    // No open high finding, nothing to describe the group with (F1040.1a's one open finding is a warning).
    const tag = GROUP.exec(render({ type: 'verify', target: 'F1040.1a' }, real('st-02')))?.[0] ?? ''
    expect(tag).toMatch(/\srole="radiogroup"/)
    expect(tag).not.toMatch(/\saria-describedby="[^"]*"/)
  })

  // A screen reader hears a field's line with the field. The error takes the hint's place after a Save, which a server
  // render never reaches (the error path and the focus move are the browser check's).
  it("a field's hint describes its control", () => {
    const html = render({ type: 'adjust', target: 'F1040.19' })
    const tag = /<input[^>]*font-mono[^>]*>/.exec(html)?.[0] ?? ''
    const id = /\saria-describedby="([^"]+)"/.exec(tag)?.[1]
    expect(id, tag).toBeTruthy()
    const at = html.indexOf(` id="${id}"`)
    expect(at, `an element with id ${id}`).toBeGreaterThan(-1)
    const el = html.slice(html.lastIndexOf('<', at))
    // The named element is the hint line, not the control: an input that names its own id would find itself, and the slice
    // below would run on from it into the line that follows.
    expect(el.slice(0, 60), `${id} should name the hint line`).toMatch(/^<p\b/)
    expect(plain(el.slice(0, el.indexOf('</')))).toContain('Refs separated by commas')
    // A field with neither hint nor error describes nothing (Reason). In every form each reference resolves, and each
    // field line shown is named by its control: a line no control names is one a screen reader never hears.
    expect(html).not.toMatch(/<textarea[^>]*\saria-describedby=/)
    for (const [req, , ws] of CASES) {
      const page = render(req, ws)
      const described = [...page.matchAll(/\saria-describedby="([^"]+)"/g)].flatMap((m) => m[1].split(' '))
      for (const ref of described) expect(page, `${req.type} ${req.target}: ${ref}`).toContain(` id="${ref}"`)
      for (const [, msg] of page.matchAll(/\sid="([^"]+-msg)"/g)) expect(described, `${req.type} ${req.target}: ${msg} is shown but no control names it`).toContain(msg)
    }
  })

  // ActForm.submit moves focus to the first [aria-invalid="true"] control after a failed Save, so a control whose error can
  // show has to carry it. The browser check proves the focus move itself; renderAttempted opens the form as that Save leaves it.
  it("the clock's Move to is marked invalid once its error shows", () => {
    const input = (html: string) => /<input[^>]*font-mono[^>]*>/.exec(html)?.[0] ?? ''
    const ERROR_LINE = /<p id="[^"]+-msg" class="text-xs text-destructive">/
    // formErrors rejects a time Date.parse cannot read; the schema rejects one it can read that runs past 30 characters.
    for (const to of ['soon', 'Mon Jan 04 2027 09:00:00 GMT+0000 (Coordinated Universal Time)']) {
      const html = renderAttempted({ type: 'clock', target: 'season', prefill: { to } })
      expect(html, `${to}: the error is shown`).toMatch(ERROR_LINE)
      expect(input(html), `${to}: the input is flagged`).toContain('aria-invalid="true"')
    }
    // Nothing to flag: the form before a Save, and a Save of the time as the form opened it.
    for (const html of [render({ type: 'clock', target: 'season' }), renderAttempted({ type: 'clock', target: 'season' })]) {
      expect(html).not.toMatch(ERROR_LINE)
      expect(input(html)).not.toContain('aria-invalid="true"')
    }
  })

  // Under 16 px, iOS zooms the page when an input takes focus: a ref input keeps Input's own text-base md:text-sm.
  it('ref inputs keep the 16 px base below md', () => {
    const refs: OpenActRequest[] = [{ type: 'adjust', target: 'F1040.19' }, { type: 'dispose', target: 'D12' }, { type: 'clock', target: 'season' }]
    for (const req of refs) {
      const tag = /<input[^>]*font-mono[^>]*>/.exec(render(req))?.[0] ?? ''
      const classes = /\sclass="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []
      expect(classes, `${req.type}: ${tag}`).toContain('text-base')
      expect(classes, `${req.type}: ${tag}`).not.toContain('text-xs')
    }
  })

  const button = (ws: Workspace) => renderToString(h(WorkspaceContext, { value: ws }, h(ActButton, { type: 'verify', target: 'Sch3.10' }, 'Verify')))
  /** The opening tag of the Verify button: a tokened reason brings a Reveal button of its own into the same markup. */
  const VERIFY = /<button\b[^>]*>(?=Verify<\/button>)/

  it('buttons: disabled with the reason only when every level the role has is refused', () => {
    const reviewerOnly: Workspace['can'] = (i) => (i.type === 'verify' && i.body.level === 'reviewer' ? { ok: false, reason: 'You prepared Sch3.10' } : { ok: true })
    const allowed = button(workspace('st-02', reviewerOnly))
    expect(allowed).not.toMatch(DISABLED)
    expect(allowed).toMatch(/^<button\b[^>]*>Verify<\/button>$/) // allowed: the bare button, as before
    expect(button(workspace('st-02', () => ({ ok: false, reason: 'Frozen' })))).toMatch(DISABLED)
    const finding: Finding = { id: 'chk:x', check: 'CHK-01', family: 'printed_vs_extracted', title: 't', why: 'w', severity: 'high', signal: 'computed', claims: [], evidence: [], knownSince: '' }
    expect(renderToString(h(WorkspaceContext, { value: workspace('st-01') }, h(FindingFixButton, { finding })))).toContain('Resolve…')
  })

  // A title reaches no keyboard, screen reader or phone: a refused button stays focusable and the reason is text beside it.
  it('a refused button stays in the Tab order, described by its reason in words (no title)', () => {
    const html = button(workspace('st-02', () => ({ ok: false, reason: 'Frozen' })))
    const tag = VERIFY.exec(html)?.[0] ?? ''
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).not.toMatch(/\sdisabled=""/)
    // Without the native disabled, the base class's disabled:pointer-events-none no longer applies: the refused button gets it
    // from data-disabled, so it neither highlights on hover nor nudges on press while it does nothing.
    expect(tag).toContain('data-disabled:pointer-events-none')
    expect(tag).toContain('data-disabled:opacity-50')
    const id = /\saria-describedby="([^"]+)"/.exec(tag)?.[1]
    expect(id, tag).toBeTruthy()
    const at = html.indexOf(` id="${id}"`)
    expect(at, `an element with id ${id}`).toBeGreaterThan(-1)
    const line = html.slice(html.lastIndexOf('<', at))
    expect(line.slice(0, line.indexOf('>'))).toContain(' data-refusal="true"') // an authorize() refusal, quoted verbatim
    expect(plain(line).trim()).toBe('Frozen')
    expect(html).not.toContain('title="Frozen"')
    expect(html).not.toMatch(/<span\b[^>]*\stitle="[^"]*"[^>]*><button\b/)
    // The reason is masked: gateText can quote a note that holds a token.
    const token = makeToken('ssn', '3309', 'synthetic0')
    const masked = button(workspace('st-02', () => ({ ok: false, reason: `Open blocking review notes: confirm ${token}.` })))
    expect(plain(masked)).toContain('Open blocking review notes: confirm')
    expect(plain(masked)).toContain(displayMasked({ kind: 'ssn', last4: '3309' }))
    expect(masked).not.toContain('«')
  })

  it('a refused button given a reasonId points at the line its caller prints and prints none of its own', () => {
    const ws = workspace('st-02', () => ({ ok: false, reason: 'Frozen' }))
    const html = renderToString(h(WorkspaceContext, { value: ws }, h(ActButton, { type: 'verify', target: 'Sch3.10', reasonId: 'toolbar-reason' }, 'Verify')))
    expect(html).toMatch(/^<button\b[^>]*>Verify<\/button>$/)
    expect(html).toContain('aria-describedby="toolbar-reason"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toMatch(/\sdisabled=""/)
  })
})

// Regression (review must-fix 1 and 3): buttons and forms judged by the real authorize(), not a stub that says yes.
describe('with the real authorize()', () => {
  const html = (ws: Workspace, el: ReturnType<typeof h>) => renderToString(h(WorkspaceContext, { value: ws }, el))
  const disabled = (s: string) => DISABLED.test(s)
  const state0 = project(model, [], viewerOf(packet, 'st-01'))
  it('an adjust button is enabled before a new value is typed', () => {
    for (const id of ['st-01', 'st-02', 'st-03']) {
      expect(disabled(html(real(id), h(ActButton, { type: 'adjust', target: 'F1040.19' }, 'Adjust')))).toBe(false)
    }
    expect(disabled(html(real('st-01'), h(ActButton, { type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis' } }, 'Adjust')))).toBe(false)
  })

  it('refusals that typing cannot fix still disable the button, with the reason', () => {
    const s = html(real('st-05'), h(ActButton, { type: 'adjust', target: 'F1040.19' }, 'Adjust'))
    expect(disabled(s)).toBe(true)
    expect(plain(s)).toContain('firm administrator')
  })

  it('a dispose fix that needs a ref is enabled even when the check names no ref', () => {
    // authorize() checks body.findings are real and visible, so take a real finding on a document and strip its ref.
    const onDoc = model.findings.find((f) => state0.findings[f.id]?.visible && model.claims[f.claims[0]]?.kind === 'doc')!
    const fix = { act: 'dispose' as const, target: onDoc.claims[0], disposition: 'duplicate_of', label: 'Mark as a duplicate' }
    expect(disabled(html(real('st-01'), h(FindingFixButton, { finding: { ...onDoc, claims: [onDoc.claims[0]], evidence: [], fix } })))).toBe(false)
    // The finding the first review named (review defect 1: no silent pass when it is missing).
    const named = model.findingsById['chk:CHK-18:D10']
    expect(named?.fix?.act).toBe('dispose')
    expect(disabled(html(real('st-01'), h(FindingFixButton, { finding: named })))).toBe(false)
  })

  it('an adjust button pre-filled with a what-if is enabled before the amount is typed (review defect 2)', () => {
    const alts = packet.what_if.alternatives.filter((a) => a.changed_lines.some((c) => model.lines[c.key]))
    expect(alts.length).toBe(4)
    for (const a of alts) {
      const target = a.changed_lines.find((c) => model.lines[c.key])!.key
      const req: OpenActRequest = { type: 'adjust', target, prefill: { what_if: a.id } }
      expect(disabled(html(real('st-01'), h(ActButton, req, 'Adjust')))).toBe(false)
      expect(render(req, real('st-01'))).toContain('type="submit"')
    }
  })

  it('a finding without a fix opens an enabled Resolve…', () => {
    const open = Object.values(state0.findings).find((f) => f.visible && f.status === 'open' && !model.findingsById[f.id].fix)
    expect(open).toBeDefined()
    const s = html(real('st-01'), h(FindingFixButton, { finding: model.findingsById[open!.id] }))
    expect(s).toContain('Resolve…')
    expect(disabled(s)).toBe(false)
  })

  it('an empty form keeps its submit button, so its field errors can show', () => {
    expect(render({ type: 'adjust', target: 'F1040.19' }, real('st-01'))).toContain('type="submit"')
    expect(render({ type: 'adjust', target: 'F8949.B.N1', prefill: { field: 'basis' } }, real('st-01'))).toContain('type="submit"')
    expect(render({ type: 'dispose', target: 'D12', prefill: { disposition: 'duplicate_of' } }, real('st-01'))).toContain('type="submit"')
  })
})

// Rule 6 and 7: a dialog names what it acts on in words. The description is the line a screen reader gives on opening, so these
// read that element alone: "Business (Sch C)" is also in the sign-off body and a finding's title in its "Addresses" list, so a
// match anywhere in the dialog proves nothing about the header.
describe('the act dialog describes its subject in words', () => {
  /** The inside of the dialog's description element (data-slot="dialog-description"), or undefined when the dialog has none. */
  const descriptionHtml = (html: string): string | undefined => /<(\w+)\b[^>]*\sdata-slot="dialog-description"[^>]*>([\s\S]*?)<\/\1>/.exec(html)?.[2]
  /** What a reader gets from it. */
  const description = (html: string): string | undefined => {
    const inner = descriptionHtml(html)
    return inner === undefined ? undefined : plain(inner).trim()
  }

  /** cu-01 after st-01 has asked a question on D73; the target is the log's own seq, as the portal's Answer button passes it. */
  function asked(text = 'Is D28 the final statement?'): { ws: Workspace; target: string } {
    const acts = actsOf(model, [['st-01', { type: 'note', target: 'D73', body: { kind: 'question_client', to: 'cu-01', text, blocking: false } }]])
    const w = workspace('cu-01')
    return { ws: { ...w, state: project(model, acts, w.viewer) }, target: `act:${acts[0].seq}` }
  }
  /** `viewerId` (cu-01: the portal's Approve button) after st-03 has sent the return for approval; the target is that request's seq. */
  function requested(viewerId = 'cu-01'): { ws: Workspace; target: string } {
    const acts = actsOf(model, [['st-03', { type: 'request_approval', target: 'return', body: {} }]])
    const w = workspace(viewerId)
    return { ws: { ...w, state: project(model, acts, w.viewer) }, target: `act:${acts[0].seq}` }
  }

  // expect.soft: the three subjects fail on their own, so a red run names each of them.
  it('describes the subject in words: the note answered, the finding resolved, the area signed', () => {
    const { ws, target } = asked()
    const reply = render({ type: 'reply', target }, ws)
    expect.soft(description(reply), 'reply').toBe('Priya Raman: Is D28 the final statement?')
    expect.soft(reply, 'reply').not.toContain(`>${target}<`)

    // An area may be passed by its bare key; normalizeRequest opens the form on area:business.
    const signoff = render({ type: 'signoff', target: 'business' })
    expect.soft(description(signoff), 'sign off').toBe('Business (Sch C)')
    expect.soft(signoff, 'sign off').not.toContain('>area:business<')

    const finding = model.findingsById['chk:CHK-02:ev-0498']
    const resolve = render({ type: 'resolve', target: finding.id })
    expect.soft(description(resolve), 'resolve').toBe(finding.title)
    expect.soft(resolve, 'resolve').not.toContain(`>${finding.id}<`)
  })

  it('the signing dialog is described by who asked for the approval, not by the request act', () => {
    const { ws, target } = requested()
    const html = render({ type: 'client_approve', target }, ws)
    expect(description(html)).toBe('Approval requested by Helen Strand')
    expect(html).not.toContain(`>${target}<`)
  })

  // The client's other opener on the same question (Upload a document) is described by it too.
  it('an upload on a question is described by the question', () => {
    const { ws, target } = asked()
    expect(description(render({ type: 'attach', target }, ws))).toBe('Priya Raman: Is D28 the final statement?')
  })

  it('a claim keeps its ref beside its label for staff, and a client reads the label alone', () => {
    const label = model.claims.D11.label
    const req: OpenActRequest = { type: 'attach', target: 'D11' }
    const staff = descriptionHtml(render(req)) ?? ''
    expect(staff).toContain('<span class="font-mono text-xs">D11</span>')
    expect(plain(staff).trim()).toBe(`D11 · ${label}`)
    const client = descriptionHtml(render(req, workspace('cu-01'))) ?? ''
    expect(plain(client).trim()).toBe(label)
    expect(client).not.toContain('<span')
  })

  // A description is text read aloud with the dialog: a token shows as dots, with no Reveal button inside the line.
  it('masks a token in the note it names and puts no button in the description', () => {
    const { ws, target } = asked(`Is ${makeToken('ssn', '3309', 'synthetic0')} still the number on the return?`)
    const html = render({ type: 'reply', target }, ws)
    expect(description(html)).toBe(`Priya Raman: Is ${displayMasked({ kind: 'ssn', last4: '3309' })} still the number on the return?`)
    expect(html).not.toContain('«')
    expect(descriptionHtml(html) ?? '').not.toContain('<button')
  })

  // Long text is the stylesheet's to clip (line-clamp): the element keeps all of it, so a screen reader reads the whole question.
  it('keeps the whole of a long note in the description', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Is D${28 + (i % 3)} the final statement?`).join(' ')
    expect(text.length, 'long enough to run to many lines').toBeGreaterThan(1000)
    const { ws, target } = asked(text)
    expect(description(render({ type: 'reply', target }, ws))).toBe(`Priya Raman: ${text}`)
  })

  // The season clock has nothing to name: its body says where the clock stands, so the dialog carries no description at all.
  it('has no description when the target names nothing (the season clock)', () => {
    const html = render({ type: 'clock', target: 'season' })
    expect(html).not.toContain('data-slot="dialog-description"')
    expect(html).toContain('Season clock is at')
  })

  // Node's counterpart of the browser check "no dialog description matches (act|area|chk):".
  it('puts a word for every target an act is opened on, never its key', () => {
    const { ws: asking, target: question } = asked()
    const { ws: signing, target: approval } = requested()
    const { ws: reverting, target: sent } = requested('st-03')
    const unheld = reverting.state.acts.length + 1
    const asStaff = workspace('st-03')
    const rows: [OpenActRequest, Workspace, string][] = [
      [{ type: 'reply', target: question }, asking, 'Priya Raman: Is D28 the final statement?'],
      [{ type: 'client_approve', target: approval }, signing, 'Approval requested by Helen Strand'],
      [{ type: 'resolve', target: 'chk:CHK-02:ev-0498' }, asStaff, model.findingsById['chk:CHK-02:ev-0498'].title],
      [{ type: 'signoff', target: 'area:business' }, asStaff, 'Business (Sch C)'],
      [{ type: 'assign', target: 'area:business' }, asStaff, 'Business (Sch C)'],
      [{ type: 'time', target: 'area:business' }, asStaff, 'Business (Sch C)'],
      [{ type: 'signoff', target: 'return' }, asStaff, 'the return'],
      [{ type: 'request_approval', target: 'return' }, asStaff, 'the return'],
      [{ type: 'file', target: 'return' }, asStaff, 'the return'],
      [{ type: 'amend_open', target: 'return' }, asStaff, 'the return'],
      // An act is named by what it did and who did it; a group of acts and an act the log does not hold, by targetText's words.
      [{ type: 'revert', target: sent }, reverting, 'Approval requested by Helen Strand'],
      [{ type: 'revert', target: 'batch:b1' }, reverting, 'a group of changes'],
      [{ type: 'revert', target: `act:${unheld}` }, reverting, `change ${unheld}`],
    ]
    for (const [req, ws, want] of rows) {
      const got = description(render(req, ws)) ?? ''
      expect.soft(got, `${req.type} ${req.target}`).toBe(want)
      expect.soft(got, `${req.type} ${req.target}`).not.toMatch(/\b(act|area|chk|batch):/)
    }
  })
})

// A review note reopens a sign-off with no value moved, so the Re-sign dialog says what was recorded since, not only a count.
describe('the sign-off dialog on a reopened sign-off', () => {
  it('says what was recorded on the changed claims after the sign-off', () => {
    const acts = actsOf(model, [
      ['st-01', { type: 'signoff', target: 'area:business', body: { level: 'preparer' } }],
      ['st-02', { type: 'note', target: 'SchC.1', body: { kind: 'review_note', text: 'Tie gross receipts to the 1099-K first.', blocking: true } }],
    ])
    const t = plain(render({ type: 'signoff', target: 'business' }, { ...workspace('st-01'), state: project(model, acts, viewerOf(packet, 'st-01')) }))
    expect(t).toContain('reopened (1 changed; since then: Note added by Daniel Ortiz)')
    expect(t).toContain('preparer by Priya Raman: reopened (1 changed; since then: Note added by Daniel Ortiz)')
  })
})

// What a Save sets, seeded for one render (renderSeeded): the post in flight, and the server's refusal of it.
describe('the act form during and after a Save', () => {
  const verify: OpenActRequest = { type: 'verify', target: 'F1040.19' }
  const allows = workspace('st-01', () => ({ ok: true }))
  /** The opening tag of the submit button. */
  const submitTag = (html: string) => /<button type="submit"[^>]*>/.exec(html)?.[0] ?? ''

  // Rule 2: a submit natively disabled while it saves drops focus to the page body.
  it('keeps the submit focusable but inert while the Save is in flight', () => {
    const busy = renderSeeded(verify, allows, { busy: true })
    const tag = submitTag(busy)
    expect(tag, 'the submit while it saves').toContain('aria-disabled="true"')
    expect(tag).toContain(' data-disabled=""')
    expect(tag).not.toMatch(/\sdisabled=""/)
    expect(plain(busy)).toContain('Saving…')
    // Before a Save it is neither.
    const idle = submitTag(render(verify, allows))
    expect(idle, 'the submit before a Save').toMatch(/^<button type="submit"/)
    expect(idle).not.toContain('aria-disabled="true"')
    expect(idle).not.toContain(' data-disabled=""')
  })

  // A refused Save prints the server's reason inline. Once the log pull makes the form's own check refuse with it too, the
  // footer says it in the submit's place, and the inline line goes: a reason is said once.
  it("says the server's refusal once: inline while the form's own check allows, in the footer once that refuses too", () => {
    const reason = 'F1040.19 changed to 500 since you saw 400. Check the new value, then verify it.'
    const count = (html: string) => html.split(reason).length - 1
    /** The text of the first <p> with this role, or undefined when there is none. */
    const line = (html: string, role: string) => {
      const m = new RegExp(`<p role="${role}"[^>]*>([\\s\\S]*?)</p>`).exec(html)
      return m ? plain(m[1]).trim() : undefined
    }
    const allowed = renderSeeded(verify, allows, { serverError: reason }).replaceAll('<!-- -->', '')
    expect(count(allowed), 'said once, inline').toBe(1)
    expect(line(allowed, 'alert')).toBe(reason)
    const refused = renderSeeded(verify, workspace('st-01', () => ({ ok: false, reason })), { serverError: reason }).replaceAll('<!-- -->', '')
    expect(count(refused), 'said once, in the footer').toBe(1)
    expect(line(refused, 'status')).toBe(reason)
    expect(refused).not.toContain('<p role="alert"')
  })
})
