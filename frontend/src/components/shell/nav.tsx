'use client'
import { Fragment, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BugIcon, Building2Icon, FileTextIcon, GitCompareIcon, InfoIcon, ListTodoIcon, MailWarningIcon, SendIcon, TableIcon, UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// The icons show in the rail (rail.tsx, alone from lg, beside the label from xl) and in the command palette ("Go to").
export const NAV = [
  { href: '/', label: 'Queue', icon: ListTodoIcon },
  { href: '/documents', label: 'Documents', icon: FileTextIcon },
  { href: '/records', label: 'Records', icon: TableIcon },
  { href: '/compare', label: 'Compare', icon: GitCompareIcon },
  { href: '/filing', label: 'Filing', icon: SendIcon },
  { href: '/firm', label: 'Firm', icon: Building2Icon },
  { href: '/notice', label: 'Notice', icon: MailWarningIcon },
  { href: '/client', label: 'Client view', icon: UserIcon },
  { href: '/errors', label: 'Errors', icon: BugIcon },
  { href: '/about', label: 'About', icon: InfoIcon },
] as const

// The tabs from here on are not the workflow: the client's own portal and the hand-in pages. A divider sets them apart.
const FIRST_META = '/client'

// On a narrow screen the dock scrolls: centre the current tab. Not scrollIntoView, which would also move the browser's
// "sequential focus navigation starting point" to this tab, so the first Tab key press would skip the skip link.
function centreIn(tab: HTMLElement) {
  const dock = tab.closest('ul')
  if (!dock || dock.scrollWidth <= dock.clientWidth) return
  const left = tab.getBoundingClientRect().left - dock.getBoundingClientRect().left + dock.scrollLeft
  dock.scrollLeft = left - (dock.clientWidth - tab.offsetWidth) / 2
}

/** Whether `href` is the screen at `pathname` (a screen owns its sub-paths; the queue is "/" alone). */
export function isCurrent(href: string, pathname: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

/** A ref callback for the current item. Its `[data-pill]` (origin top left) is in the server render too, so the first
 *  paint is right without script; this only plays the move from the previous item, transform only, with the Web
 *  Animations API. Works along either axis: the phone row slides sideways, the rail (rail.tsx) up and down. */
export function usePillSlide(onArrive?: (item: HTMLElement) => void) {
  const previous = useRef<HTMLElement | null>(null)
  return (item: HTMLElement | null) => {
    if (!item) return
    onArrive?.(item)
    const from = previous.current
    previous.current = item
    const pill = item.querySelector<HTMLElement>('[data-pill]')
    if (!from || from === item || !pill || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = from.getBoundingClientRect()
    const b = item.getBoundingClientRect()
    if (!a.width || !b.width) return // not laid out: the phone row stays mounted but hidden from lg, and the rail below lg
    pill.animate(
      [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }, { transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    )
  }
}

// The menu row below lg, where the rail (rail.tsx) does not show. The current tab sits on a lit plate that slides over
// from the previous tab. usePathname suspends while prerendering a dynamic route (/r/[ref]); the shell wraps this in <Suspense>.
export function Nav() {
  const pathname = usePathname()
  const arrive = usePillSlide(centreIn)

  return (
    <nav aria-label="Workpaper" className="flex min-w-0 flex-1 items-start">
      {/* -ml-3 puts the first tab's label on the title's edge. */}
      <ul className="-ml-3 flex max-w-[calc(100%+0.75rem)] items-center gap-0.5 overflow-x-auto py-1 text-[13px] max-lg:pointer-coarse:py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV.map((n) => {
          const active = isCurrent(n.href, pathname)
          return (
            <Fragment key={n.href}>
              {n.href === FIRST_META && <li aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/20" />}
              <li className="shrink-0">
                <Link
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  ref={active ? arrive : undefined}
                  className={cn(
                    'relative isolate flex h-8 items-center rounded-lg px-3 font-medium whitespace-nowrap text-foreground/65 outline-none transition-colors duration-200 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground motion-reduce:transition-none max-lg:pointer-coarse:h-11 max-lg:pointer-coarse:px-4',
                    active && 'text-foreground hover:bg-transparent',
                  )}
                >
                  {/* The plate carries its lit bar, so the slide moves both. */}
                  {active && (
                    <span aria-hidden data-pill className="absolute inset-0 -z-10 origin-top-left rounded-lg bg-foreground/[0.09] ring-1 ring-inset ring-foreground/15">
                      <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-primary" />
                    </span>
                  )}
                  {n.label}
                </Link>
              </li>
            </Fragment>
          )
        })}
      </ul>
    </nav>
  )
}
