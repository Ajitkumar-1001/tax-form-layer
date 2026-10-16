import { Suspense } from 'react'
import type { Metadata } from 'next'
import { RECORDS, recordInfo } from '@/components/records/registry'
import { notFound } from 'next/navigation'
import { AppLoader } from '@/components/app-loader'
import { PageSkeleton } from '@/components/workspace/skeleton'

// Static metadata: params in generateMetadata() would block prefetching the route.
export const metadata: Metadata = { title: 'Record · Workpaper' }

interface Props {
  params: Promise<{ name: string }>
}

export function generateStaticParams(): { name: string }[] {
  return RECORDS.map((r) => ({ name: r.name }))
}

// Reading params is URL data: it sits behind Suspense so the shell stays instant.
async function Record({ params }: Props) {
  const { name } = await params
  if (!recordInfo(name)) notFound()
  return <AppLoader screen="record" name={name} />
}

export default function Page({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Record params={params} />
    </Suspense>
  )
}
