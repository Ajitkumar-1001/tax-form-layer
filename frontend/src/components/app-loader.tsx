'use client'
// The one door from a server route into the app. Pages are thin server components that render <AppLoader screen=…>;
// each screen is imported on demand and browser-only (`ssr: false`): everything it reads (the workspace, the URL's
// search params) exists only in the browser, so there is nothing to prerender and no <Suspense> to place around it.
// `dynamic` shows PageSkeleton while the chunk loads and while the workspace boots.
import dynamic from 'next/dynamic'
import { PageSkeleton } from '@/components/workspace/skeleton'

// next/dynamic reads its options at build time, so each call spells them out as an object literal.
const SCREENS = {
  queue: dynamic(() => import('@/components/queue/queue-screen').then((m) => m.QueueScreen), { ssr: false, loading: PageSkeleton }),
  records: dynamic(() => import('@/components/records/records-index').then((m) => m.RecordsIndex), { ssr: false, loading: PageSkeleton }),
  record: dynamic(() => import('@/components/records/record-view').then((m) => m.RecordView), { ssr: false, loading: PageSkeleton }),
  documents: dynamic(() => import('@/components/records/documents-view').then((m) => m.DocumentsView), { ssr: false, loading: PageSkeleton }),
  compare: dynamic(() => import('@/components/records/compare-view').then((m) => m.CompareView), { ssr: false, loading: PageSkeleton }),
  trace: dynamic(() => import('@/components/trace/trace-route').then((m) => m.TraceRoute), { ssr: false, loading: PageSkeleton }),
  filing: dynamic(() => import('@/components/filing/filing-page').then((m) => m.FilingPage), { ssr: false, loading: PageSkeleton }),
  notice: dynamic(() => import('@/components/filing/notice-page').then((m) => m.NoticePage), { ssr: false, loading: PageSkeleton }),
  firm: dynamic(() => import('@/components/firm/firm-page').then((m) => m.FirmPage), { ssr: false, loading: PageSkeleton }),
  about: dynamic(() => import('@/components/handin/about-page').then((m) => m.AboutPage), { ssr: false, loading: PageSkeleton }),
  errors: dynamic(() => import('@/components/handin/errors-page').then((m) => m.ErrorsPage), { ssr: false, loading: PageSkeleton }),
  portal: dynamic(() => import('@/components/client/client-portal').then((m) => m.ClientPortal), { ssr: false, loading: PageSkeleton }),
}

type NoProps = Exclude<keyof typeof SCREENS, 'record'>

export function AppLoader(props: { screen: NoProps } | { screen: 'record'; name: string }) {
  if (props.screen === 'record') return <SCREENS.record name={props.name} />
  const Screen = SCREENS[props.screen]
  return <Screen />
}
