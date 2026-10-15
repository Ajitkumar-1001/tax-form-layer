import type { Metadata } from 'next'
import { Suspense } from 'react'
import { NoticePage } from '@/components/filing/notice-page'

export const metadata: Metadata = { title: 'Notice · Workpaper' }

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading notice…</p>}>
      <NoticePage />
    </Suspense>
  )
}
