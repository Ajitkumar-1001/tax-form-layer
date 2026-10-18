// The act dialog's close-time focus rule (loose-ends brief §B). No DOM in these tests: plain objects stand in for the
// opener ({ isConnected, matches }) and for its nearest [data-focus-return] ancestor ({ isConnected }, plus focus).
import { describe, expect, it, vi } from 'vitest'
import { focusReturn, returnFocusTo } from '@/components/acts/act-host'

/** An opener: in the page or not, and matching ':disabled' (and nothing else) when disabled. */
const opener = (isConnected: boolean, disabled = false) => ({
  isConnected,
  matches: (s: string) => disabled && s === ':disabled',
})
const back = { isConnected: true }

describe('returnFocusTo', () => {
  it('keeps the default (back to the opener) while the opener is in the page and enabled', () => {
    expect(returnFocusTo({ el: opener(true), back })).toBe(true)
  })

  it('sends focus to the marked ancestor when the opener is gone or disabled', () => {
    expect(returnFocusTo({ el: opener(false), back })).toBe(back)
    expect(returnFocusTo({ el: opener(true, true), back })).toBe(back)
  })

  it('keeps the default when a gone or disabled opener has no marked ancestor, or it left the page too', () => {
    expect(returnFocusTo({ el: opener(false), back: null })).toBe(true)
    expect(returnFocusTo({ el: opener(true, true), back: null })).toBe(true)
    expect(returnFocusTo({ el: opener(false), back: { isConnected: false } })).toBe(true)
  })

  it('keeps the default when no opener was recorded', () => {
    expect(returnFocusTo(null)).toBe(true)
  })
})

describe('focusReturn', () => {
  it('focuses the marker itself after the close and has Base UI move nothing when the opener is gone', async () => {
    const marker = { isConnected: true, focus: vi.fn() }
    expect(focusReturn({ el: opener(false), back: marker })).toBe(false)
    expect(marker.focus).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(marker.focus).toHaveBeenCalledTimes(1)
    expect(marker.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('leaves the return to Base UI and focuses nothing while the opener is in the page and enabled', async () => {
    const marker = { isConnected: true, focus: vi.fn() }
    expect(focusReturn({ el: opener(true), back: marker })).toBe(true)
    await Promise.resolve()
    expect(marker.focus).not.toHaveBeenCalled()
  })

  // u on the queue with no cursor row opens the Revert form from the worklist section, which is its own marker. Base UI
  // would hand focus to the section's first tabbable child, the search box, where the next j would type.
  it('treats an opener that is its own marker like a gone one: the marker is focused after the close', async () => {
    const section = { ...opener(true), focus: vi.fn() }
    expect(returnFocusTo({ el: section, back: section })).toBe(section)
    expect(focusReturn({ el: section, back: section })).toBe(false)
    await Promise.resolve()
    expect(section.focus).toHaveBeenCalledTimes(1)
    expect(section.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
