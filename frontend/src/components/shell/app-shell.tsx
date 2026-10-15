'use client'
// Staff shell: where you are, who you are, when it is, and what blocks filing (spec §3.0).
import { Fragment, Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { CircleCheckIcon, OctagonAlertIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms/ref-link'
import { useWorkspace } from '@/components/workspace/context'
import { PageSkeleton, TopBarSkeleton } from '@/components/workspace/skeleton'
import type { Reason, Stage } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { CommandPalette } from './command-palette'
import { Inbox } from './inbox'
import { Nav } from './nav'
import { RoleSwitcher } from './role-switcher'
import { SeasonClock } from './season-clock'

const STAGE: Record<Stage, { label: string; className: string }> = {
  preparation: { label: 'Preparation', className: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200' },
  review: { label: 'Review', className: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200' },
  partner: { label: 'Partner review', className: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200' },
  approval: { label: 'Client approval', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  filed: { label: 'Filed', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  amending: { label: 'Amending', className: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200' },
}

const GATE_REASONS_SHOWN = 4

// The frame itself reads nothing that loads, so it and the page below it render on the server (Next.js
// validates instant navigation against that render). Each part that reads the workspace waits in its own
// <Suspense>; the one around the page holds pages that wait without a boundary of their own.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <Suspense fallback={<TopBarSkeleton />}>
          <TopBar />
        </Suspense>
        <Suspense fallback={<div className="h-9" />}>
          <Nav />
        </Suspense>
      </header>
      <Suspense>
        <ClientBanner />
      </Suspense>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
      </main>
      <Suspense fallback={<div className="sticky bottom-0 h-7 border-t bg-muted/40" />}>
        <GateBar />
      </Suspense>
    </div>
  )
}

function TopBar() {
  const { model, state, engagement } = useWorkspace()
  const stage = STAGE[state.stage]
  const pill = <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium', stage.className)}>{stage.label}</span>
  // From lg up this is one 48 px row (the queue's sticky claim pane, lg:top-21, assumes 48 + the 36 px nav).
  // Below lg the stage and the clock drop to their own row (order-last) so the title and the controls keep a row
  // to themselves; lg:contents dissolves that row's wrapper and the pill shows beside the title instead.
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 lg:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link href="/" className="min-w-0 truncate text-sm font-semibold tracking-tight" title={model.packet.packet.client_id}>
          {model.packet.packet.name}
        </Link>
        <span className="hidden lg:contents">{pill}</span>
        {engagement !== 'main' && (
          <span className="shrink-0 rounded-full px-2 text-xs text-muted-foreground ring-1 ring-border" title="A fresh copy with its own act log">
            copy {engagement}
          </span>
        )}
      </div>
      <div className="order-last flex w-full items-center gap-2 lg:contents">
        <span className="lg:hidden">{pill}</span>
        <SeasonClock className="flex-1 lg:flex-none" />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <CommandPalette />
        <Inbox />
        <RoleSwitcher />
      </div>
    </div>
  )
}

function ClientBanner() {
  const { viewer } = useWorkspace()
  if (viewer.kind !== 'client') return null
  return (
    <div className="border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      You are acting as {viewer.name}, a client. Clients use the <Link href="/client" className="underline">client portal</Link>; staff
      actions here will be refused.
    </div>
  )
}

function GateBar() {
  const { state, packetSha, engagement } = useWorkspace()
  const gate = state.gates.submit
  const shown = gate.reasons.slice(0, GATE_REASONS_SHOWN)
  const more = gate.reasons.length - shown.length
  return (
    <footer
      className={cn(
        'sticky bottom-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-4 py-1.5 text-xs sm:flex-nowrap',
        gate.ok ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50' : 'bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50',
      )}
    >
      {gate.ok ? (
        <span className="flex items-center gap-1.5">
          <CircleCheckIcon className="size-3.5 shrink-0" />
          <span className="font-medium">Ready to file:</span> every filing gate passes.
          <Link href="/filing" className="underline underline-offset-2">
            Go to filing
          </Link>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <OctagonAlertIcon className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Filing blocked:</span>
          <span className="truncate">
            {shown.length === 0 && 'see the filing desk for the open gates. '}
            {shown.map((r, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                <ReasonLink reason={r} />
              </Fragment>
            ))}
          </span>
          {(more > 0 || shown.length === 0) && (
            <Link href="/filing" className="shrink-0 underline underline-offset-2">
              {more > 0 ? `+${more} more` : 'Filing'}
            </Link>
          )}
        </span>
      )}
      <span className="ml-auto shrink-0 font-mono text-[11px] opacity-70" title="Packet sha-256 · chain head · engagement">
        packet {packetSha.slice(0, 12)} · head #{state.head} · {engagement}
      </span>
    </footer>
  )
}

/** A gate reason links to where it is fixed: a ref (/r/<ref>) or, if it starts with "/", a page. */
function ReasonLink({ reason }: { reason: Reason }) {
  if (!reason.ref) return <>{reason.text}</>
  if (reason.ref.startsWith('/')) {
    return (
      <Link href={reason.ref} className="underline underline-offset-2">
        {reason.text}
      </Link>
    )
  }
  return (
    <RefLink to={reason.ref} className="text-inherit underline">
      {reason.text}
    </RefLink>
  )
}
