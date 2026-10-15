'use client'
// Nine area chips: open count, definition-of-done progress, sign-off state, hours / budget, assignee.
import type { AreaKey } from '@/lib/model/ids'
import type { AreaView, SignoffView } from '@/lib/model/state'
import { cn } from '@/lib/utils'

const SIGN: Record<'preparer' | 'reviewer', string> = { preparer: 'P', reviewer: 'R' }

function signState(s: SignoffView | undefined): { mark: string; text: string } {
  if (!s) return { mark: '—', text: 'none' }
  return s.valid ? { mark: '✓', text: 'valid' } : { mark: '↺', text: `reopened (${s.changed.length} changed)` }
}

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

export function AreaStrip({ areas, active, names, onPick }: {
  areas: AreaView[]
  active: AreaKey | null
  names: Record<string, string>
  onPick: (area: AreaKey | null) => void
}) {
  return (
    <div role="group" aria-label="Areas" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {areas.map((a) => {
        const done = a.done.filter((d) => d.ok).length
        const on = active === a.key
        const signs = (['preparer', 'reviewer'] as const).map((l) => ({ l, ...signState(a.signoffs[l]) }))
        const hours = `${a.hours.toLocaleString('en-US')} / ${a.budget === null ? 'no budget' : `${a.budget} h`}`
        return (
          <button
            key={a.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? null : a.key)}
            title={`${a.label}: ${a.open} open claims, ${a.findingsOpen} open findings. Definition of done ${done}/${a.done.length}. Click to ${on ? 'show every area' : 'filter the queue'}.`}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
              on && 'border-primary bg-primary/10 hover:bg-primary/15',
            )}
          >
            <span className="flex items-baseline gap-1">
              <span className="min-w-0 flex-1 truncate font-medium">{a.label}</span>
              <span className={cn('shrink-0 tabular-nums', a.open ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground')}>{a.open} open</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${(done / Math.max(a.done.length, 1)) * 100}%` }} />
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                done {done}/{a.done.length}
              </span>
            </span>
            <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span title={signs.map((s) => `${s.l} sign-off: ${s.text}`).join('; ')} className="shrink-0 font-mono">
                {signs.map((s) => `${SIGN[s.l]}${s.mark}`).join(' ')}
              </span>
              <span className="min-w-0 flex-1 truncate tabular-nums" title={`Hours logged / budget: ${hours}`}>
                {hours}
              </span>
              <span title={`Assigned to ${names[a.assignee] ?? a.assignee}`} className="shrink-0 rounded-full bg-muted px-1 font-medium">
                {initials(names[a.assignee] ?? a.assignee)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
