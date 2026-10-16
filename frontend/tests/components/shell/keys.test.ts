// The single-key shortcut guards. Node has no DOM, so the elements are stubs: a tag, attributes and a parent, with
// closest/matches for what keys.ts asks (comma lists of tag names, [attr] and [attr="value"]).
import { describe, expect, it } from 'vitest'
import { type ElLike, inOverlay, isTypingTarget } from '@/components/shell/keys'

type Stub = NonNullable<ElLike>

function el(tag: string, attrs: Record<string, string> = {}, parent: Stub | null = null): Stub {
  const one = (sel: string): boolean => {
    const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
    if (a) return a[2] === undefined ? a[1] in attrs : attrs[a[1]] === a[2]
    return sel === tag
  }
  const matches = (list: string): boolean => list.split(',').some((s) => one(s.trim()))
  const closest = (list: string): Stub | null => (matches(list) ? stub : (parent?.closest(list) ?? null))
  const stub = { closest, matches } as Stub
  return stub
}

const page = el('main')
const drawer = el('div', { role: 'dialog', 'data-claim-drawer': '' }, page)

describe('isTypingTarget', () => {
  it('is true in a field and inside an editable region', () => {
    expect(isTypingTarget(el('input', {}, page))).toBe(true)
    expect(isTypingTarget(el('textarea', {}, page))).toBe(true)
    expect(isTypingTarget(el('select', {}, page))).toBe(true)
    expect(isTypingTarget(el('span', {}, el('div', { contenteditable: 'true' }, page)))).toBe(true)
  })

  it('is false elsewhere, in a region that is not editable and with no target', () => {
    expect(isTypingTarget(el('button', {}, page))).toBe(false)
    expect(isTypingTarget(el('span', {}, el('div', { contenteditable: 'false' }, page)))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('is true in a field inside the claim drawer', () => {
    expect(isTypingTarget(el('input', {}, drawer))).toBe(true)
  })
})

describe('inOverlay', () => {
  it('is true inside a dialog, an alert dialog, a menu or a list box', () => {
    for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
      expect(inOverlay(el('button', {}, el('div', { role }, page)))).toBe(true)
    }
  })

  it('is false on the page and with no target', () => {
    expect(inOverlay(el('button', {}, page))).toBe(false)
    expect(inOverlay(null)).toBe(false)
  })

  it('does not count the claim drawer itself or what sits in it', () => {
    expect(inOverlay(drawer)).toBe(false)
    expect(inOverlay(el('button', {}, drawer))).toBe(false)
    expect(inOverlay(el('a', {}, el('section', {}, drawer)))).toBe(false)
  })

  it('counts an overlay opened inside the drawer', () => {
    expect(inOverlay(el('div', { role: 'option' }, el('div', { role: 'listbox' }, drawer)))).toBe(true)
    expect(inOverlay(el('button', {}, el('div', { role: 'dialog' }, drawer)))).toBe(true)
  })
})
