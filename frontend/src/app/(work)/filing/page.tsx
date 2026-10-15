import type { Metadata } from 'next'
import { Suspense } from 'react'
import { FilingPage } from '@/components/filing/filing-page'

export const metadata: Metadata = { title: 'Filing · Workpaper' }

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading filing desk…</p>}>
      <FilingPage />
    </Suspense>
  )
}
