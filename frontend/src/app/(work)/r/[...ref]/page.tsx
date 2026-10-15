import type { Metadata } from 'next'
import { AppLoader } from '@/components/app-loader'

// Static metadata: params in generateMetadata() would block prefetching the route.
export const metadata: Metadata = { title: 'Trace · Workpaper' }

// Refs are open-ended (every claim, page, read, act, finding), so the screen reads its ref in the browser
// (components/trace/trace-route.tsx) and this page stays a static shell.
export default function Page() {
  return <AppLoader screen="trace" />
}
