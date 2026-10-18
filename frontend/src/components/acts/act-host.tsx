'use client'
// One dialog host for every act form. Any screen calls useOpenAct()({ type, target, prefill, findings }).
// Mount ActHostProvider inside WorkspaceProvider: the forms read useWorkspace().
import { type ComponentProps, createContext, type ReactNode, use, useId, useRef, useState } from 'react'
import { MaskedText } from '@/components/atoms'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspace } from '@/components/workspace/context' // not the index: it re-exports the provider, which imports this file
import type { OpenActRequest } from '@/components/workspace/types'
import type { Finding } from '@/lib/model/checks/types'
import { cn } from '@/lib/utils'
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

type ActButtonProps = OpenActRequest &
  Omit<ComponentProps<typeof Button>, 'type' | 'onClick'> & {
    /** Refused: the id of a line the caller prints the reason in, once for a group. The button points there and prints none. */
    reasonId?: string
  }

/**
 * Opens an act form. Refused (the viewer may not do it): aria-disabled, so it stays in the Tab order, described by the
 * authorize() reason in words, printed beside it or in the caller's line when `reasonId` names one. A title reaches no
 * keyboard, screen reader or phone. Judged by canOpen(): a value the form has yet to collect never disables the button.
 * The button itself is the opener (Safari and Firefox on macOS do not focus a clicked button).
 */
export function ActButton({ type, target, prefill, findings, reasonId, children, ...rest }: ActButtonProps) {
  const openAct = useOpenAct()
  const ownId = useId()
  const { req, auth } = canOpen({ type, target, prefill, findings }, useWorkspace())
  if (auth.ok) {
    return (
      <Button type="button" {...rest} onClick={(e) => openAct(req, e.currentTarget)}>
        {children}
      </Button>
    )
  }
  // focusableWhenDisabled renders aria-disabled="true" rather than disabled="", so Tab reaches the button; it opens nothing.
  // The base class's disabled:pointer-events-none keys on the native attribute, so data-disabled restores it: no hover or press feedback.
  const button = (
    <Button type="button" {...rest} disabled focusableWhenDisabled aria-describedby={reasonId ?? ownId} className={cn(rest.className, 'data-disabled:pointer-events-none data-disabled:opacity-50')}>
      {children}
    </Button>
  )
  if (reasonId) return button
  // Not OvAct, which imports this file. A gate reason can quote a note that holds a token: MaskedText masks it.
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {button}
      <span id={ownId} data-refusal className="text-xs text-muted-foreground">
        <MaskedText text={auth.reason} context={target} />
      </span>
    </span>
  )
}

/** The finding's suggested fix (pre-filled, addressing the finding), or a generic resolve when it has none. */
export function FindingFixButton({ finding, ...rest }: { finding: Finding } & Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>) {
  return (
    <ActButton size="sm" variant="outline" {...rest} {...fixToRequest(finding)}>
      {finding.fix?.label ?? 'Resolve…'}
    </ActButton>
  )
}
