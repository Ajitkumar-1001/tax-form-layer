'use client'
// The filing page's act controls (spec 3, §5). A control never disappears: allowed, it is the usual ActButton (outlined
// and captioned when a caution applies); refused, it stays in the Tab order, disabled, described by its reason in words.
import { type ComponentProps, type ReactElement, type ReactNode, useId } from 'react'
import { ActButton } from '@/components/acts/act-host'
import { canOpen } from '@/components/acts/draft'
import { MaskedText } from '@/components/atoms'
import { OvAct } from '@/components/overview/replay-safe'
import type { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { OpenActRequest } from '@/components/workspace/types'
import { apartFromGate, type FilingGate, gateBlock } from './filing-status'
import { A } from './item-list'

/**
 * §5. Allowed: the plain ActButton, outlined and described by the visible caution when one applies. It sits in the same
 * wrapper with or without the caution, so a request that brings the caution keeps the button the act dialog returns focus
 * to. Refused: OvAct, focusable, a disabled button that keeps focus, described by `reason`. `variant` styles both forms; a
 * caution outlines the allowed one regardless.
 */
export function FilingAct({ request, reason, caution, variant, children }: {
  request: OpenActRequest
  reason: ReactNode
  caution?: string
  variant?: ComponentProps<typeof Button>['variant']
  children: ReactNode
}): ReactElement | null {
  const ws = useWorkspace()
  const cautionId = useId()
  if (!canOpen(request, ws).auth.ok) {
    return (
      <OvAct request={request} whenRefused="explain" size="sm" variant={variant} reason={reason} focusable>
        {children}
      </OvAct>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ActButton {...request} size="sm" variant={caution ? 'outline' : variant} aria-describedby={caution ? cautionId : undefined}>
        {children}
      </ActButton>
      {caution && (
        <p id={cautionId} className="text-xs text-muted-foreground">
          {caution}
        </p>
      )}
    </div>
  )
}

/** An authorize() refusal, verbatim and masked (a gate text can quote a clipped note); the page's raw-id check skips it. */
function Refusal({ text }: { text: string }) {
  return <span data-refusal><MaskedText text={text} context="return" /></span>
}

/**
 * §5: why `request` is refused, in words; null when it is allowed. The role part is the server's verdict with the
 * button's gate set aside (apartFromGate). The gate part counts the gate's red steps (1-11 for request approval, 1-12
 * for submit) and open blocking review notes (gateBlock), linked to #steps; with no red step it names the notes alone
 * (controller ruling A4). The live refusal is quoted instead when neither part applies or the red gate counts nothing.
 */
export function ActReasonText({ request, gate }: { request: OpenActRequest; gate: FilingGate | null }): ReactNode {
  const ws = useWorkspace()
  const live = canOpen(request, ws).auth
  if (live.ok) return null
  const role = apartFromGate(ws.model, ws.state, ws.viewer, request, gate)
  const g = gate ? gateBlock(ws.state, gate) : null
  if ((g && g.steps === 0 && g.notes === 0) || (role.ok && !g)) return <Refusal text={live.reason} />
  const notes = g && g.notes > 0 ? `${g.notes} blocking review ${g.notes === 1 ? 'note' : 'notes'}` : ''
  return (
    <>
      {!role.ok && <Refusal text={role.reason} />}
      {!role.ok && g && ' '}
      {g && (
        <>
          {role.ok ? 'Blocked by ' : 'Also blocked by '}
          {g.steps > 0 ? (
            <>
              <A href="#steps">{`${g.steps} open ${g.steps === 1 ? 'step' : 'steps'}`}</A>
              {notes && ` and ${notes}`}
            </>
          ) : (
            <A href="#steps">{notes}</A>
          )}
          {'.'}
        </>
      )}
    </>
  )
}
