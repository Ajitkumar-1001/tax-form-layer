'use client'
// One dialog host for every act form. Any screen calls useOpenAct()({ type, target, prefill, findings }).
// Mount ActHostProvider inside WorkspaceProvider: the forms read useWorkspace().
import { type ComponentProps, createContext, type ReactNode, use, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspace } from '@/components/workspace/context' // not the index: it re-exports the provider, which imports this file
import type { OpenActRequest } from '@/components/workspace/types'
import type { Finding } from '@/lib/model/checks/types'
import { ActDialog } from './act-dialog'
import { canOpen, fixToRequest, normalizeRequest } from './draft'

const ActHostContext = createContext<(req: OpenActRequest) => void>(() => {})

export function ActHostProvider({ children }: { children: ReactNode }) {
  // n keys the form so every open starts from a fresh draft; current outlives `open` for the exit animation.
  const [current, setCurrent] = useState<{ req: OpenActRequest; n: number } | null>(null)
  const [open, setOpen] = useState(false)
  const openAct = (req: OpenActRequest) => {
    setCurrent((c) => ({ req: normalizeRequest(req), n: (c?.n ?? 0) + 1 }))
    setOpen(true)
  }
  return (
    <ActHostContext value={openAct}>
      {children}
      {/* !open: a form reopened during the close animation must not be cleared when that animation ends. */}
      <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={(o) => !o && !open && setCurrent(null)}>
        {current && <ActDialog key={current.n} req={current.req} onDone={() => setOpen(false)} onOpen={openAct} />}
      </Dialog>
    </ActHostContext>
  )
}

export function useOpenAct(): (req: OpenActRequest) => void {
  return use(ActHostContext)
}

type ActButtonProps = OpenActRequest & Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>

/**
 * Opens an act form. Disabled, with the authorize() reason as its tooltip, when the viewer may not do it.
 * Judged by canOpen(): a value the form has yet to collect never disables the button.
 */
export function ActButton({ type, target, prefill, findings, children, ...rest }: ActButtonProps) {
  const openAct = useOpenAct()
  const { req, auth } = canOpen({ type, target, prefill, findings }, useWorkspace())
  const button = (
    <Button type="button" {...rest} disabled={rest.disabled || !auth.ok} onClick={() => openAct(req)}>
      {children}
    </Button>
  )
  return auth.ok ? button : <span title={auth.reason} className="inline-flex">{button}</span>
}

/** The finding's suggested fix (pre-filled, addressing the finding), or a generic resolve when it has none. */
export function FindingFixButton({ finding, ...rest }: { finding: Finding } & Omit<ComponentProps<typeof Button>, 'type' | 'onClick'>) {
  return (
    <ActButton size="sm" variant="outline" {...rest} {...fixToRequest(finding)}>
      {finding.fix?.label ?? 'Resolve…'}
    </ActButton>
  )
}
