// No DOM here: the finder takes anything with the two members it uses, so a hidden twin is just a plain object.
import { describe, expect, it } from 'vitest'
import { clearBand, isVisible, pickVisible, scrollDelta } from '@/components/tour/resolve'

const modern = (name: string, visible: boolean) => ({ name, checkVisibility: () => visible, getClientRects: () => ({ length: visible ? 1 : 0 }) })
const legacy = (name: string, boxes: number) => ({ name, getClientRects: () => ({ length: boxes }) })

describe('isVisible', () => {
  it('asks the browser when it can', () => {
    expect(isVisible(modern('a', true))).toBe(true)
    expect(isVisible(modern('b', false))).toBe(false)
  })

  it('falls back to having a box in older browsers', () => {
    expect(isVisible(legacy('a', 1))).toBe(true)
    expect(isVisible(legacy('b', 0))).toBe(false)
  })
})

describe('pickVisible', () => {
  it('skips a hidden twin that comes first: an earlier page stays mounted under display: none', () => {
    const hiddenTwin = modern('hidden twin', false)
    const real = modern('real', true)
    expect(pickVisible([hiddenTwin, real])).toBe(real)
  })

  it('takes the first visible one when several are', () => {
    const a = modern('a', true)
    expect(pickVisible([a, modern('b', true)])).toBe(a)
  })

  it('finds nothing when only hidden copies exist, or none', () => {
    expect(pickVisible([modern('a', false), modern('b', false)])).toBeNull()
    expect(pickVisible([])).toBeNull()
  })
})

describe('clearBand: where on the window a stop\'s subject should land', () => {
  const view = { headerBottom: 56, height: 900 }
  const card = { top: 658, bottom: 884, left: 256, right: 617 } // the docked card at 1440x900
  const tabs = { top: 669, bottom: 701, left: 288, right: 557 }
  const demo = { top: 110, bottom: 790, left: 883, right: 1400 }

  it('starts under the header and ends above the card, where the anchor shares columns with it', () => {
    expect(clearBand(view, tabs, card)).toEqual({ top: 64, bottom: 642 })
  })

  it('ignores the card for an anchor beside it, and for no card at all', () => {
    expect(clearBand(view, demo, card)).toEqual({ top: 64, bottom: 876 })
    expect(clearBand(view, tabs, null)).toEqual({ top: 64, bottom: 876 })
  })
})

describe('scrollDelta: how far to scroll to bring it there', () => {
  const band = { top: 64, bottom: 642 }

  it('is 0 once the anchor is inside the band', () => {
    expect(scrollDelta({ top: 300, bottom: 332 }, band)).toBe(0)
  })

  it('centres an anchor that sits below the band (the claim tabs under the card at 1440x900)', () => {
    expect(scrollDelta({ top: 669, bottom: 701 }, band)).toBe(332) // lands with its top at 337 of 64..642
  })

  it('scrolls up for an anchor above the band', () => {
    expect(scrollDelta({ top: 10, bottom: 42 }, band)).toBe(-327)
  })

  it('puts the top of an anchor taller than the band at the band top, and leaves it once its top is in the upper half', () => {
    expect(scrollDelta({ top: 500, bottom: 1700 }, band)).toBe(436) // top below the band's middle: up to the band top
    expect(scrollDelta({ top: -200, bottom: 1000 }, band)).toBe(-264) // top above the band: down to the band top
    expect(scrollDelta({ top: 300, bottom: 1500 }, band)).toBe(0) // top in the upper half (64..353): leave it
    expect(scrollDelta({ top: 100, bottom: 1300 }, band)).toBe(0)
  })

  it('never works with a band smaller than 120 px (a card nearly as tall as the window)', () => {
    expect(scrollDelta({ top: 500, bottom: 532 }, { top: 64, bottom: 100 })).toBeGreaterThan(0)
  })
})
