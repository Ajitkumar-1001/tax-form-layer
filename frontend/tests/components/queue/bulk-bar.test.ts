// The queue's bulk bar, server-rendered with no DOM (no clicks, no typing): what a refused Accept and a Dispose waiting for
// its reason say in words (UX standing rule 2: the reason is visible text tied by aria-describedby, never only a title).
// Typing three characters (the Dispose line goes, the button enables) and Tab reaching both buttons are browser checks.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BulkBar } from '@/components/queue/bulk-bar'

// A server render never types, so the reason field stays empty in one. A render that needs a reason seeds it, the way
// act-form.test.ts seeds `attempted`: the reason is the bar's one state that starts '', and every other state is React's own.
const seed = vi.hoisted(() => ({ reason: null as string | null }))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: (init: unknown) => (seed.reason !== null && init === '' ? [seed.reason, () => {}] : react.useState(init)),
  }
})

const ACCEPT_REFUSED = 'Accepting a tied check is a reviewer or partner act.'
const DISPOSE_RULE = 'Write a reason of at least 3 characters'
const REASON = 'Matches the broker statement'

// React's text separators (<!-- -->) out, so a sentence is one run of text. `reason` is what the reason field holds as typed.
function render(acceptReason: string | null, busy = false, reason?: string): string {
  seed.reason = reason ?? null
  try {
    return renderToString(h(BulkBar, { count: 2, busy, acceptReason, onDispose: async () => true, onAccept() {}, onClear() {} })).replaceAll('<!-- -->', '')
  } finally {
    seed.reason = null
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// An opening tag whose attributes may hold ">" inside quotes (Tailwind classes do), for the button whose whole text is `label`.
const ATTRS = '(?:\\s+[\\w:-]+(?:="[^"]*")?)*'
function buttonTag(html: string, label: string): string {
  const tag = new RegExp(`<button${ATTRS}\\s*>(?=${label}</button>)`).exec(html)?.[0]
  if (!tag) throw new Error(`no <button> reading "${label}" in ${html}`)
  return tag
}

/** What a keyboard or screen-reader user gets from a button: is it left out of the Tab order, and what does it say. */
function stance(html: string, tag: string) {
  const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1]
  return {
    nativelyDisabled: /\sdisabled=""/.test(tag), // data-disabled="" is Base UI's styling hook, not the attribute
    ariaDisabled: /aria-disabled="([^"]*)"/.exec(tag)?.[1],
    describedBy: id === undefined ? undefined : new RegExp(`id="${esc(id)}"[^>]*>([^<]*)<`).exec(html)?.[1],
  }
}

describe('BulkBar', () => {
  it('refused bulk buttons are described by their reasons in words', () => {
    const html = render(ACCEPT_REFUSED)
    const accept = buttonTag(html, 'Accept')
    const dispose = buttonTag(html, 'Dispose')
    // Both stay in the Tab order (aria-disabled, never the disabled attribute) and name their reason in text.
    expect({ accept: stance(html, accept), dispose: stance(html, dispose) }).toEqual({
      accept: { nativelyDisabled: false, ariaDisabled: 'true', describedBy: ACCEPT_REFUSED },
      dispose: { nativelyDisabled: false, ariaDisabled: 'true', describedBy: DISPOSE_RULE },
    })
    // Without disabled="" the buttons lose Tailwind's disabled: styles, so the refused look comes from data-disabled: faded,
    // and no hover fill or press nudge on a button that does nothing.
    expect(accept).toContain('data-disabled:opacity-50')
    expect(dispose).toContain('data-disabled:opacity-50')
    expect(accept).toContain('data-disabled:pointer-events-none')
    expect(dispose).toContain('data-disabled:pointer-events-none')
    // Each reason is printed once, as text; no title attribute carries one.
    expect(html).not.toContain('title="')
    expect(html.split(ACCEPT_REFUSED)).toHaveLength(2)
    expect(html.split(DISPOSE_RULE)).toHaveLength(2)
    // Read as plain text (tags stripped), each reason follows its own button.
    expect(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).toContain(`Dispose ${DISPOSE_RULE} Accept ${ACCEPT_REFUSED} Clear`)

    // Accept not refused (a reviewer or partner, or nothing tied to judge): no aria-disabled, no description, no sentence.
    const open = render(null)
    expect(stance(open, buttonTag(open, 'Accept'))).toEqual({ nativelyDisabled: false, ariaDisabled: undefined, describedBy: undefined })
    expect(open).not.toContain(ACCEPT_REFUSED)
    // Dispose still waits for its reason, whoever the viewer is.
    expect(stance(open, buttonTag(open, 'Dispose'))).toEqual({ nativelyDisabled: false, ariaDisabled: 'true', describedBy: DISPOSE_RULE })
  })

  // While a bulk post is in flight both buttons are disabled, and they stay where focus is: a button that turns natively
  // disabled under the press drops focus mid-post (UX standing rule 2: never natively disabled, busy or refused).
  it('a bulk post in flight keeps both buttons focusable (aria-disabled, never disabled="")', () => {
    const html = render(null, true, REASON)
    const tags = { accept: buttonTag(html, 'Accept'), dispose: buttonTag(html, 'Dispose') }
    expect({ accept: stance(html, tags.accept), dispose: stance(html, tags.dispose) }).toEqual({
      accept: { nativelyDisabled: false, ariaDisabled: 'true', describedBy: undefined },
      dispose: { nativelyDisabled: false, ariaDisabled: 'true', describedBy: undefined },
    })
    for (const tag of Object.values(tags)) expect(tag).toMatch(/\sdata-disabled=""/)
    // Idle, with a reason long enough and nothing refused: neither is disabled in either form.
    const idle = render(null, false, REASON)
    for (const label of ['Accept', 'Dispose']) {
      expect(stance(idle, buttonTag(idle, label)), label).toEqual({ nativelyDisabled: false, ariaDisabled: undefined, describedBy: undefined })
    }
  })
})
