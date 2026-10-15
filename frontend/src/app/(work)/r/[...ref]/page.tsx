import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ClaimPane } from '@/components/trace/claim-pane'
import { decodeRefParam } from '@/components/trace/resolve'

// Static metadata: params in generateMetadata() would block prefetching the route.
export const metadata: Metadata = { title: 'Trace · Workpaper' }

interface Props {
  params: Promise<{ ref: string[] }>
}

// Refs are open-ended (every claim, page, read, act, finding), so params are runtime data: read them
// inside <Suspense> and keep the static shell. Each segment is URI-encoded (refs hold ':' '#' '/').
export default function Page({ params }: Props) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading trace…</div>}>
      {params.then(({ ref }) => {
        const decoded = decodeRefParam(ref)
        return <ClaimPane key={decoded} claimRef={decoded} />
      })}
    </Suspense>
  )
}
