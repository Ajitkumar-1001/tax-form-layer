import type { Metadata } from 'next'
import { Suspense } from 'react'
import { DocumentsView } from '@/components/records/documents-view'

export const metadata: Metadata = { title: 'Documents · Workpaper' }

// The view reads ?unlanded= and ?area= with useSearchParams, so it renders under Suspense.
export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading documents…</p>}>
      <DocumentsView />
    </Suspense>
  )
}
