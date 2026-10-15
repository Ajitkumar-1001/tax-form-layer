import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RecordView } from '@/components/records/record-view'
import { RECORDS, recordInfo } from '@/components/records/registry'

// Static metadata: params in generateMetadata() would block prefetching the route.
export const metadata: Metadata = { title: 'Record · Workpaper' }

interface Props {
  params: Promise<{ name: string }>
}

// Every record name is known at build time, so params resolve during prerendering (no Suspense needed).
export function generateStaticParams(): { name: string }[] {
  return RECORDS.map((r) => ({ name: r.name }))
}

export default async function Page({ params }: Props) {
  const { name } = await params
  if (!recordInfo(name)) notFound()
  return <RecordView name={name} />
}
