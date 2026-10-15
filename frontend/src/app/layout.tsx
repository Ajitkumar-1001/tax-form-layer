import type { Metadata } from 'next'
import { DM_Sans, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceProvider } from '@/components/workspace'
import './globals.css'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Workpaper · Okafor-Lindqvist 2025',
  description: 'A web-native tax workpaper: the sealed packet plus an append-only log of everything people do.',
}

// One WorkspaceProvider for every route (staff shell and client portal); it bootstraps in the browser but renders
// its children from the server render on, so every route segment is in the static shell and Next.js can validate
// instant navigation. What reads the workspace waits under a <Suspense> (useWorkspace in components/workspace).
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`h-full antialiased font-sans ${geistMono.variable} ${dmSans.variable}`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </TooltipProvider>
        {/* Offsets clear the sticky gate bar (one line on desktop, two on phones). */}
        <Toaster position="bottom-right" offset={{ bottom: 44, right: 16 }} mobileOffset={{ bottom: 56 }} />
      </body>
    </html>
  )
}
