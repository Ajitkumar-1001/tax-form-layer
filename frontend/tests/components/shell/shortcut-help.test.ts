// The shortcuts list (queue spec §5) and when "?" opens it. No jsdom here: the window listener and the dialog are
// checked in the browser; the decision is a pure predicate, checked over stub elements.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ElLike } from '@/components/shell/keys'
import { SHORTCUTS, ShortcutHelp, shouldOpenShortcuts } from '@/components/shell/shortcut-help'

type Stub = { closest: (selectors: string) => Stub | null; matches: (selectors: string) => boolean }

/** A stub element: the first entry is the element itself, then its ancestors outward, each as the simple selectors it
 *  matches. closest() and matches() take a comma-separated list, as keys.ts passes them. */
function stub(...chain: string[][]): ElLike {
  const hits = (is: string[], selectors: string) => selectors.split(',').some((s) => is.includes(s.trim()))
  const node = (i: number): Stub => ({
    closest: (selectors) => {
      const j = chain.findIndex((is, k) => k >= i && hits(is, selectors))
      return j < 0 ? null : node(j)
    },
    matches: (selectors) => hits(chain[i], selectors),
  })
  // Only closest() and matches() are read; the cast stands in for the rest of Element.
  return node(0) as unknown as ElLike
}

const page = stub(['button'], ['main'], ['body'])
const field = stub(['input'], ['header'], ['body'])
const area = stub(['textarea'], ['[role="dialog"]'], ['body'])
const editable = stub(['p'], ['[contenteditable="true"]'], ['body'])
const inDrawer = stub(['button'], ['[role="dialog"]', '[data-claim-drawer]'], ['body'])
const inMenu = stub(['div'], ['[role="menu"]'], ['body'])
const inListbox = stub(['div'], ['[role="listbox"]'], ['body'])
// The guided tour's card is a non-modal <section role="dialog"> without the dialog-content slot.
const tourCard = stub(['button'], ['section', '[role="dialog"]'], ['body'])
const listboxInDrawer = stub(['div'], ['[role="listbox"]'], ['[role="dialog"]', '[data-claim-drawer]'], ['body'])

describe('SHORTCUTS', () => {
  it('has the three sections, in order', () => {
    expect(SHORTCUTS.map((s) => s.section)).toEqual(['Everywhere', 'Queue', 'Full trace page'])
  })

  it('lists every key of spec §5 in its section', () => {
    expect(SHORTCUTS.map((s) => [s.section, s.items.flatMap((i) => i.keys)])).toEqual([
      ['Everywhere', ['⌘K', '⌘B', '?']],
      ['Queue', ['j', 'k', 'Enter', 'Shift+Enter', 'Esc', 'x', 'a', 'v', 'n', 'u', '/']],
      ['Full trace page', ['1', '2', '3']],
    ])
  })

  it('says what every item does, once per section', () => {
    for (const s of SHORTCUTS) {
      expect(s.items.every((i) => i.label.trim() !== '')).toBe(true)
      expect(new Set(s.items.map((i) => i.label)).size).toBe(s.items.length)
    }
  })

  // u opens the Revert form instead of posting (rule 13), so the list says it asks first.
  it('says that u asks first', () => {
    expect(SHORTCUTS.find((s) => s.section === 'Queue')!.items.find((i) => i.keys.includes('u'))!.label).toBe('Revert your last act (asks first)')
  })
})

describe('shouldOpenShortcuts', () => {
  it('opens from the page, and with nothing focused', () => {
    expect(shouldOpenShortcuts(page, false)).toBe(true)
    expect(shouldOpenShortcuts(null, false)).toBe(true)
  })

  it('leaves "?" to a field that is being typed in', () => {
    for (const el of [field, area, editable]) expect(shouldOpenShortcuts(el, false)).toBe(false)
  })

  it('opens from inside the claim drawer, which is not a dialog-content', () => {
    expect(shouldOpenShortcuts(inDrawer, false)).toBe(true)
  })

  it('leaves "?" to an open menu or list box and to the tour card, which own their keys', () => {
    for (const el of [inMenu, inListbox, tourCard, listboxInDrawer]) expect(shouldOpenShortcuts(el, false)).toBe(false)
  })

  it('does nothing while a dialog is open (an act form, the search, or this list)', () => {
    expect(shouldOpenShortcuts(page, true)).toBe(false)
    expect(shouldOpenShortcuts(null, true)).toBe(false)
    expect(shouldOpenShortcuts(inDrawer, true)).toBe(false)
  })
})

describe('ShortcutHelp', () => {
  const html = renderToString(h(ShortcutHelp))

  it('renders the top bar button from lg only, named with its key', () => {
    const button = html.match(/<button[^>]*aria-label="Keyboard shortcuts \(\?\)"[^>]*>/)?.[0] ?? ''
    expect(button.match(/class="([^"]*)"/)?.[1].split(' ')).toEqual(expect.arrayContaining(['hidden', 'lg:inline-flex']))
  })

  it('renders no dialog until it is opened', () => {
    expect(html).not.toContain('data-slot="dialog-content"')
    expect(html).not.toContain('Full trace page')
  })
})
