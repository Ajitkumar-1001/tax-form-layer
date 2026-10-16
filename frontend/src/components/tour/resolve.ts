// Finding what a step points at. Next keeps earlier pages mounted but hidden (display: none), and a hidden page can hold a
// copy of an element that looks identical to the visible one, so a bare querySelector can return an invisible twin. Only a
// VISIBLE match counts.

/** The two members of an element this module relies on; tests pass plain objects. */
export interface Showable {
  checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean
  getClientRects(): { length: number }
}

/** Not hidden by display, visibility or an ancestor. Older browsers without checkVisibility fall back to having a box. */
export function isVisible(el: Showable): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkVisibilityCSS: true })
  return el.getClientRects().length > 0
}

/** The first visible candidate, or null. */
export function pickVisible<T extends Showable>(candidates: Iterable<T>): T | null {
  for (const el of candidates) if (isVisible(el)) return el
  return null
}

/** The visible element matching `selector`, or null (not mounted yet, or only a hidden copy is). */
export function findAnchor(selector: string, root: ParentNode = document): HTMLElement | null {
  return pickVisible(root.querySelectorAll<HTMLElement>(selector))
}
