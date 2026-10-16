'use client'
// One dialog host for every act form. Any screen calls useOpenAct()({ type, target, prefill, findings }).
// Mount ActHostProvider inside WorkspaceProvider: the forms read useWorkspace().
import { type ComponentProps, createContext, type ReactNode, use, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspace } from '@/components/workspace/context' // not the index: it re-exports the provider, which imports this file
import type { OpenActRequest } from '@/components/workspace/types'
import type { Finding } from '@/lib/model/checks/types'
import { plainMasked } from '@/lib/model/mask-token'
import { ActDialog } from './act-dialog'
import { canOpen, fixToRequest, normalizeRequest } from './draft'

/** `from` is the control that opens the form; without it, the focused element counts as the opener. */
type OpenAct = (req: OpenActRequest, from?: HTMLElement) => void

const ActHostContext = createContext<OpenAct>(() => {})

/**
 * Where focus goes when the act dialog closes: the opener's nearest `[data-focus-return]` ancestor (`back`, found when
 * the dialog opened) when the opener is gone or disabled (a Sign that unmounted, a Submit replaced by its refused form)
 * and that ancestor is still in the page; otherwise true, Base UI's default (back to the opener).
 */
export function returnFocusTo<B extends { isConnected: boolean }>(
  o: { el: Pick<Element, 'isConnected' | 'matches'>; back: B | null } | null,
): B | true {
  if (!o || (o.el.isConnected && !o.el.matches(':disabled'))) return true
  return o.back?.isConnected ? o.back : true
}

/**
 * The dialog's `finalFocus` for an opener inside a marker. Base UI would focus a returned marker's first tabbable child
 * (a marker is tabIndex -1), so the marker is focused here, after the close, and Base UI is told to move nothing.
 */
export function focusReturn(
  o: {
    el: Pick<Element, 'isConnected' | 'matches'>
    back: { isConnected: boolean; focus(o?: FocusOptions): void } | null
  } | null,
): boolean {
  const to = returnFocusTo(o)
  if (to === true) return true
  queueMicrotask(() => to.focus({ preventScroll: true }))
  return false
}

export function ActHostProvider({ children }: { children: ReactNode }) {
  // n keys the form so every open starts from a fresh draft; current outlives `open` for the exit animation. marked:
  // the opener sat inside a [data-focus-return] marker (state, not the ref: the compiler forbids ref reads in render).
  const [current, setCurrent] = useState<{ req: OpenActRequest; n: number; marked: boolean } | null>(null)
  const [open, setOpen] = useState(false)
  const opener = useRef<{ el: HTMLElement; back: HTMLElement | null } | null>(null)
  // A chained open (the dialog's onOpen, no `marked`) inherits the first open's flag.
  const show = (req: OpenActRequest, marked?: boolean) => {
    setCurrent((c) => ({ req: normalizeRequest(req), n: (c?.n ?? 0) + 1, marked: marked ?? c?.marked ?? false }))
    setOpen(true)
  }
  // Opens from the page record the opener; a chained open from inside the dialog (its onOpen, `show`) keeps the first.
  const openAct: OpenAct = (req, from) => {
    const el = from ?? document.activeElement
    const known = el instanceof HTMLElement && el !== document.body
    opener.current = known ? { el, back: el.closest<HTMLElement>('[data-focus-return]') } : null
    show(req, opener.current?.back != null)
  }
  const finalFocus = () => focusReturn(opener.current)
  return (
    <ActHostContext value={openAct}>
      {children}
      {/* !open: a form reopened during the close animation must not be cleared when that animation ends. */}
      <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={(o) => !o && !open && setCurrent(null)}>
        {current && (
          <ActDialog
            key={current.n}
            req={current.req}
            onDone={() => setOpen(false)}
            onOpen={show}
            // No marker: undefined keeps Base UI's implicit default (a function counts as explicit and would pull focus
            // back to the opener even when it moved elsewhere before the close).
            finalFocus={current.marked ? finalFocus : undefined}
          />
        )}
      </Dialog>
    </ActHostContext>
  )
}

export function useOpenAct(): OpenAct {
  return use(ActHostContext)
}

type ActButtonProps = OpenActRequest & Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>

/**
 * Opens an act form. Disabled, with the authorize() reason as its tooltip, when the viewer may not do it.
 * Judged by canOpen(): a value the form has yet to collect never disables the button.
 * The button itself is the opener (Safari and Firefox on macOS do not focus a clicked button).
 */
export function ActButton({ type, target, prefill, findings, children, ...rest }: ActButtonProps) {
  const openAct = useOpenAct()
  const { req, auth } = canOpen({ type, target, prefill, findings }, useWorkspace())
  const button = (
    <Button type="button" {...rest} disabled={rest.disabled || !auth.ok} onClick={(e) => openAct(req, e.currentTarget)}>
      {children}
    </Button>
  )
  return auth.ok ? button : <span title={plainMasked(auth.reason)} className="inline-flex">{button}</span>
}

/** The finding's suggested fix (pre-filled, addressing the finding), or a generic resolve when it has none. */
export function FindingFixButton({ finding, ...rest }: { finding: Finding } & Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>) {
  return (
    <ActButton size="sm" variant="outline" {...rest} {...fixToRequest(finding)}>
      {finding.fix?.label ?? 'Resolve…'}
    </ActButton>
  )
}
