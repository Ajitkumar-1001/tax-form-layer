import type { Metadata } from 'next'
import { Suspense } from 'react'
import { RecordsIndex } from '@/components/records/records-index'

export const metadata: Metadata = { title: 'Records · Workpaper' }

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading records…</p>}>
      <RecordsIndex />
    </Suspense>
  )
}
