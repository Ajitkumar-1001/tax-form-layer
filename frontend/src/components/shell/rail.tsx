'use client'
// The rail (lg up): the return and its stage, the screens grouped by the work they serve, and the return's state at the
// foot. Icons alone from lg, labels from xl, unless the person chose otherwise (rail-toggle.tsx: <html data-rail>, read by
// the rail-wide / rail-narrow variants in globals.css). Below lg the header's own rows stand in for it (app-shell.tsx, nav.tsx).
//
// Inside the rail, respond to the rail's own width (@min-[12rem] / @max-[12rem]: 12rem sits between its 4rem and 15rem
// forms), never to the viewport's: the same rail is 64 px wide below xl, and from xl when collapsed.
import { Suspense, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleCheckIcon, ClipboardCheckIcon, OctagonAlertIcon } from 'lucide-react'
import { useWorkspace } from '@/components/workspace/context'
import { plainMasked } from '@/lib/model/mask-token'
import type { Stage } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { isCurrent, NAV, usePillSlide } from './nav'
import { RailToggle } from './rail-toggle'
import { spectrum, type SpectrumKey, type SpectrumPart, STAGES } from './return-state'

type Href = (typeof NAV)[number]['href']

// Client view, Errors and About are not the workflow: the last group has no heading and sits apart.
const GROUPS: { label?: string; hrefs: Href[] }[] = [
  { label: 'Work', hrefs: ['/overview', '/queue', '/documents', '/records', '/compare'] },
  { label: 'Sign and file', hrefs: ['/filing', '/notice'] },
  { label: 'Admin', hrefs: ['/firm'] },
  { hrefs: ['/client', '/errors', '/about'] },
]

