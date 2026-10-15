import { cn } from '@/lib/utils'
import { formatMoney } from './format'

/** Money in tabular figures. Right-aligns inside a right-aligned cell; `signed` shows "+" on positives. */
export function Money({ value, signed, className }: { value: number | null | undefined; signed?: boolean; className?: string }) {
  return <span className={cn('inline-block text-right tabular-nums whitespace-nowrap', className)}>{formatMoney(value, signed)}</span>
}

/** Money at stake, federal and California; a zero side is left out, both zero shows "—". */
export function Stake({ fed, ca }: { fed: number; ca: number }) {
  if (!fed && !ca) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-baseline gap-2 text-xs whitespace-nowrap">
      {fed ? (
        <span>
          <span className="text-muted-foreground">Fed </span>
          <Money value={fed} />
        </span>
      ) : null}
      {ca ? (
        <span>
          <span className="text-muted-foreground">CA </span>
          <Money value={ca} />
        </span>
      ) : null}
    </span>
  )
}
