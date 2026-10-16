// Where a global single-key shortcut (the queue's j/k/x…, ⌘B, the trace's 1/2/3) stands aside. Typed over
// closest/matches only, so Node tests can pass stub elements.
export type ElLike = Pick<Element, 'closest' | 'matches'> | null

/** Fields that take typed characters: a shortcut there would eat the keystroke. */
export const TYPING_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

/** Dialogs, menus and list boxes own their keys (arrows, typeahead, Enter, Esc). */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

export function isTypingTarget(el: ElLike): boolean {
  return !!el?.closest(TYPING_SELECTOR)
}

/** Inside an overlay. The queue's claim drawer is a dialog that sits beside the list, so it does not count; an
 *  overlay opened inside it does (closest finds that one first). */
export function inOverlay(el: ElLike): boolean {
  const o = el?.closest(OVERLAY_SELECTOR)
  return !!o && !o.matches('[data-claim-drawer]')
}

/** On a Select trigger (role="combobox"), which takes typeahead while closed: "k" there picks "K-1s & basis". Kept out
 *  of TYPING_SELECTOR, because the claim drawer's Esc branch reads isTypingTarget and Esc there must still close it. */
export function takesTypeahead(el: ElLike): boolean {
  return !!el?.closest('[role="combobox"]')
}
