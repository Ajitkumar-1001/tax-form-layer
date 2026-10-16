// The rail toggle's state rule. No jsdom here: toggleRail, the stored choice and ⌘B are checked in the browser.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { expandedFrom, nextRail, RailToggle } from '@/components/shell/rail-toggle'

describe('expandedFrom', () => {
  it('is the default (labelled from xl) when nothing is stored', () => {
    expect(expandedFrom(undefined, true)).toBe(true)
    expect(expandedFrom(undefined, false)).toBe(false)
    expect(expandedFrom(null, true)).toBe(true)
  })

  it('follows an explicit choice at every width', () => {
    expect(expandedFrom('collapsed', true)).toBe(false)
    expect(expandedFrom('collapsed', false)).toBe(false)
    expect(expandedFrom('expanded', true)).toBe(true)
    expect(expandedFrom('expanded', false)).toBe(true)
  })

  it('treats an unknown value as no choice', () => {
    expect(expandedFrom('wide', true)).toBe(true)
    expect(expandedFrom('', false)).toBe(false)
  })
})

describe('nextRail', () => {
  it('writes the explicit opposite of what shows', () => {
    expect(nextRail(undefined, true)).toBe('collapsed')
    expect(nextRail(undefined, false)).toBe('expanded')
    expect(nextRail('collapsed', true)).toBe('expanded')
    expect(nextRail('expanded', false)).toBe('collapsed')
  })

  it('comes back to the first choice on the second toggle, at either width', () => {
    for (const wide of [true, false]) {
      const once = nextRail(undefined, wide)
      expect(nextRail(nextRail(once, wide), wide)).toBe(once)
    }
  })
})

describe('RailToggle', () => {
  it('renders nothing on the server, so it cannot mismatch hydration', () => {
    expect(renderToString(h(RailToggle, { placement: 'topbar' }))).toBe('')
    expect(renderToString(h(RailToggle, { placement: 'rail' }))).toBe('')
  })
})
