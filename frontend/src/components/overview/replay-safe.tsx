'use client'
// Act-in-place controls and masked text for the overview. While the dashboard replays a past state they render
// nothing that could act on it: a past state must never be acted on, and a reveal is an act too.
import { type ComponentProps, createContext, type ReactNode, use, useId } from 'react'
import { ActButton } from '@/components/acts/act-host'
import { canOpen } from '@/components/acts/draft'
import { MaskedText } from '@/components/atoms'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context' // not the index: it re-exports the provider
import type { OpenActRequest } from '@/components/workspace/types'
import { plainMasked } from '@/lib/model/mask-token'

/** True while the overview renders a replayed state (set by the overview screen). */
export const ReplayContext = createContext<boolean>(false)

type ButtonProps = ComponentProps<typeof Button>

/**
 * An act button judged against the live workspace. Refused, it either explains in visible text (a tooltip on a
 * disabled button reaches nobody on a keyboard, a screen reader or a phone) or hides. Replaying, it renders nothing.
 */
export function OvAct({ request, children, whenRefused, size, variant, reason, focusable }: {
  request: OpenActRequest
  children: ReactNode
  whenRefused: 'explain' | 'hide'
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  /** Refused: rendered in the describing span instead of <MaskedText text={auth.reason} context={request.target} />. */
  reason?: ReactNode
  /** Refused: Button gets focusableWhenDisabled and className "data-disabled:opacity-50" (aria-disabled, no disabled=""). */
  focusable?: boolean
}) {
  const replay = use(ReplayContext)
  const ws = useWorkspace()
  const reasonId = useId()
  if (replay) return null
  const { auth } = canOpen(request, ws)
  if (auth.ok) {
    return <ActButton {...request} size={size} variant={variant}>{children}</ActButton>
  }
  if (whenRefused === 'hide') return null
  // Opt-in (the filing page): the refused button stays in the Tab order. The Overview passes neither prop, so its
  // buttons keep disabled="" and its HTML is unchanged.
  const stay = focusable ? { focusableWhenDisabled: true, className: 'data-disabled:opacity-50' } : {}
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button type="button" size={size} variant={variant} disabled aria-describedby={reasonId} {...stay}>
        {children}
      </Button>
      {/* Gate reasons can quote finding titles, which may hold masked tokens; a caller's reason masks its own text. */}
      <span id={reasonId} className="text-xs text-muted-foreground">
        {reason ?? <MaskedText text={auth.reason} context={request.target} />}
      </span>
    </span>
  )
}

/** Masked-safe text. Live: tokens show with Reveal (logged against `context`). Replaying: the masked form only. */
export function OvMasked({ text, context }: { text: string; context: string }) {
  if (use(ReplayContext)) {
    return <span>{plainMasked(text)}</span>
  }
  return <MaskedText text={text} context={context} />
}
