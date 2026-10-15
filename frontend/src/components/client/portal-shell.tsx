'use client'
// The client portal frame: no staff shell, no navigation into staff screens beyond one link back. The frame reads
// nothing that loads, so it renders on the server and Next.js can validate the route as an instant navigation; the
// part that reads the workspace (portal-bar.tsx) loads in the browser, as every screen does (components/app-loader.tsx).
import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'

// Same boxes as the real bar: the demo strip (40 px, 84 px where it wraps on a phone) and the 60 px brand line (next/dynamic needs its options inline).
const PortalBar = dynamic(() => import('./portal-bar').then((m) => m.PortalBar), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true">
      <div className="h-10 max-sm:h-[84px] bg-amber-50 dark:bg-amber-950" />
      <div className="h-[60px] bg-background" />
    </div>
  ),
})

export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-background">
      <PortalBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16">{children}</main>
    </div>
  )
}
