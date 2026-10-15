'use client'
import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BugIcon, Building2Icon, FileTextIcon, GitCompareIcon, InfoIcon, ListTodoIcon, MailWarningIcon, SendIcon, TableIcon, UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

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

// The tabs from here on are not the workflow: the client's own portal and the hand-in pages. They sit apart, on the right.
const FIRST_META = '/client'

// On a narrow screen the strip scrolls: centre the current tab. Not scrollIntoView, which would also move the browser's
// "sequential focus navigation starting point" to this tab, so the first Tab key press would skip the skip link.
function centreIn(tab: HTMLElement | null) {
  const strip = tab?.parentElement
  if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return
  const left = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft
  strip.scrollLeft = left - (strip.clientWidth - tab.offsetWidth) / 2
}

// usePathname suspends while prerendering a dynamic route (/r/[ref]); the shell wraps this in <Suspense>.
export function Nav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Workpaper" className="flex h-9 items-end gap-1 overflow-x-auto px-3 text-sm">
      {NAV.map((n) => {
        const active = n.href === '/' ? pathname === '/' : pathname === n.href || pathname.startsWith(`${n.href}/`)
        return (
          <Fragment key={n.href}>
            {n.href === FIRST_META && <span aria-hidden className="mx-1 mb-2.5 ml-auto h-4 w-px shrink-0 bg-border" />}
            <Link
              href={n.href}
              aria-current={active ? 'page' : undefined}
              ref={active ? centreIn : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2 pb-2 text-muted-foreground transition-colors outline-none hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                active && 'border-primary font-medium text-foreground hover:border-primary',
              )}
            >
              <n.icon className={cn('size-3.5', active && 'text-primary')} />
              {n.label}
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}
