import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'

// Staff routes. The WorkspaceProvider is mounted once in the root layout (shared with /client);
// this adds the top bar, navigation and gate bar. Static: all data loads in the browser. The shell frame and
// the page render on the server; the parts that read the workspace wait in their own <Suspense> (AppShell), so
// navigations into these routes validate as instant. A page that reads the workspace needs a <Suspense> of
// its own for navigations between these routes (the shell's boundary is above the page segment).
export default function WorkLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
