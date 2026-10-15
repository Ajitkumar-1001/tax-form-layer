import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AboutPage } from '@/components/handin/about-page'

export const metadata: Metadata = { title: 'About · Workpaper' }

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading about…</p>}>
      <AboutPage />
    </Suspense>
  )
}
