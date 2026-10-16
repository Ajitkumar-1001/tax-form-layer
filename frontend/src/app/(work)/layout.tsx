import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { TourBoundary } from '@/components/tour/tour-boundary'
import { TourLoader } from '@/components/tour/tour-loader'

// Staff routes. The WorkspaceProvider is mounted once in the root layout (shared with /client);
// this adds the top bar, navigation and gate bar. Static: all data loads in the browser. The shell frame and
// the page render on the server; the parts that read the workspace wait in their own <Suspense> (AppShell), so
// navigations into these routes validate as instant. Pages render <AppLoader>, which loads the screen in the browser.
// The guided tour (components/tour) is first, so its card is the first stop in the tab order; its cards are fixed, so it takes
// no room, and it is not in the client portal's layout, which has no tour.
export default function WorkLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TourBoundary>
        <TourLoader />
      </TourBoundary>
      <AppShell>{children}</AppShell>
    </>
  )
}
