'use client'
// The tour: mounted once from the staff layout (tour-loader.tsx, inside tour-boundary.tsx), so it outlives moving between staff
// screens and comes first in the page's tab order. It reads the stored state (store.ts), shows the card that state calls for,
// takes the visitor to each stop's page, and keeps the write guard (guard.ts) on while a stop is up. It reads nothing from the
// workspace, so it never waits for the app.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ClosingCard, StepCard, WelcomeCard } from './cards'
import { setTourOpen } from './guard'
import { backTour, decodePath, lockOpen, nextTour, parseTour, phaseOf, routeOf, skipTour, startTour, tourVisible } from './machine'
import { closeTour, openTour, readTourEngaged, readTourRaw, subscribeTour, writeTour } from './store'
import { STEPS, TOUR_ENABLED } from './steps'
import { TourRing } from './tour-ring'

// undefined on the server: nothing is rendered there (and the host only loads in the browser anyway).
const serverRaw = (): string | null | undefined => undefined
const serverEngaged = (): boolean => false

// Every way of ending the tour (Skip, Close, Escape, "Explore on my own", "Not now") unmounts the card with focus on one of its
// buttons, which drops focus to <body> and loses the visitor's place. Put it on the page's main region (tabIndex -1, no outline).
function dismiss(): void {
  closeTour()
  requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true }))
}

export function TourHost() {
  const raw = useSyncExternalStore<string | null | undefined>(subscribeTour, readTourRaw, serverRaw)
  const engaged = useSyncExternalStore(subscribeTour, readTourEngaged, serverEngaged)
  const router = useRouter()
  const pathname = usePathname()

  const stored = parseTour(raw ?? null)
  const phase = phaseOf(stored, engaged)
  const ctx = { enabled: TOUR_ENABLED, hydrated: raw !== undefined, pathname }
  const visible = tourVisible(ctx)
  const open = lockOpen(phase, ctx)
  const stop = visible && phase.kind === 'step' ? phase.step : null
  const href = stop ? stop.href : null

  // The write guard follows the tour: on while a stop or the closing card is up, off the moment it closes or unmounts.
  useEffect(() => {
    setTourOpen(open)
    return () => setTourOpen(false)
  }, [open])

  // Take the visitor to the stop's page when the stop changes, and only then: not because the host mounted (coming back from
  // the client portal must not undo the page the visitor chose). Compared with the whole address, because the query can matter
  // (/documents?unlanded=1). Only while engaged: a tour left over from an earlier visit never moves anyone.
  const pushed = useRef<string | null>(href)
  useEffect(() => {
    if (phase.kind !== 'step') {
      pushed.current = null
      return
    }
    if (!href || pushed.current === href) return
    pushed.current = href
    if (location.pathname + location.search !== href) router.push(href)
  }, [href, phase.kind, router])

  // Was the visitor on this stop's page and has left it (Back, a link in the page)? Only then does the card say so: while a
  // stop is still on its way, the page is simply not there yet.
  const onStop = !href || decodePath(pathname) === routeOf(href)
  const stopId = stop ? stop.id : null
  const [arrived, setArrived] = useState<string | null>(null)
  useEffect(() => {
    if (!stopId || !onStop) return
    const t = setTimeout(() => setArrived(stopId), 0)
    return () => clearTimeout(t)
  }, [stopId, onStop])
  const away = stopId !== null && arrived === stopId && !onStop

  // ?tour=1 starts the tour and ?tour=0 turns it off for this browser; either way the parameter leaves the address. Not on the
  // client portal (no tour there), and not when the tour is switched off.
  useEffect(() => {
    if (!TOUR_ENABLED || location.pathname.startsWith('/client')) return
    const params = new URLSearchParams(location.search)
    const flag = params.get('tour')
    if (flag !== '1' && flag !== '0') return
    params.delete('tour')
    const rest = params.toString()
    // null, not history.state: Next keeps its router state in history.state, and handing it back makes Next skip syncing the
    // address, so any screen that rebuilds its URL from the search params would bring ?tour back.
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
    writeTour(flag === '1' ? startTour() : skipTour())
  }, [])

  // Escape for a visitor who clicked into the page (inside the card the card handles it). Only when nothing but the page itself
  // has focus (clicking text focuses <main> or a [data-focus-return] container, both tabIndex -1) and nothing else took the key: a menu, dialog or field
  // keeps its own Escape.
  const showing = visible && phase.kind !== 'off'
  useEffect(() => {
    if (!showing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      const active = document.activeElement
      if (active && active !== document.body && active.id !== 'main' && !active.matches('[data-focus-return]')) return
      dismiss()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [showing])

  if (!visible) return null
  if (phase.kind === 'welcome') return <WelcomeCard stops={STEPS.length} onStart={openTour} onSkip={dismiss} />
  if (phase.kind === 'resume') {
    return (
      <WelcomeCard
        stops={STEPS.length}
        resume={{ index: phase.index, title: phase.step.title, onResume: () => writeTour(stored) }}
        onStart={openTour}
        onSkip={dismiss}
      />
    )
  }
  if (phase.kind === 'step') {
    return (
      <>
        <TourRing key={phase.step.id} selector={phase.step.anchor} href={phase.step.href} />
        <StepCard
          step={phase.step}
          index={phase.index}
          total={STEPS.length}
          focusNext={engaged}
          away={away}
          onBack={() => writeTour(backTour(stored))}
          onNext={() => writeTour(nextTour(stored))}
          onClose={dismiss}
          onReturn={() => router.push(phase.step.href)}
        />
      </>
    )
  }
  if (phase.kind === 'end') {
    return <ClosingCard focusClose={engaged} onBack={() => writeTour(backTour(stored))} onReplay={openTour} onClose={dismiss} />
  }
  return null
}
