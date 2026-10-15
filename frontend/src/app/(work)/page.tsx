import { Suspense } from 'react'
import { QueueScreen } from '@/components/queue/queue-screen'

// The queue reads its filters from the URL (useSearchParams), so it renders below a Suspense boundary.
export default function QueuePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading the queue…</p>}>
      <QueueScreen />
    </Suspense>
  )
}
