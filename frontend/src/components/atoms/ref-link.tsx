'use client'
import { use, type ReactNode } from 'react'
import Link from 'next/link'
import { WorkspaceContext } from '@/components/workspace/context'
import { cn } from '@/lib/utils'
import { refHref, refLabel } from './format'

/**
 * Link to /r/<ref>. Without children it shows the ref in mono. Works outside the provider (no title then).
 * The prop is `to`, not `ref`: React 19 reserves `ref` (server components throw when passing it to a client component).
 */
export function RefLink({ to, children, className }: { to: string; children?: ReactNode; className?: string }) {
  const ws = use(WorkspaceContext)
  return (
    <Link
      href={refHref(to)}
      title={ws ? refLabel(ws.model, to) : undefined}
      className={cn('text-primary underline-offset-2 hover:underline', !children && 'font-mono text-[0.9em]', className)}
    >
      {children ?? to}
    </Link>
  )
}
