// /firm (firm/firm-page.tsx): Assign shows only to roles that may assign (the Assignments hint says who), and a refusal
// shared by the Log time buttons prints once under the time table, every refused button described by it. Server render
// against the masked model the browser uses, with the real authorize() (as replay-safe.test.ts); no jsdom.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readPacket } from '../records/fixture'
import { FirmPage } from '@/components/firm/firm-page'
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

const page = (viewerId: string) => renderToString(h(WorkspaceContext, { value: ws(viewerId) }, h(FirmPage)))

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

/** An Assign button; its area may follow as sr-only text. */
const ASSIGN = /<button\b[^>]*>Assign</g
const SAM = /Sam Adeyemi is active from 2027-01-04\./g
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0

describe('FirmPage', () => {
  it('Assign hides for roles that may not assign; a shared Log time refusal prints once', () => {
    // Priya Raman (st-01) is a preparer and Sam Adeyemi (st-06) is not active until 2027-01-04: neither may assign. Jo
    // Kimura (st-05), the firm administrator, may, in each of the nine areas.
    const sam = page('st-06')
    expect({ 'st-01': count(page('st-01'), ASSIGN), 'st-05': count(page('st-05'), ASSIGN), 'st-06': count(sam, ASSIGN), sentences: count(sam, SAM) })
      .toEqual({ 'st-01': 0, 'st-05': 9, 'st-06': 0, sentences: 1 })

    // Sam's nine Log time buttons are refused for the same reason: each stays in the Tab order, described by the one line.
    const logTime = [...sam.matchAll(/<button\b[^>]*>(?=Log time)/g)].map((m) => m[0])
    expect(logTime).toHaveLength(9)
    for (const tag of logTime) {
      expect(tag).toContain('aria-disabled="true"')
      expect(tag).not.toMatch(/\sdisabled=""/)
    }
    const ids = [...new Set(logTime.map((tag) => /\saria-describedby="([^"]+)"/.exec(tag)?.[1]))]
    expect(ids).toHaveLength(1)
    expect(ids[0]).toBeTruthy()
    expect(textById(sam, ids[0]!)).toBe('Sam Adeyemi is active from 2027-01-04.')
  })
})
