import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CompareView } from '@/components/records/compare-view'

export const metadata: Metadata = { title: 'Compare · Workpaper' }

// The view reads ?a=&b=&since= with useSearchParams, so it renders under Suspense.
export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading compare…</p>}>
      <CompareView />
    </Suspense>
  )
}
