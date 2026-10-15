'use client'
// The /r/<ref> screen. The ref comes from the pathname rather than the page's `params` promise, so the server
// page stays a static shell and needs no boundary of its own (the loader renders this browser-only).
import { usePathname } from 'next/navigation'
import { ClaimPane } from './claim-pane'
import { decodeRefParam } from './resolve'

export function TraceRoute() {
  const ref = decodeRefParam(usePathname().replace(/^\/r\//, '').split('/'))
  return <ClaimPane key={ref} claimRef={ref} />
}
