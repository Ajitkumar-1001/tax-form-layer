'use client'
// The client portal's top: the demo identity picker and the household header. The only part of the portal frame
// that reads the workspace, so portal-shell.tsx loads it in the browser and keeps the frame itself static.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { staffReturn } from '@/components/workspace/client-gate'
import { useWorkspace } from '@/components/workspace/context'

type Click = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'preventDefault'>

/** "Back to staff view": a client signs in as `returnAs` first, else ClientGate bounces /overview back here. A modified click keeps the browser's own behaviour. */
export function backToStaff(returnAs: string | null, switchIdentity: (id: string) => Promise<void>, push: (href: string) => void) {
  return async (e: Click) => {
    if (!returnAs || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    await switchIdentity(returnAs)
    push('/overview')
  }
}

export function PortalBar() {
  const { model, state, viewer, identities, switchIdentity } = useWorkspace()
  const router = useRouter()
  const returnAs = staffReturn(viewer, identities, state.clock.slice(0, 10))
  const clients = identities.filter((v) => v.kind === 'client')
  return (
    <>
      <div className="bg-amber-50 px-4 py-1.5 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
          <span>Demo: switch identity with the role switcher on staff pages.</span>
          <label className="flex items-center gap-1.5">
            <span>Signed in as</span>
            <select
              className="h-7 rounded border border-amber-300 bg-background px-1 text-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none dark:border-amber-800"
              value={viewer.kind === 'client' ? viewer.id : ''}
              onChange={(e) => e.target.value && void switchIdentity(e.target.value)}
            >
              {viewer.kind !== 'client' && <option value="">{viewer.name} (staff preview)</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Link
            href="/overview"
            className="ml-auto underline underline-offset-2"
            onClick={backToStaff(returnAs, switchIdentity, router.push)}
          >
            Back to staff view
          </Link>
        </div>
      </div>
      <header className="bg-background">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-4 px-4 py-4">
          <p className="text-xl font-semibold">{model.packet.firm.name}</p>
          <p className="text-xl">{model.packet.household.tax_year} tax return</p>
        </div>
      </header>
    </>
  )
}
