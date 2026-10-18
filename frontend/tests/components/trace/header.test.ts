// The trace toolbar (ActionBar, trace/header.tsx) prints each authorize() refusal once, under the bar, and every refused
// button stays in the Tab order, described by that line: Sam Adeyemi's seven buttons share one sentence, not seven.
// Server render against the masked model the browser uses, with the real authorize() (as replay-safe.test.ts); no jsdom.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readPacket } from '../records/fixture'
import { ActionBar, type ActionKind } from '@/components/trace/header'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

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

const bar = (viewerId: string, target: string, kind: ActionKind) =>
  renderToString(h(WorkspaceContext, { value: ws(viewerId) }, h(ActionBar, { target, kind })))

/** Tags and React's `<!-- -->` text separators removed. */
const plain = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '')

/** The element whose opening tag starts at `start`, through its matching close tag (nested tags of its own name counted). */
function elementAt(html: string, start: number): string {
  const name = /^<(\w+)/.exec(html.slice(start))?.[1]
  if (!name) throw new Error(`no tag at ${start}`)
  const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g')
  tag.lastIndex = start
  let depth = 0
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  throw new Error(`<${name}> at ${start} is never closed`)
}

/** The text of the element with this id, found literally (a useId value is no regex). */
function textById(html: string, id: string): string {
  const at = html.indexOf(` id="${id}"`)
  expect(at, `an element with id ${id}`).toBeGreaterThan(-1)
  return plain(elementAt(html, html.lastIndexOf('<', at)))
}

/** Every button: its opening tag, its label and the id its aria-describedby names (undefined without one). */
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>/g)].map((m) => ({
    tag: m[0], label: plain(elementAt(html, m.index)), describedBy: /\saria-describedby="([^"]+)"/.exec(m[0])?.[1],
  }))

/** Every refusal line (an element marked data-refusal): its id and its text. */
const lines = (html: string) =>
  [...html.matchAll(/<\w+\b[^>]*\sdata-refusal="true"[^>]*>/g)].map((m) => ({ id: /\sid="([^"]+)"/.exec(m[0])?.[1], text: plain(elementAt(html, m.index)) }))

const LINE_ACTS = ['Verify', 'Adjust', 'Decide', 'Note', 'Ask client', 'Review note', 'Attach']
const SAM = 'Sam Adeyemi is active from 2027-01-04.'
const CLEARANCE = 'Marcus Bell has no sensitive-data clearance (firm.staff st-04).'
const REVIEW_NOTE = 'Review notes come from a reviewer, partner or quality reviewer; use a memo or a question.'

describe('ActionBar', () => {
  it('ActionBar prints each refusal once and every refused button points at it', () => {
    // Sam Adeyemi (st-06) is not active until 2027-01-04, so every act on a line is refused for that one reason.
    const sam = bar('st-06', 'F8949.B.N1', 'line')
    const samButtons = buttons(sam)
    expect(samButtons.map((b) => b.label)).toEqual(LINE_ACTS)
    // The whole picture at once: seven buttons, one id they all name, one line, the sentence once.
    expect({
      describedBy: new Set(samButtons.map((b) => b.describedBy)).size,
      lines: lines(sam).length,
      sentences: sam.match(/Sam Adeyemi is active from 2027-01-04\./g)?.length ?? 0,
    }).toEqual({ describedBy: 1, lines: 1, sentences: 1 })
    for (const b of samButtons) {
      expect(b.tag, b.label).toContain('aria-disabled="true"') // refused, still in the Tab order
      expect(b.tag, b.label).not.toMatch(/\sdisabled=""/)
    }
    expect(textById(sam, samButtons[0].describedBy!)).toBe(SAM)
    expect(sam).not.toMatch(/\stitle="/)

    // Marcus Bell (st-04), a preparer without clearance, on Theo's SSN: Verify, Adjust and Decide need clearance, a review
    // note needs a reviewer, and Note, Ask client and Attach are his to use. Two reasons, each printed once.
    const marcus = bar('st-04', 'household:theo#ssn', 'fact')
    const marcusLines = lines(marcus)
    expect(marcusLines.map((l) => l.text)).toEqual([CLEARANCE, REVIEW_NOTE])
    const [clearance, reviewNote] = marcusLines.map((l) => l.id)
    expect(clearance).toBeTruthy()
    expect(reviewNote).toBeTruthy()
    expect(clearance).not.toBe(reviewNote)
    const marcusButtons = buttons(marcus)
    expect(marcusButtons.map((b) => b.label)).toEqual(LINE_ACTS)
    expect(Object.fromEntries(marcusButtons.map((b) => [b.label, b.describedBy]))).toStrictEqual({
      Verify: clearance, Adjust: clearance, Decide: clearance, 'Review note': reviewNote, Note: undefined, 'Ask client': undefined, Attach: undefined,
    })
    // Refused exactly when described: the allowed three are plain buttons.
    for (const b of marcusButtons) expect(/\saria-disabled="true"/.test(b.tag), b.label).toBe(b.describedBy !== undefined)
    expect(marcus).not.toMatch(/\stitle="/)
  })
})
