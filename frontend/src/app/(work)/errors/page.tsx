import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ErrorsPage } from '@/components/handin/errors-page'

export const metadata: Metadata = { title: 'Errors · Workpaper' }

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading errors…</p>}>
      <ErrorsPage />
    </Suspense>
  )
}
