// Loading placeholders for the parts of a screen that wait for the workspace (it loads in the browser).
import { Skeleton } from '@/components/ui/skeleton'

// Same box as the real TopBar (shell/app-shell.tsx): one 52 px row from lg up; below lg the clock has its own row.
// Rounded like the chips they stand in for.
export function TopBarSkeleton() {
  return (
    <div className="flex min-h-22 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 max-lg:pointer-coarse:min-h-25 lg:h-14 lg:min-h-0 lg:flex-nowrap lg:gap-x-4 lg:py-0 xl:px-6" aria-hidden="true">
      <Skeleton className="hidden size-8 shrink-0 rounded-full lg:block" />
      <div className="flex min-w-0 flex-1 items-center gap-3 xl:flex-initial rail-wide:hidden">
        <Skeleton className="h-4 w-44 max-w-full" />
      </div>
      <Skeleton className="order-last h-8 w-full rounded-full lg:order-none lg:w-64 xl:flex-1 rail-wide:flex-1" />
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="h-8 w-9 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-8 w-36 rounded-full max-sm:w-8" />
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
