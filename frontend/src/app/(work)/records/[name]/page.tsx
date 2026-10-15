import type { Metadata } from 'next'
import { RECORDS, recordInfo } from '@/components/records/registry'
import { notFound } from 'next/navigation'
import { AppLoader } from '@/components/app-loader'

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
  return <AppLoader screen="record" name={name} />
}
