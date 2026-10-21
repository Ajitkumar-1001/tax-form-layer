import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
const AppShell = dynamic(() => import('@/components/shell/app-shell').then(mod => mod.AppShell))



// Staff routes. The WorkspaceProvider is mounted once in the root layout (shared with /client);
// this adds the top bar, navigation and gate bar. Static: all data loads in the browser. The shell frame and
// the page render on the server; the parts that read the workspace wait in their own <Suspense> (AppShell), so
// navigations into these routes validate as instant. Pages render <AppLoader>, which loads the screen in the browser.
export default function WorkLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
