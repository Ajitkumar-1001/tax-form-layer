'use client'
// The rail (lg up): the return and its stage, the screens grouped by the work they serve, and the return's state at the
// foot. Icons alone from lg, labels from xl. Below lg the header's own rows stand in for it (app-shell.tsx, nav.tsx).
import { Suspense, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleCheckIcon, ClipboardCheckIcon, OctagonAlertIcon } from 'lucide-react'
import { useWorkspace } from '@/components/workspace/context'
import type { ClaimStatus, Stage } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { isCurrent, NAV, usePillSlide } from './nav'

type Href = (typeof NAV)[number]['href']

// Client view, Errors and About are not the workflow: the last group has no heading and sits apart.
const GROUPS: { label?: string; hrefs: Href[] }[] = [
  { label: 'Work', hrefs: ['/', '/documents', '/records', '/compare'] },
  { label: 'Sign and file', hrefs: ['/filing', '/notice'] },
  { label: 'Admin', hrefs: ['/firm'] },
  { hrefs: ['/client', '/errors', '/about'] },
]

// The return's life, in order: one mark per stage, the current one long.
const STAGES: { key: Stage; label: string }[] = [
  { key: 'preparation', label: 'Preparation' },
  { key: 'review', label: 'Review' },
  { key: 'partner', label: 'Partner review' },
  { key: 'approval', label: 'Client approval' },
  { key: 'filed', label: 'Filed' },
  { key: 'amending', label: 'Amending' },
]

// The claim spectrum, from done to not done: what a person cleared, what a check passed, the rest unreviewed, the
// open claims pinned at the far end. The counts under it use the same colours, so they are its legend.
const SPECTRUM: { label: string; statuses: ClaimStatus[]; tone: string }[] = [
  { label: 'verified', statuses: ['verified', 'accepted'], tone: 'bg-success' },
  { label: 'adjusted', statuses: ['adjusted'], tone: 'bg-warning' },
  { label: 'read OK', statuses: ['read_ok'], tone: 'bg-info/70' },
  { label: 'unreviewed', statuses: ['unreviewed'], tone: 'bg-foreground/10' },
  { label: 'open', statuses: ['open'], tone: 'bg-danger' },
]

// Dark like the top bar, so the two frame the light page. Each part that reads the workspace or the URL waits in its own
// <Suspense>, like the header's. Sticky at full height; the list scrolls on its own when the window is short.
export function Rail() {
  return (
    <aside className="dark sticky top-0 z-30 hidden h-svh w-16 shrink-0 flex-col bg-background text-foreground [color-scheme:dark] lg:flex xl:w-60 print:hidden">
      <Suspense fallback={<div className="h-14" />}>
        <Brand />
      </Suspense>
      <Suspense fallback={<div className="flex-1" />}>
        <RailNav />
      </Suspense>
      <Suspense>
        <ReturnState />
      </Suspense>
    </aside>
  )
}

function Brand() {
  const { model, state, engagement } = useWorkspace()
  const at = Math.max(0, STAGES.findIndex((s) => s.key === state.stage))
  return (
    <div className="flex flex-col gap-3 px-3 pb-3 xl:px-4">
      {/* The first row is the top bar's height, so it reads as one band with it: the mark and the app's name. The return
          follows below on its own lines (it wraps instead of truncating). */}
      <Link
        href="/"
        className="group/home flex h-14 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground max-xl:justify-center"
      >
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform duration-200 group-hover/home:scale-105 motion-reduce:transition-none">
          <ClipboardCheckIcon className="size-4" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight max-xl:sr-only">Workpaper</span>
      </Link>
      <p className="hidden text-[13px] leading-snug font-medium text-foreground/85 xl:block" title={model.packet.packet.client_id}>
        {model.packet.packet.name}
      </p>
      {/* From xl the stage chip; from lg to xl its marks alone, stood upright. */}
      <span className="hidden xl:flex">
        <StageMeter stage={state.stage} marks="flex" />
      </span>
      <span title={`Return stage: ${STAGES[at].label}`} className="flex flex-col items-center gap-1 xl:hidden">
        <span className="sr-only">Return stage: {STAGES[at].label}</span>
        {STAGES.map((s, i) => (
          <span key={s.key} aria-hidden className={cn('w-1.5 rounded-full', i === at ? 'h-4 bg-foreground' : i < at ? 'h-1.5 bg-foreground/55' : 'h-1.5 bg-foreground/20')} />
        ))}
      </span>
      {engagement !== 'main' && (
        <span className="hidden w-fit rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground ring-1 ring-inset ring-foreground/10 xl:block" title="A fresh copy with its own act log">
          {engagement}
        </span>
      )}
    </div>
  )
}

