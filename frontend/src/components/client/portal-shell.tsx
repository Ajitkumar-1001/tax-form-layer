'use client'
// The client portal frame: no staff shell, no navigation into staff screens beyond one link back.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useWorkspace } from '@/components/workspace/context'

export function PortalShell({ children }: { children: ReactNode }) {
  const { model, viewer, identities, switchIdentity } = useWorkspace()
  const clients = identities.filter((v) => v.kind === 'client')
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/30">
      <div className="border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-50">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1">
          <span>Demo: switch identity with the role switcher on staff pages.</span>
          <label className="flex items-center gap-1.5">
            <span>Signed in as</span>
            <select
              className="h-6 rounded border border-amber-300 bg-background px-1 text-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none dark:border-amber-800"
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
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-0.5 px-4 py-4">
          <p className="text-xs text-muted-foreground">{model.packet.firm.name} client portal</p>
          <p className="text-lg font-semibold">Your {model.packet.household.tax_year} tax return</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}
