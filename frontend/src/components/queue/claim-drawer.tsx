'use client'
// The claim drawer (spec §6): the ref in ?c=, beside the list from lg and full screen below it. Base UI Dialog parts are
// used directly because SheetContent always renders a backdrop and its width classes win over ours. Non-modal from lg, so
// the list beside it stays usable; modal below lg, where it covers the list, so the hidden list leaves Tab and reading order.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms'
import { isTypingTarget } from '@/components/shell/keys'
import { ClaimPane } from '@/components/trace/claim-pane'
import { CLAIM_DRAWER_TITLE_ID as TITLE } from '@/components/trace/header'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'

const LG = '(min-width: 64rem)'

/** History state of the entry that opening the drawer pushes. A new object each time: Next writes its own keys into the
 *  object it is given, and skips its useSearchParams sync for a state that already holds them. */
export const drawerEntry = (): { claimDrawer: true } => ({ claimDrawer: true })

export function isDrawerEntry(historyState: unknown): boolean {
  return typeof historyState === 'object' && historyState !== null && (historyState as { claimDrawer?: unknown }).claimDrawer === true
}

/** How closing removes ?c: back when opening pushed this entry, so ✕, Esc and Back agree; else a replace (a deep link). */
export function closeAction(historyState: unknown): 'back' | 'replace' {
  return isDrawerEntry(historyState) ? 'back' : 'replace'
}

/** Whether a replace keeps the drawer's mark: only a write of ?c alone that keeps ?c (a row click, Enter, j / k while
 *  open). A filter write (any other key) drops it, so a later close replaces ?c away instead of going back to the entry
 *  with the old filters (spec §6). */
export function keepsDrawerMark(updates: Record<string, unknown>, hasC: boolean, historyState: unknown): boolean {
  return hasC && isDrawerEntry(historyState) && Object.keys(updates).every((k) => k === 'c')
}

/** What activating a row writes, judged on the live ?c (window.location), not the rendered one: Next commits
 *  useSearchParams in a transition, so a second click before it lands must not push a second entry with the same ?c.
 *  Opening from closed pushes; switching claims replaces; the open claim writes nothing (focus goes to its heading). */
export function openWrite(liveC: string | null, ref: string): 'push' | 'replace' | null {
  return liveC === ref ? null : liveC ? 'replace' : 'push'
}

/** Whether ✕ or Esc may close now: while the live ?c is the claim the drawer was last pointed at (by a row, Enter or
 *  j / k, or a render), and once per close. `closing` is the ?c a close already started on: Base UI can report one Esc
 *  twice in a tick and Back lands later, so a second call then must not go back again and leave /queue. The caller
 *  clears it on every popstate, so landing on another entry with the same ?c never leaves the drawer stuck open. */
export function canClose(liveC: string | null, shown: string | null, closing: string | null): boolean {
  return !!liveC && liveC === shown && liveC !== closing
}

// matchMedia is read lazily, never at import or on the server: tests render this module in node.
function subscribe(onChange: () => void) {
  const lg = matchMedia(LG)
  lg.addEventListener('change', onChange)
  return () => lg.removeEventListener('change', onChange)
}

function rowToFocus(key: string | null): HTMLElement | null {
  const row = (key && document.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)) || document.querySelector<HTMLElement>('[data-row]')
  row?.scrollIntoView({ block: 'nearest' })
  return row
}

export function ClaimDrawer({ selected, onClose, finalFocusKey }: { selected: string | null; onClose: () => void; finalFocusKey: string | null }) {
  const wide = useSyncExternalStore(subscribe, () => matchMedia(LG).matches, () => true)
  const popup = useRef<HTMLDivElement>(null)
  // The last ref keeps rendering while the drawer closes, so it never blanks.
  const [last, setLast] = useState(selected)
  if (selected && selected !== last) setLast(selected)
  const refId = selected ?? last

  // A new ?c while open remounts the body: start it at the top and move focus to its title. The first open has no
  // popup yet (the portal mounts after this effect); initialFocus covers it.
  useEffect(() => {
    const el = popup.current
    if (!selected || !el) return
    el.scrollTop = 0
    el.querySelector<HTMLElement>(`#${TITLE}`)?.focus({ preventScroll: true })
  }, [selected])

  return (
    <Dialog.Root
      open={!!selected}
      modal={!wide}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        // Only Esc closes through here. The ✕ is a plain Button that calls onClose directly (not Dialog.Close), and
        // outside presses never dismiss (disablePointerDismissal); every other reason is ignored.
        if (open || details.reason !== 'escape-key') return
        const target = details.event.target instanceof Element ? details.event.target : null
        // Esc in a field only leaves the field; with an act dialog open, Esc closes that dialog alone.
        if (isTypingTarget(target) || document.querySelector('[data-slot="dialog-content"]')) details.cancel()
        else onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup
          ref={popup}
          data-claim-drawer=""
          aria-labelledby={TITLE}
          initialFocus={() => popup.current?.querySelector<HTMLElement>(`#${TITLE}`) ?? true}
          finalFocus={() => rowToFocus(finalFocusKey)}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-popover shadow-lg lg:inset-auto lg:top-14 lg:right-0 lg:bottom-0 lg:w-[min(36rem,45vw)] lg:border-l"
        >
          {refId && <ClaimDrawerBody refId={refId} onClose={onClose} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The drawer's contents, free of Dialog parts so tests can render it. Keyed by viewer and ref, so a revealed value
 *  never carries to another claim or another identity. */
export function ClaimDrawerBody({ refId, onClose }: { refId: string; onClose: () => void }) {
  const { viewer } = useWorkspace()
  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-3 py-1.5 text-xs">
        <RefLink to={refId} className="min-w-0 truncate font-mono">
          {refId}
        </RefLink>
        <Button size="icon-xs" variant="ghost" className="ml-auto pointer-coarse:size-11" aria-label="Close the claim pane" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <ClaimPane key={`${viewer.id}|${refId}`} claimRef={refId} compact />
    </>
  )
}
