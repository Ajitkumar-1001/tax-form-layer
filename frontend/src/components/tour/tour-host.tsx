'use client'
// The tour: mounted once from the root layout (tour-loader.tsx, inside tour-boundary.tsx), so it outlives moving between staff
// screens. It reads the stored state (store.ts), shows the card that state calls for, takes the visitor to each stop's page,
// and keeps the write guard (guard.ts) on while it is up. It reads nothing from the workspace, so it never waits for the app.
import { useEffect, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ClosingCard, StepCard, WelcomeCard } from './cards'
import { setTourOpen } from './guard'
import { backTour, nextTour, parseTour, phaseOf, skipTour, startTour } from './machine'
import { readTourEngaged, readTourRaw, subscribeTour, writeTour } from './store'
import { STEPS, TOUR_ENABLED } from './steps'
import { TourRing } from './tour-ring'

// undefined on the server: nothing is rendered there (and the host only loads in the browser anyway).
const serverRaw = (): string | null | undefined => undefined
const serverEngaged = (): boolean => false

export function TourHost() {
  const raw = useSyncExternalStore<string | null | undefined>(subscribeTour, readTourRaw, serverRaw)
  const engaged = useSyncExternalStore(subscribeTour, readTourEngaged, serverEngaged)
  const router = useRouter()
  const pathname = usePathname()

  const stored = parseTour(raw ?? null)
  const phase = phaseOf(stored, engaged)
  // The client portal has its own shell and no tour. A switched-off tour (TOUR_ENABLED) shows nothing and guards nothing.
  const visible = TOUR_ENABLED && raw !== undefined && !pathname.startsWith('/client')
  const open = visible && (phase.kind === 'step' || phase.kind === 'end')
  const href = visible && phase.kind === 'step' ? phase.step.href : null

  // The write guard follows the tour: on while a stop or the closing card is up, off the moment it closes or unmounts.
  useEffect(() => {
    setTourOpen(open)
    return () => setTourOpen(false)
  }, [open])

  // Take the visitor to the stop's page when the stop changes. Compared with the whole address, because the query can
  // matter (/documents?unlanded=1). Only while engaged: a tour left over from an earlier visit never moves anyone.
  useEffect(() => {
    if (href && location.pathname + location.search !== href) router.push(href)
  }, [href, router])

  // ?tour=1 starts the tour and ?tour=0 turns it off for this browser; either way the parameter leaves the address.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const flag = params.get('tour')
    if (flag !== '1' && flag !== '0') return
    params.delete('tour')
    const rest = params.toString()
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
    writeTour(flag === '1' ? startTour() : skipTour())
  }, [])

  if (!visible) return null
  if (phase.kind === 'welcome') return <WelcomeCard stops={STEPS.length} onStart={() => writeTour(startTour())} onSkip={() => writeTour(skipTour())} />
  if (phase.kind === 'resume') {
    return (
      <WelcomeCard
        stops={STEPS.length}
        resume={{ index: phase.index, title: phase.step.title }}
        onStart={() => writeTour(startTour())}
        onResume={() => writeTour(stored)}
        onSkip={() => writeTour(skipTour())}
      />
    )
  }
  if (phase.kind === 'step') {
    return (
      <>
        <TourRing selector={phase.step.anchor} stopId={phase.step.id} />
        <StepCard
          step={phase.step}
          index={phase.index}
          total={STEPS.length}
          focusNext={engaged}
          onBack={() => writeTour(backTour(stored))}
          onNext={() => writeTour(nextTour(stored))}
          onClose={() => writeTour(skipTour())}
        />
      </>
    )
  }
  if (phase.kind === 'end') {
    return <ClosingCard focusClose={engaged} onBack={() => writeTour(backTour(stored))} onReplay={() => writeTour(startTour())} onClose={() => writeTour(skipTour())} />
  }
  return null
}
