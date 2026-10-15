import type { ReactNode } from 'react'
import { PortalShell } from '@/components/client/portal-shell'

// Client portal: no staff shell. The root layout already mounts <WorkspaceProvider>, which mounts the
// ActHostProvider (act dialogs), so this layout only adds the portal frame. Static: data loads in the browser.
export default function ClientLayout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>
}
