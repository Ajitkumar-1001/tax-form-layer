'use client'
// The one door from the staff layout (a server component) to the tour. The cards and the host are their own chunk, fetched
// after the app has mounted, so they never hold up the first paint or the static shell (the small core the palette and the write
// guard share, the script, state and store, is in the first load). A plain import(), not next/dynamic: if the
// chunk cannot be fetched (a flaky network, a tab left open across a deploy) the .catch does nothing, whereas next/dynamic's
// Suspense retry during hydration stalled the whole app in that case (tests: the gate's "tour code blocked" scenario).
import { useEffect, useState, type ComponentType } from 'react'
import { TOUR_ENABLED } from './steps'

export function TourLoader() {
  const [Host, setHost] = useState<ComponentType | null>(null)
  useEffect(() => {
    if (!TOUR_ENABLED) return
    let alive = true
    import('./tour-host')
      .then((m) => alive && setHost(() => m.TourHost))
      .catch(() => {
        // the tour is a convenience: without its code there is simply no tour
      })
    return () => {
      alive = false
    }
  }, [])
  return Host ? <Host /> : null
}
