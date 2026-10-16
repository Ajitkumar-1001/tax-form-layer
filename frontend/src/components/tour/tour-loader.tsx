'use client'
// The one door from the root layout (a server component) to the tour. The engine is its own chunk, fetched after the app has
// mounted, so it adds nothing to the first load and nothing to the static shell. A plain import(), not next/dynamic: if the
// chunk cannot be fetched (a flaky network, a tab left open across a deploy) the .catch does nothing, whereas next/dynamic's
// Suspense retry during hydration stalled the whole app in that case (tests: the gate's "tour code blocked" scenario).
import { useEffect, useState, type ComponentType } from 'react'

export function TourLoader() {
  const [Host, setHost] = useState<ComponentType | null>(null)
  useEffect(() => {
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
