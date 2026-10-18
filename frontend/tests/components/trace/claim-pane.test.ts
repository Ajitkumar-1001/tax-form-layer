// Focus returns on the trace pane (act-host.tsx, returnFocusTo): each of these containers outlives the control that opens
// an act from it, so the dialog hands focus back to it once the opener is gone. Then a claim's open notes, shown on the
// claim with Reply and Resolve (trace/views.tsx, NoteThread). Server render of ClaimPane on the masked packet, as
// claim-drawer.test.ts does for the drawer body; no navigation, so no next/navigation mock.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { actsOf, readPacket } from '../records/fixture'
import { refHref } from '@/components/atoms/format'
import { ClaimPane } from '@/components/trace/claim-pane'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { ActInput } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

const masked = maskPacket(readPacket()).masked
const model = buildModel(masked)
const viewer = viewerOf(masked, 'st-01')
const people = identities(masked)

function wsOf(acts: ReturnType<typeof actsOf>, v = viewer): Workspace {
  const state = project(model, acts, v)
  return {
    model, state, viewer: v, identities: people, engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, v),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const render = (refId: string, w: Workspace, compact = false) => renderToString(h(WorkspaceContext, { value: w }, h(ClaimPane, { claimRef: refId, compact })))
const openTag = (html: string, from: number) => html.slice(from, html.indexOf('>', from) + 1)
/** Tags and React's `<!-- -->` text separators removed. */
const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '')
/** The section headed by this exact h2 text, through its close (the note sections nest no section). */
function sectionOf(html: string, title: string): string {
  const heading = html.indexOf(`>${title}</h2>`)
  expect(heading, title).toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf('<section', heading), html.indexOf('</section>', heading) + '</section>'.length)
}

describe('claim pane focus returns', () => {
  // st-01 adjusts a line, then st-02 leaves a blocking note on it: the adjust is revertable, the note is open.
  const log = actsOf(model, [
    ['st-01', { type: 'adjust', target: 'F1040.1a', body: { field: 'value', to: 200, reason: 'Matches the W-2 box 1', evidence: [] } }],
    ['st-02', { type: 'note', target: 'F1040.1a', body: { kind: 'review_note', to: 'st-01', text: 'Please tie this line out', blocking: true } }],
  ])
  const [adjust, note] = log.map((a) => `act:${a.seq}`)

  it('marks finding cards, act rows and an open note as focus returns', () => {
    const marked = (tag: string) => {
      expect(tag).toContain(' data-focus-return="true"')
      expect(tag).toContain(' tabindex="-1"')
      expect(tag).toContain('focus-visible:ring-2')
    }

    // A finding card: the fix button gives way to "Resolved by" once the act lands.
    const findings = render('household:theo#ssn', wsOf([]))
    const cards = [...findings.matchAll(/<article\b/g)].map((m) => openTag(findings, m.index))
    expect(cards.length).toBeGreaterThan(0)
    for (const tag of cards) marked(tag)

    // An act row: Revert goes once the act is reverted.
    const actView = render(adjust, wsOf(log))
    const rows = [...actView.matchAll(/<li\b/g)].map((m) => m.index).filter((at) => actView.slice(at, actView.indexOf('</li>', at)).includes('Revert'))
    expect(rows).toHaveLength(1)
    marked(openTag(actView, rows[0]))

    // The open note's block: Reply and Resolve go once it is resolved.
    const noteView = render(note, wsOf(log))
    const heading = noteView.indexOf('>Open note</h2>')
    expect(heading).toBeGreaterThan(-1)
    marked(openTag(noteView, noteView.lastIndexOf('<section', heading)))
    // Opt-in: the page's other sections (Cites, Recorded) carry no marker; only the act's row and its note do.
    expect(noteView.match(/ data-focus-return="true"/g)).toHaveLength(2)
  })
})

