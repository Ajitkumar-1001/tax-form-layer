// The tour is read-only on the shared demo. The two requests that append to the act log (workspace/api.ts: postActs and
// postReveal) ask here first, so every caller is covered: the act forms, Undo, the bulk actions, the clock, Reveal.
// The flag lives in memory only: it is set while a stop or the closing card is up and cleared the moment the tour closes
// or unmounts, so a closed tab or a crash can never leave a visitor locked out.
// The server does not protect `main` by itself (it trusts the engagement named in the request), so this is the protection.
let open = false

export const TOUR_READ_ONLY_REASON = 'The tour is read-only. Finish or skip it to make changes.'

export function setTourOpen(value: boolean): void {
  open = value
}

/** Whether a write to this engagement must be refused right now: only the shared one, only while the tour is up. A fresh
 *  copy (`copy-<hex>`) is the place to experiment, so it stays writable. */
export function tourBlocksWrite(engagement: string): boolean {
  return open && engagement === 'main'
}
