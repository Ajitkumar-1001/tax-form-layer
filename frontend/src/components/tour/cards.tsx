'use client'
// The tour's cards: the welcome (a first visit, or a tour left unfinished), a stop, and the closing card. Plain presentation:
// tour-host.tsx decides which one shows. They are docked, not anchored, so a card never depends on finding anything on the page.
import type { KeyboardEvent, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, ArrowRightIcon, CompassIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TourStep } from './steps'

const LINK = 'text-primary underline-offset-3 hover:underline'

// Escape closes the tour; the arrows move through it. Here only while focus is inside the card (the card is a dialog, so the
// queue's single-letter shortcuts stand down there too); the host adds Escape for a visitor who clicked into the page.
function keys(on: { onClose: () => void; onBack?: () => void; onNext?: () => void }) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Escape') on.onClose()
    else if (e.key === 'ArrowRight' && on.onNext) on.onNext()
    else if (e.key === 'ArrowLeft' && on.onBack) on.onBack()
    else return
    e.preventDefault()
  }
}

// Bottom left of the content, beside the rail (rail-narrow: 64 px, rail-wide: 240 px, each plus a 16 px gap), so it covers
// neither the toasts (bottom right) nor the rail's foot. Below lg a full-width sheet above the gate bar (56 px, the toasts'
// mobile offset in app/layout.tsx). z-45: above the header (z-40) and the gate bar (z-30), below dialogs (z-50) and toasts,
// so a dialog the visitor opens stays on top of the tour. It never grows past the room between the header and the gate bar
// (a zoomed or landscape window), scrolling inside instead. In forced colors box shadows vanish, so the edge is an outline.
function Dock({ onKeyDown, children }: { onKeyDown: (e: KeyboardEvent) => void; children: ReactNode }) {
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      onKeyDown={onKeyDown}
      className="fixed bottom-4 left-4 z-45 flex max-h-[calc(100svh-14.5rem)] w-[min(22.5rem,calc(100vw-2rem))] animate-in flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-200 fade-in-0 slide-in-from-bottom-2 max-lg:right-4 max-lg:bottom-14 max-lg:w-auto motion-reduce:animate-none rail-narrow:left-20 rail-wide:left-64 forced-colors:outline forced-colors:outline-[color:CanvasText] print:hidden"
    >
      {children}
    </section>
  )
}

const title = 'font-heading text-base leading-snug font-medium'
const touch = 'pointer-coarse:h-11' // 44 px on touch, as the shell's controls (DESIGN.md section 11)

/** A first visit, or (with `resume`) a tour left unfinished: offered back, never resumed by itself. */
export function WelcomeCard({
  stops,
  resume,
  onStart,
  onSkip,
}: {
  stops: number
  resume?: { index: number; title: string; onResume: () => void }
  onStart: () => void
  onSkip: () => void
}) {
  return (
    <Dock onKeyDown={keys({ onClose: onSkip })}>
      <div className="flex items-start gap-3">
        <CompassIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 id="tour-title" className={title}>
            {resume ? 'Pick up the tour?' : 'Take the tour?'}
          </h2>
          <p id="tour-body" className="text-muted-foreground">
            {resume
              ? `You were on stop ${resume.index + 1} of ${stops}: ${resume.title}.`
              : `${stops} stops through the real app, about five minutes: what it does, why it is different, and where the proof is. The tour only looks; it never changes any data, and while it is open the app is read-only. You can start it again later: open search and type tour.`}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className={touch} onClick={onSkip}>
          {resume ? 'Not now' : 'Explore on my own'}
        </Button>
        {resume ? (
          <>
            <Button variant="outline" size="sm" className={touch} onClick={onStart}>
              Start over
            </Button>
            <Button size="sm" className={touch} onClick={resume.onResume}>
              Resume
            </Button>
          </>
        ) : (
          <Button size="sm" className={touch} onClick={onStart}>
            Take the tour
          </Button>
        )}
      </div>
    </Dock>
  )
}

export function StepCard({
  step,
  index,
  total,
  focusNext,
  away,
  onBack,
  onNext,
  onClose,
  onReturn,
}: {
  step: TourStep
  index: number
  total: number
  /** True once the visitor has pressed something in the tour: only then does focus move to Next (never on a reload). */
  focusNext: boolean
  /** The visitor was on this stop's page and has left it (Back, or a link in the page): the card says so and offers the way back. */
  away: boolean
  onBack: () => void
  onNext: () => void
  onClose: () => void
  onReturn: () => void
}) {
  const last = index === total - 1
  return (
    <Dock onKeyDown={keys({ onClose, onBack, onNext })}>
      <p className="text-xs text-muted-foreground tabular-nums" aria-hidden>
        {index + 1} of {total}
      </p>
      <div className="flex flex-col gap-1">
        <h2 id="tour-title" className={title}>
          {step.title}
        </h2>
        <p id="tour-body" className="text-muted-foreground">
          {step.body}
        </p>
        {step.more && (
          <Link href={step.more.href} className={cn(LINK, 'w-fit pointer-coarse:inline-flex pointer-coarse:h-11 pointer-coarse:items-center')}>
            {step.more.label}
          </Link>
        )}
      </div>
      {away && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <span>You have left this stop.</span>
          <Button variant="outline" size="sm" className={touch} onClick={onReturn}>
            Go back to it
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className={touch} onClick={onClose}>
          Skip tour
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className={touch} onClick={onBack} disabled={index === 0}>
            <ArrowLeftIcon /> Back
          </Button>
          <Button size="sm" className={touch} onClick={onNext} autoFocus={focusNext}>
            {last ? 'Finish' : 'Next'} <ArrowRightIcon />
          </Button>
        </div>
      </div>
      {/* The card keeps its place from stop to stop, so a screen reader is told about each stop here: one string, read whole. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Stop ${index + 1} of ${total}: ${step.title}`}
      </p>
    </Dock>
  )
}

export function ClosingCard({ focusClose, onBack, onReplay, onClose }: { focusClose: boolean; onBack: () => void; onReplay: () => void; onClose: () => void }) {
  return (
    <Dock onKeyDown={keys({ onClose, onBack })}>
      <div className="flex flex-col gap-2">
        <h2 id="tour-title" className={title}>
          That is the tour
        </h2>
        <p id="tour-body" className="text-muted-foreground">
          Read{' '}
          <Link href="/about" className={LINK}>
            About
          </Link>{' '}
          for the idea, what is simulated and how AI was used, and{' '}
          <Link href="/errors" className={LINK}>
            Errors
          </Link>{' '}
          for every problem. Client view, in the rail, shows what the household sees.
        </p>
        <p className="text-xs text-muted-foreground">
          Changes on the shared demo are recorded permanently, and Undo adds another act. To try them, switch to Jo Kimura with the role switcher (top right) and choose Firm, then Fresh copy. A fresh copy stays with this browser for 30 days, or until you choose Back to the shared engagement.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className={touch} onClick={onReplay}>
          Replay
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className={touch} onClick={onBack}>
            <ArrowLeftIcon /> Back
          </Button>
          <Button size="sm" className={touch} onClick={onClose} autoFocus={focusClose}>
            Close
          </Button>
        </div>
      </div>
    </Dock>
  )
}