// The current item sits on a plate with a pen-blue bar at its left edge; the plate slides up or down from the previous item.
// usePathname suspends while prerendering a dynamic route (/r/[ref]); the rail wraps this in <Suspense>.
function RailNav() {
  const pathname = usePathname()
  const arrive = usePillSlide()
  return (
    // A thin scrollbar, not a hidden one: on a short window the last group must still show it is there.
    <nav aria-label="Workpaper" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 [scrollbar-width:thin]">
      {GROUPS.map((g) => (
        <div key={g.hrefs[0]} className={cn(!g.label && 'mt-auto')}>
          {g.label && <p className="mb-1 hidden px-3 text-xs text-foreground/55 xl:block">{g.label}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.hrefs.map((href) => {
              const n = NAV.find((item) => item.href === href)!
              const active = isCurrent(href, pathname)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={n.label}
                    aria-current={active ? 'page' : undefined}
                    ref={active ? arrive : undefined}
                    className={cn(
                      'relative isolate flex h-8 items-center gap-3 pointer-coarse:h-11 rounded-lg px-3 text-[13px] font-medium text-foreground/65 outline-none transition-colors duration-200 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none max-xl:justify-center max-xl:px-0',
                      active && 'text-foreground hover:bg-transparent',
                    )}
                  >
                    {active && (
                      <span aria-hidden data-pill className="absolute inset-0 -z-10 origin-top-left rounded-lg bg-foreground/[0.09]">
                        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />
                      </span>
                    )}
                    <n.icon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate max-xl:sr-only">{n.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** The rail's foot: the claim spectrum and its counts, whether filing is blocked, and the head of the act log. */
function ReturnState() {
  const { state, packetSha } = useWorkspace()
  const { total, of } = useSpectrum()
  const gate = state.gates.submit
  const reviewed = of(['verified', 'accepted', 'adjusted'])
  const gateText = gate.ok ? 'Ready to file' : `Filing blocked: ${gate.reasons.length} ${gate.reasons.length === 1 ? 'reason' : 'reasons'}`
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-4 text-xs text-foreground/70 xl:px-4">
      <ClaimSpectrum className="h-1.5 overflow-hidden rounded-full" />
      <p className="hidden leading-relaxed tabular-nums xl:block">
        <span className="text-[13px] font-semibold text-foreground">{of(['open'])}</span> open ·{' '}
        <span className="text-[13px] font-semibold text-foreground">{reviewed}</span> of {total} reviewed
      </p>
      <Link
        href="/filing"
        title={gate.ok ? 'Every filing gate passes' : gate.reasons.map((r) => r.text).join('\n')}
        className={cn(
          'flex items-center gap-2 rounded-lg outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground max-xl:justify-center',
          gate.ok ? 'text-success' : 'text-warning',
        )}
      >
        {gate.ok ? <CircleCheckIcon aria-hidden className="size-4 shrink-0" /> : <OctagonAlertIcon aria-hidden className="size-4 shrink-0" />}
        <span className="font-medium max-xl:sr-only">{gateText}</span>
      </Link>
      <LiveHead head={state.head} sha={packetSha} />
    </div>
  )
}

/** Where the return is in its life: a chip with a mark per stage (the current one long), then its name. `marks` says where the marks show (classes). */
export function StageMeter({ stage, marks }: { stage: Stage; marks: string }) {
  const at = Math.max(0, STAGES.findIndex((s) => s.key === stage))
  return (
    <span className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-muted px-2.5 text-xs ring-1 ring-inset ring-foreground/10">
      <span aria-hidden className={cn('items-center gap-0.5', marks)}>
        {STAGES.map((s, i) => (
          <span key={s.key} className={cn('h-1.5 rounded-full', i === at ? 'w-4 bg-foreground' : i < at ? 'w-1.5 bg-foreground/55' : 'w-1.5 bg-foreground/20')} />
        ))}
      </span>
      <span className="sr-only">Return stage:</span>
      <span className="font-medium whitespace-nowrap text-foreground">{STAGES[at].label}</span>
    </span>
  )
}

function useSpectrum() {
  const { state } = useWorkspace()
  const counts = new Map<ClaimStatus, number>()
  for (const c of Object.values(state.claims)) counts.set(c.status, (counts.get(c.status) ?? 0) + 1)
  const of = (statuses: ClaimStatus[]) => statuses.reduce((n, s) => n + (counts.get(s) ?? 0), 0)
  return { total: Object.keys(state.claims).length, parts: SPECTRUM.map((p) => ({ ...p, count: of(p.statuses) })), of }
}

/** One segment per claim status, sized by count. The caller sets its size and place. */
export function ClaimSpectrum({ className }: { className?: string }) {
  const { parts } = useSpectrum()
  const summary = `Claims: ${parts.map((p) => `${p.count} ${p.label}`).join(', ')}`
  return (
    <div role="img" aria-label={summary} title={summary} className={cn('flex gap-px', className)}>
      {parts.map((p) => p.count > 0 && <span key={p.label} className={cn('min-w-px basis-0', p.tone)} style={{ flexGrow: p.count }} />)}
    </div>
  )
}

/** The head of the hash-chained act log. The dot pings once when a new act lands (the workspace polls every 3 s). */
function LiveHead({ head, sha }: { head: number; sha: string }) {
  const ping = useRef<HTMLSpanElement>(null)
  const seen = useRef(head)
  useEffect(() => {
    if (head === seen.current) return
    seen.current = head
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    ping.current?.animate([{ transform: 'scale(1)', opacity: 0.8 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
  }, [head])
  return (
    <span className="flex items-center gap-2 max-xl:justify-center" title={`Head of the hash-chained act log: act #${head}. Packet sha-256 ${sha.slice(0, 12)}`}>
      <span aria-hidden className="relative grid size-2 shrink-0 place-items-center">
        <span ref={ping} className="absolute inset-0 rounded-full bg-primary" />
        <span className="relative size-2 rounded-full bg-primary" />
      </span>
      <span className="max-xl:sr-only">
        Live <span className="text-[13px] font-semibold text-foreground tabular-nums">#{head}</span>
      </span>
    </span>
  )
}
