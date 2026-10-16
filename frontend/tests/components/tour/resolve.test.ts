// No DOM here: the finder takes anything with the two members it uses, so a hidden twin is just a plain object.
import { describe, expect, it } from 'vitest'
import { isVisible, pickVisible } from '@/components/tour/resolve'

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