// Dark like the top bar, so the two frame the light page. Each part that reads the workspace or the URL waits in its own
// <Suspense>, like the header's. Sticky at full height; the list scrolls on its own when the window is short. Collapsed,
// it stays 64 px of icons from xl too: only its width changes (rail-wide, set before the first paint), it never unmounts.
export function Rail() {
  return (
    <aside
      id="rail"
      className="dark @container sticky top-0 z-30 hidden h-svh w-16 shrink-0 flex-col overflow-hidden bg-background text-foreground transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [color-scheme:dark] motion-reduce:transition-none lg:flex rail-wide:w-60 print:hidden"
    >
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
    <div className="flex flex-col gap-3 px-4 pb-3">
      {/* The first row is the top bar's height, so it reads as one band with it: the mark and the app's name. The return
          follows below on its own lines (it wraps instead of truncating). */}
      <Link
        href="/about"
        className="group/home flex h-14 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground"
      >
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform duration-200 group-hover/home:scale-105 motion-reduce:transition-none">
          <ClipboardCheckIcon className="size-4" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap transition-opacity duration-200 @max-[12rem]:opacity-0 motion-reduce:transition-none">Workpaper</span>
      </Link>
      <p className="hidden text-[13px] leading-snug font-medium text-foreground/85 @min-[12rem]:block" title={model.packet.packet.client_id}>
        {model.packet.packet.name}
      </p>
      {/* Wide: the stage chip. Narrow: its marks alone, stood upright. */}
      <span className="hidden @min-[12rem]:flex">
        <StageMeter stage={state.stage} marks="flex" />
      </span>
      <span title={`Return stage: ${STAGES[at].label}`} className="flex flex-col items-center gap-1 @min-[12rem]:hidden">
        <span className="sr-only">Return stage: {STAGES[at].label}</span>
        {STAGES.map((s, i) => (
          <span key={s.key} aria-hidden className={cn('w-1.5 rounded-full', i === at ? 'h-4 bg-foreground' : i < at ? 'h-1.5 bg-foreground/55' : 'h-1.5 bg-foreground/20')} />
        ))}
      </span>
      {engagement !== 'main' && (
        <span className="hidden w-fit rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground ring-1 ring-inset ring-foreground/10 @min-[12rem]:block" title="A fresh copy with its own act log">
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
          {g.label && (
            <div className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] @max-[12rem]:grid-rows-[0fr] @max-[12rem]:opacity-0 motion-reduce:transition-none">
              <div className="min-h-0 overflow-hidden">
                <p className="px-3 pb-1 text-xs whitespace-nowrap text-foreground/55">{g.label}</p>
              </div>
            </div>
          )}
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
                      'relative isolate flex h-8 items-center gap-3 pointer-coarse:h-11 rounded-lg px-3 text-[13px] font-medium text-foreground/65 outline-none transition-colors duration-200 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none ',
                      active && 'text-foreground hover:bg-transparent',
                    )}
                  >
                    {active && (
                      <span aria-hidden data-pill className="absolute inset-0 -z-10 origin-top-left rounded-lg bg-foreground/[0.09]">
                        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />
                      </span>
                    )}
                    <n.icon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate whitespace-nowrap transition-opacity duration-200 @max-[12rem]:opacity-0 motion-reduce:transition-none">{n.label}</span>
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
  const { parts, total } = spectrum(state)
  const count = (key: SpectrumKey) => parts.find((p) => p.key === key)?.count ?? 0
  const gate = state.gates.submit
  const reviewed = count('checked') + count('corrected')
  const gateText = gate.ok ? 'Ready to file' : `Filing blocked: ${gate.reasons.length} ${gate.reasons.length === 1 ? 'reason' : 'reasons'}`
  return (
    <div className="flex flex-col gap-3 px-6 pt-3 pb-4 text-xs text-foreground/70 transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none @min-[12rem]:px-4">
      <ClaimSpectrum parts={parts} className="h-1.5 overflow-hidden rounded-full" />
      <div className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] @max-[12rem]:grid-rows-[0fr] @max-[12rem]:opacity-0 motion-reduce:transition-none">
        <p className="min-h-0 overflow-hidden leading-relaxed whitespace-nowrap tabular-nums">
          <span className="text-[13px] font-semibold text-foreground">{count('open')}</span> open ·{' '}
          <span className="text-[13px] font-semibold text-foreground">{reviewed}</span> of {total} reviewed
        </p>
      </div>
      <Link
        href="/filing"
        title={gate.ok ? 'Every filing gate passes' : gate.reasons.map((r) => plainMasked(r.text)).join('\n')}
        className={cn(
          'flex items-center gap-2 rounded-lg outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground',
          gate.ok ? 'text-success' : 'text-warning',
        )}
      >
        {gate.ok ? <CircleCheckIcon aria-hidden className="size-4 shrink-0" /> : <OctagonAlertIcon aria-hidden className="size-4 shrink-0" />}
        <span className="font-medium whitespace-nowrap transition-opacity duration-200 @max-[12rem]:opacity-0 motion-reduce:transition-none">{gateText}</span>
      </Link>
      <LiveHead head={state.head} sha={packetSha} />
      <RailToggle placement="rail" />
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

/** One segment per spectrum part (`spectrum(state).parts`), sized by count. The caller sets its size, place and gap. */
export function ClaimSpectrum({ parts, className }: { parts: SpectrumPart[]; className?: string }) {
  const summary = `Claims: ${parts.map((p) => `${p.label} ${p.count}`).join(', ')}`
  return (
    <div role="img" aria-label={summary} title={summary} className={cn('flex gap-px', className)}>
      {parts.map((p) => p.count > 0 && <span key={p.key} className={cn('min-w-px basis-0', p.tone)} style={{ flexGrow: p.count }} />)}
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
    <span className="flex items-center gap-2" title={`Head of the hash-chained act log: act #${head}. Packet sha-256 ${sha.slice(0, 12)}`}>
      <span aria-hidden className="relative grid size-4 shrink-0 place-items-center">
        <span ref={ping} className="absolute inset-1 rounded-full bg-primary" />
        <span className="relative size-2 rounded-full bg-primary" />
      </span>
      <span className="whitespace-nowrap transition-opacity duration-200 @max-[12rem]:opacity-0 motion-reduce:transition-none">
        Live <span className="text-[13px] font-semibold text-foreground tabular-nums">#{head}</span>
      </span>
    </span>
  )
}
