'use client'
// The client portal's top: the demo identity picker and the household header. The only part of the portal frame
// that reads the workspace, so portal-shell.tsx loads it in the browser and keeps the frame itself static.
import Link from 'next/link'
import { useWorkspace } from '@/components/workspace/context'

export function PortalBar() {
  const { model, viewer, identities, switchIdentity } = useWorkspace()
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
          <Link href="/" className="ml-auto underline underline-offset-2">
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
