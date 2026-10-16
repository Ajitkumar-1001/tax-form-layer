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

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * The part of the window a stop's subject should land in: below the sticky header, and above the card where the card is in its
 * way (it is docked at the left from lg, and a full-width sheet below, so it only matters where they share columns).
 */
export function clearBand(view: { headerBottom: number; height: number }, anchor: Box, card: Box | null): { top: number; bottom: number } {
  const top = view.headerBottom + 8
  let bottom = view.height - 24
  if (card && anchor.right > card.left && anchor.left < card.right) bottom = Math.min(bottom, card.top - 16)
  return { top, bottom }
}

/** How far to scroll (positive is down) to bring the anchor into the band: 0 when it is there; one taller than the band lands at
 *  the band's top, any other is centred in it. */
export function scrollDelta(anchor: { top: number; bottom: number }, band: { top: number; bottom: number }): number {
  const height = anchor.bottom - anchor.top
  const room = Math.max(band.bottom - band.top, 120)
  const tall = height > room
  const inView = tall ? anchor.top >= band.top - 1 && anchor.top < band.top + room / 2 : anchor.top >= band.top && anchor.bottom <= band.bottom
  if (inView) return 0
  const want = tall ? band.top : band.top + (room - height) / 2
  return Math.round(anchor.top - want)
}
