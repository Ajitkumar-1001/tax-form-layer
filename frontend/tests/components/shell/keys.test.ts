// The single-key shortcut guards. Node has no DOM, so the elements are stubs: a tag, attributes and a parent, with
// closest/matches for what keys.ts asks (comma lists of tag names, [attr] and [attr="value"], the last two optionally after
// a tag name: button[aria-disabled="true"]).
import { describe, expect, it } from 'vitest'
import { type ElLike, inertButton, inOverlay, isTypingTarget, takesQueueKeys, takesTypeahead } from '@/components/shell/keys'

type Stub = NonNullable<ElLike>

function el(tag: string, attrs: Record<string, string> = {}, parent: Stub | null = null): Stub {
  const one = (sel: string): boolean => {
    const a = /^([a-z]*)\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
    if (a) return (!a[1] || a[1] === tag) && (a[3] === undefined ? a[2] in attrs : attrs[a[2]] === a[3])
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

// A closed Select trigger (the area filter, the identity switcher) is a button with role="combobox" that takes typeahead:
// "k" there picks "K-1s & basis", so the queue's single keys must stand aside. It is not a typing target, though: the
// drawer's Esc branch reads isTypingTarget, and Esc on a closed trigger must still close the drawer.
describe('takesTypeahead', () => {
  const trigger = el('button', { role: 'combobox' }, page)

  it('is true on a Select trigger and inside one', () => {
    expect(takesTypeahead(trigger)).toBe(true)
    expect(takesTypeahead(el('span', {}, trigger))).toBe(true)
    expect(takesTypeahead(el('button', { role: 'combobox' }, drawer))).toBe(true)
  })

  it('is false elsewhere and with no target', () => {
    expect(takesTypeahead(el('button', {}, page))).toBe(false)
    expect(takesTypeahead(el('div', { role: 'listbox' }, page))).toBe(false)
    expect(takesTypeahead(null)).toBe(false)
  })

  it('leaves isTypingTarget and inOverlay false on the trigger', () => {
    expect(isTypingTarget(trigger)).toBe(false)
    expect(isTypingTarget(el('span', {}, trigger))).toBe(false)
    expect(inOverlay(trigger)).toBe(false)
  })
})

// Rule 13 (WCAG 2.1.4): the queue's single keys run only while focus is in the worklist (the screen's section) or the
// claim drawer. A bare u from a rail link, the top bar's ? or <body> used to post a revert.
describe('takesQueueKeys', () => {
  const body = el('body')
  const main = el('main', {}, body)
  const list = el('section', { 'data-worklist': '' }, main)
  const li = el('li', {}, el('ul', {}, el('details', {}, list)))

  it("takesQueueKeys: the queue's keys run only inside the worklist or the drawer", () => {
    const outside: [string, ElLike][] = [
      ['rail link', el('a', {}, el('nav', {}, el('aside', {}, body)))],
      ['top-bar ?', el('button', {}, el('header', {}, body))],
      ['toast', el('button', {}, el('li', {}, el('ol', {}, el('section', {}, body))))],
      ['main', main],
      ['body', body],
      ['null', null],
    ]
    const standAside: [string, ElLike][] = [
      ['search', el('input', {}, list)],
      ['bulk select', el('select', {}, el('form', {}, list))],
      ['editable', el('span', {}, el('div', { contenteditable: 'true' }, list))],
      ['area trigger', el('button', { role: 'combobox' }, list)],
      ['act-form textarea', el('textarea', {}, el('div', { role: 'dialog' }, body))],
      ['act-form Cancel', el('button', {}, el('div', { role: 'dialog' }, body))],
      ['option in a drawer listbox', el('div', { role: 'option' }, el('div', { role: 'listbox' }, drawer))],
      ['drawer field', el('input', {}, drawer)],
      ['drawer Select trigger', el('button', { role: 'combobox' }, drawer)],
    ]
    const inside: [string, ElLike][] = [
      ['row', el('button', { 'data-row': 'contradicted:F8949.B.N1' }, li)],
      ['row checkbox', el('span', { role: 'checkbox' }, li)],
      ['group header', el('summary', {}, el('details', {}, list))],
      ['Assigned to me', el('span', { role: 'switch' }, list)],
      ['list itself', list],
      ['drawer title', el('h2', {}, drawer)],
      ['drawer itself', drawer],
      ['drawer button', el('button', {}, drawer)],
    ]
    for (const [name, x] of [...outside, ...standAside]) expect(takesQueueKeys(x), name).toBe(false)
    for (const [name, x] of inside) expect(takesQueueKeys(x), name).toBe(true)
  })
})

// A refused toolbar button in the claim drawer keeps focus (rule 2), and Base UI's focusableWhenDisabled prevents the
// default of every key but Tab on it. That is not another component claiming the key, so the queue's keys still run there.
describe('inertButton', () => {
  it('is true on a refused (aria-disabled) button, and false on a plain button, a link and no target', () => {
    expect(inertButton(el('button', { 'aria-disabled': 'true' }, drawer))).toBe(true)
    expect(inertButton(el('button', {}, drawer))).toBe(false)
    expect(inertButton(el('a', {}, drawer))).toBe(false)
    expect(inertButton(el('a', { 'aria-disabled': 'true' }, drawer))).toBe(false)
    expect(inertButton(null)).toBe(false)
  })
})
