'use client'
// Staff shell: where you are, who you are, when it is, and what blocks filing (spec §3.0).
import { Fragment, Suspense, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { CircleCheckIcon, OctagonAlertIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms/ref-link'
import { staffRedirect } from '@/components/workspace/client-gate'
import { useWorkspace } from '@/components/workspace/context'
import { PageSkeleton, TopBarSkeleton } from '@/components/workspace/skeleton'
import { plainMasked } from '@/lib/model/mask-token'
import type { Reason } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { CommandPalette } from './command-palette'
import { Inbox } from './inbox'
import { Nav } from './nav'
import { ClaimSpectrum, Rail, StageMeter } from './rail'
import { RailToggle, useRailShortcut } from './rail-toggle'
import { spectrum } from './return-state'
import { RoleSwitcher } from './role-switcher'
import { SeasonClock } from './season-clock'
import { ShortcutHelp } from './shortcut-help'

const GATE_REASONS_SHOWN = 4

// The frame itself reads nothing that loads, so it and the page below it render on the server (Next.js
// validates instant navigation against that render). Each part that reads the workspace waits in its own
// <Suspense>. Every route renders <AppLoader> (components/app-loader.tsx), which brings its own browser-only boundary,
// so the one around the page is a guard only: a page that reads the workspace directly waits here, not in the whole app.
//
// From lg: the dark rail (rail.tsx) and a dark 56 px top bar frame the light page; the top bar's centre is the season
// (season-clock.tsx). Below lg there is no rail: the header adds a menu row, the claim spectrum on its edge, and the
// gate bar sits at the foot. `dark` scopes the dark tokens to the chrome; popovers portal out and stay light.
export function AppShell({ children }: { children: ReactNode }) {
  useRailShortcut()
  return (
    <div className="flex min-h-svh flex-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-foreground"
      >
        Skip to content
      </a>
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The queue's claim drawer and sticky bulk bar (lg:top-14) assume the 56 px top bar from lg. Hidden in print: the
            printed workpaper is the report, not the app chrome. */}
        <header className="dark sticky top-0 z-40 bg-background text-foreground [color-scheme:dark] print:hidden">
          <Suspense fallback={<TopBarSkeleton />}>
            <TopBar />
          </Suspense>
          <div className="flex h-12 items-start px-4 max-lg:pointer-coarse:h-14 lg:hidden">
            <Suspense fallback={<div className="flex-1" />}>
              <Nav />
            </Suspense>
          </div>
          <Suspense>
            <HeaderSpectrum />
          </Suspense>
        </header>
        <Suspense>
          <ClientGate />
          <ClientBanner />
        </Suspense>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 scroll-mt-44 outline-none lg:scroll-mt-20">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
        <Suspense fallback={<div className="sticky bottom-0 h-7 border-t bg-muted/40 lg:hidden" />}>
          <GateBar />
        </Suspense>
      </div>
    </div>
  )
}

function TopBar() {
  const { model, state, engagement } = useWorkspace()
  // From lg one 56 px row, the rail's toggle at its left. The title leads it whenever the rail shows icons only (when the
  // rail is labelled, it carries the title: rail-wide), so the name shows exactly once. The season fills the row from xl
  // (beside the title when the rail is collapsed) and whenever the title is away.
  // Below lg the stage and the clock drop to their own row (order-last) so the title and the controls keep a row to
  // themselves; lg:contents dissolves that row's wrapper.
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 lg:h-14 lg:flex-nowrap lg:gap-x-4 lg:py-0 xl:px-6">
      <RailToggle placement="topbar" />
      <div className="flex min-w-0 flex-1 items-center gap-3 xl:flex-initial rail-wide:hidden">
        <Link
          href="/about"
          className="flex min-w-0 items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground"
          title={model.packet.packet.client_id}
        >
          <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">{model.packet.packet.name}</span>
        </Link>
        {engagement !== 'main' && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground ring-1 ring-inset ring-foreground/10" title="A fresh copy with its own act log">
            {engagement}
          </span>
        )}
      </div>
      <div className="order-last flex w-full items-center gap-3 lg:contents">
        <span className="lg:hidden">
          <StageMeter stage={state.stage} marks="hidden sm:flex" />
        </span>
        <SeasonClock className="flex-1 lg:flex-none xl:flex-1 rail-wide:flex-1" />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <CommandPalette />
        <ShortcutHelp />
        <Inbox />
        <RoleSwitcher />
      </div>
    </div>
  )
}

// Below lg the claim spectrum runs along the header's bottom edge; from lg it sits in the rail's foot.
function HeaderSpectrum() {
  const { state } = useWorkspace()
  return <ClaimSpectrum parts={spectrum(state).parts} className="absolute inset-x-0 bottom-0 h-[3px] lg:hidden" />
}

// A client who opens a staff route directly goes to the portal (switching identity does the same in provider.tsx).
// UX only: authorize() still refuses every staff act a client posts.
function ClientGate() {
  const { viewer } = useWorkspace()
  const pathname = usePathname()
  const router = useRouter()
  const to = staffRedirect(viewer, pathname)
  useEffect(() => {
    if (to) router.replace(to)
  }, [to, router])
  return null
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

// Below lg only: from lg the rail's foot carries the gate (rail.tsx). Not on /overview or /filing: their own sections list
// the same reasons.
function GateBar() {
  const pathname = usePathname()
  const { state, packetSha, engagement } = useWorkspace()
  if (pathname === '/overview' || pathname === '/filing') return null
  const gate = state.gates.submit
  const shown = gate.reasons.slice(0, GATE_REASONS_SHOWN)
  const more = gate.reasons.length - shown.length
  return (
    <footer
      className={cn(
        'sticky bottom-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-4 py-1.5 text-xs sm:flex-nowrap lg:hidden',
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
  if (!reason.ref) return <>{plainMasked(reason.text)}</>
  if (reason.ref.startsWith('/')) {
    return (
      <Link href={reason.ref} className="underline underline-offset-2">
        {plainMasked(reason.text)}
      </Link>
    )
  }
  return (
    <RefLink to={reason.ref} className="text-inherit underline">
      {plainMasked(reason.text)}
    </RefLink>
  )
}