describe('claim pane open notes', () => {
  // Daniel Ortiz (st-02, reviewer) leaves Priya Raman (st-01) a blocking review note on the lot whose basis is in doubt.
  const claim = 'F8949.B.N1'
  const blocking: [string, ActInput] = ['st-02', { type: 'note', target: claim, body: { kind: 'review_note', to: 'st-01', text: 'Basis must come from D11', blocking: true } }]
  const log = actsOf(model, [blocking])
  const note = `act:${log[0].seq}`

  it('shows an open blocking review note on the claim it blocks, with Reply and Resolve, compact and full', () => {
    for (const compact of [true, false]) {
      const html = render(claim, wsOf(log), compact)
      for (const s of ['Open notes', 'Basis must come from D11', 'Daniel Ortiz']) expect(text(html), `compact ${compact}`).toContain(s)
      expect(html).toMatch(/>Reply<span class="sr-only">/)
      expect(html).toMatch(/>Resolve<span class="sr-only">/) // the note's own, not the finding's "Resolve…"
      // Between the Actions toolbar and the findings: the byline with its chip and #seq link, the text and both acts.
      const block = sectionOf(html, 'Open notes')
      const at = html.indexOf(block)
      expect(html.indexOf('aria-label="Actions"')).toBeLessThan(at)
      expect(at).toBeLessThan(html.indexOf('>Findings</h2>'))
      for (const s of ['1 open', 'Review note by Daniel Ortiz (reviewer) to Priya Raman (preparer)', 'Blocks filing', 'Basis must come from D11']) {
        expect(text(block), `compact ${compact}`).toContain(s)
      }
      expect(block).toContain(`href="${refHref(note)}"`)
      expect(block).toMatch(/>Reply<span class="sr-only">/)
      expect(block).toMatch(/>Resolve<span class="sr-only">/)
    }
    expect(text(render(claim, wsOf([])))).not.toContain('Open notes')
  })

  // Resolve takes the note's Reply and Resolve away, and the block with its last note. The dialog then hands focus to the
  // opener's nearest marker (act-host.tsx, returnFocusTo), so that marker must outlive both: the one around notes and findings.
  it('wraps the open notes and the findings in one always-mounted focus return, and marks no note', () => {
    const resolved = actsOf(model, [blocking, ['st-02', { type: 'resolve', target: note, body: { resolution: 'addressed', text: 'Basis taken from D11' } }]])
    const cases = [['empty log', []], ['open note', log], ['resolved note', resolved]] as const
    const markers = (html: string) => html.split(' data-focus-return="true"').length - 1
    for (const compact of [true, false]) {
      const none = markers(render(claim, wsOf([]), compact))
      for (const [name, acts] of cases) {
        const html = render(claim, wsOf([...acts]), compact)
        // The block and its note add no marker: an open note leaves the pane as many as no note does.
        if (name === 'open note') expect(markers(html), name).toBe(none)
        const marker = (to: string) => html.lastIndexOf(' data-focus-return="true"', html.indexOf(to))
        const wrap = marker('>Findings</h2>')
        expect(wrap, name).toBeGreaterThan(-1)
        const tag = openTag(html, html.lastIndexOf('<', wrap))
        expect(tag, name).toMatch(/^<div\b/)
        expect(tag, name).toContain(' tabindex="-1"')
        expect(tag, name).toContain('focus-visible:ring-2')
        expect(text(html).includes('Open notes'), name).toBe(name === 'open note')
        if (name === 'open note') {
          // The wrapper encloses the block: it opens before the block's heading.
          expect(wrap, name).toBeLessThan(html.indexOf('>Open notes</h2>'))
          // closest() from Reply or Resolve reaches the wrapper: neither the block nor the note carries a marker of its own.
          for (const b of ['>Reply<span', '>Resolve<span']) expect(marker(b), b).toBe(wrap)
        }
      }
    }
  })

  // A refused act's authorize() reason prints once under the pair, and each refused button points at its line. Sam Adeyemi
  // (st-06) is not active until 2027-01-04, so both are refused for one reason; Priya may reply but not clear Daniel's note.
  it('prints a refusal of Reply or Resolve once under the pair, on the act and on the claim', () => {
    const sam = viewerOf(masked, 'st-06')
    for (const [ref, title] of [[note, 'Open note'], [claim, 'Open notes']]) {
      for (const [v, sentence, refused] of [
        [sam, 'Sam Adeyemi is active from 2027-01-04.', ['Reply', 'Resolve']],
        [viewer, 'Only Daniel Ortiz or a higher level can clear this blocking review note.', ['Resolve']],
      ] as const) {
        const block = sectionOf(render(ref, wsOf(log, v)), title)
        const where = `${v.name} on ${ref}`
        const lines = [...block.matchAll(/<\w+\b[^>]*\sdata-refusal="true"[^>]*>/g)].map((m) => /\sid="([^"]+)"/.exec(m[0])?.[1])
        expect(lines, where).toHaveLength(1)
        expect(lines[0], where).toBeTruthy()
        expect(text(block).split(sentence).length - 1, where).toBe(1)
        // The label is the word the button shows; the sr-only suffix after it names the note.
        const pair = [...block.matchAll(/<button\b[^>]*>([^<]*)<span class="sr-only">[^<]*<\/span><\/button>/g)].map((m) => ({ label: m[1], tag: m[0] }))
        expect(pair.map((b) => b.label), where).toEqual(['Reply', 'Resolve'])
        for (const b of pair) {
          const isRefused = (refused as readonly string[]).includes(b.label)
          expect(/\saria-disabled="true"/.test(b.tag), `${where}: ${b.label}`).toBe(isRefused)
          expect(/\saria-describedby="([^"]+)"/.exec(b.tag)?.[1], `${where}: ${b.label}`).toBe(isRefused ? lines[0] : undefined)
        }
      }
    }
  })

  // Rule 11: two open notes put two Reply and Resolve pairs side by side, so each button names its note in an sr-only suffix
  // after the word it shows; bare, a screen reader's list of buttons reads "Reply, Resolve, Reply, Resolve".
  it('names each Reply and Resolve after its note when a claim has two open notes', () => {
    const second: [string, ActInput] = ['st-02', { type: 'note', target: claim, body: { kind: 'review_note', to: 'st-01', text: 'Date acquired must match D11 too', blocking: false } }]
    for (const compact of [true, false]) {
      const block = sectionOf(render(claim, wsOf(actsOf(model, [blocking, second])), compact), 'Open notes')
      expect(text(block), `compact ${compact}`).toContain('2 open')
      // What the button shows (the sr-only suffix out) and what it is named (all its text), tags stripped.
      const buttons = [...block.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((m) => ({
        shown: text(m[1].replace(/<span class="sr-only">.*?<\/span>/g, '')),
        name: text(m[1]),
      }))
      expect(buttons.map((b) => b.shown), `compact ${compact}`).toEqual(['Reply', 'Resolve', 'Reply', 'Resolve'])
      const names = buttons.map((b) => b.name)
      expect(new Set(names).size, `compact ${compact}: ${names.join(' | ')}`).toBe(4)
      for (const b of buttons) expect(b.name.startsWith(`${b.shown} `), b.name).toBe(true)
    }
  })

  // One unbroken word or pasted link in a note ran out of its card and made the queue drawer scroll sideways. overflow-wrap
  // is inherited, so the class on the thread's root covers the note, its replies and its resolution.
  it("puts wrap-anywhere on the note thread's root, on the claim and on the note's own page", () => {
    const roots: [string, string | undefined][] = []
    for (const compact of [true, false]) {
      // On the claim the root opens right before the byline.
      const block = sectionOf(render(claim, wsOf(log), compact), 'Open notes')
      roots.push([`claim, compact ${compact}`, /<div class="([^"]*)"><p\b[^>]*><span>Review note/.exec(block)?.[1]])
    }
    // On the act's page there is no byline: the root opens right before the note's text.
    roots.push(['act page', /<div class="([^"]*)"><p class="text-sm">/.exec(sectionOf(render(note, wsOf(log)), 'Open note'))?.[1]])
    for (const [where, cls] of roots) {
      expect(cls, where).toBeDefined()
      expect(cls?.split(' '), where).toContain('flex-col')
      expect(cls?.split(' '), where).toContain('wrap-anywhere')
    }
  })
})
