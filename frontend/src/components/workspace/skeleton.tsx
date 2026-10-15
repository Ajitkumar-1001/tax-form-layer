// Loading placeholders for the parts of a screen that wait for the workspace (it loads in the browser).
import { Skeleton } from '@/components/ui/skeleton'

// Same box as the real TopBar (shell/app-shell.tsx): one 48 px row from lg up; below lg the clock has its own row.
export function TopBarSkeleton() {
  return (
    <div className="flex min-h-21 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 max-lg:pointer-coarse:min-h-23 lg:min-h-12 lg:flex-nowrap" aria-hidden="true">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
      </div>
      <Skeleton className="order-last h-8 w-full lg:order-none lg:w-64" />
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="h-8 w-9" />
        <Skeleton className="size-8" />
        <Skeleton className="h-9 w-36 max-sm:w-9" />
      </div>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-busy="true" aria-label="Loading the workpaper">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-40 w-full max-w-4xl" />
      <p className="sr-only">Loading the packet and the act log</p>
    </div>
  )
}
