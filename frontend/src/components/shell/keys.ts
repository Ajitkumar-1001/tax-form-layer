// Where a single-key shortcut (the queue's j/k/x…, ⌘B, the trace's 1/2/3) stands aside, and where the queue's keys run at all. Typed over
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

const QUEUE_KEY_REGIONS = '[data-worklist], [data-claim-drawer]'

/** Whether a keydown on this target is the queue's (rule 13; WCAG 2.1.4: active only while its component has focus):
 *  inside the worklist (queue-screen.tsx's section) or the claim drawer, and not in a field, on a Select trigger
 *  (typeahead) or in an overlay opened there. Never from the rail, the top bar, a toast, <main> or <body>. */
export function takesQueueKeys(el: ElLike): boolean {
  return !!el?.closest(QUEUE_KEY_REGIONS) && !isTypingTarget(el) && !inOverlay(el) && !takesTypeahead(el)
}
