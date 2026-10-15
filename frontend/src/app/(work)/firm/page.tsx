import type { Metadata } from 'next'
import { Suspense } from 'react'
import { FirmPage } from '@/components/firm/firm-page'

export const metadata: Metadata = { title: 'Firm · Workpaper' }

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading firm…</p>}>
      <FirmPage />
    </Suspense>
  )
}
