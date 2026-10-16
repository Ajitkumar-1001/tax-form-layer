import type { ClaimStatus, Flag, Support, SupportLetter } from '@/lib/model/state'
import { cn } from '@/lib/utils'

const PILL = 'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap'

const STATUS: Record<ClaimStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' },
  adjusted: { label: 'Adjusted', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  verified: { label: 'Verified', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  accepted: { label: 'Accepted', className: 'text-emerald-800 ring-1 ring-emerald-600/40 ring-inset dark:text-emerald-300' },
  read_ok: { label: 'Read OK', className: 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200' },
  unreviewed: { label: 'Unreviewed', className: 'text-muted-foreground ring-1 ring-border ring-inset' },
}

/** One pill per claim status (State.claims[id].status). */
export function StatusPill({ status }: { status: ClaimStatus }) {
  const s = STATUS[status]
  return <span className={cn(PILL, s.className)}>{s.label}</span>
}

const FLAG: Record<Flag, { label: string; title: string; className: string }> = {
  needs_partner: { label: 'Needs partner', title: 'A live adjustment over 1,000 is not covered by a valid partner sign-off', className: 'bg-info-soft text-info' },
  reopened: { label: 'Reopened', title: 'A sign-off covering this is no longer valid', className: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200' },
  stale: { label: 'Stale', title: 'An input was adjusted; this engine value does not include it', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  blocks_filing: { label: 'Blocks filing', title: 'Counts against a filing gate', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' },
  not_yet_in_file: { label: 'Not yet in file', title: 'Arrives after the season clock', className: 'border border-dashed border-border text-muted-foreground' },
  frozen: { label: 'Frozen', title: 'Its jurisdiction is filed and accepted; reopen with an amendment', className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200' },
}

/** Chips for State.claims[id].flags; renders nothing when there are none. */
export function FlagChips({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} title={FLAG[f].title} className={cn(PILL, 'h-4.5 px-1.5 text-[11px]', FLAG[f].className)}>
          {FLAG[f].label}
        </span>
      ))}
    </span>
  )
}

const LETTERS: SupportLetter[] = ['D', 'R', 'C', 'P', 'T']
const MEANING: Record<SupportLetter, string> = { D: 'source document', R: 'recalculated', C: 'client', P: 'prior year', T: 'third party' }
const RANK: Record<Support['how'], number> = { filled: 3, ringed: 2, outlined: 1 }
const HOW: Record<Support['how'], string> = { filled: 'verified by', outlined: 'earned by a check', ringed: 'bulk-accepted by' }

/** What the letters and their marks mean, in one line for under them. */
export const SUPPORT_LEGEND = 'D source document · R recalculated · C client · P prior year · T third party. Filled: a person verified it. Outlined: a check earned it. Ringed: bulk-accepted.'

/** D R C P T: filled = a person verified, outlined = a check earned it, ringed = bulk-accepted, faint = none. */
export function SupportLetters({ support }: { support: Support[] }) {
  return (
    <span className="inline-flex gap-0.5 font-mono text-[10px] leading-none">
      {LETTERS.map((l) => {
        const s = support.filter((x) => x.letter === l).sort((a, b) => RANK[b.how] - RANK[a.how])[0]
        const title = s ? `${l}: ${MEANING[l]}, ${HOW[s.how]}${s.by && s.how !== 'outlined' ? ` ${s.by}` : ''}` : `${l}: ${MEANING[l]}, no support`
        return (
          <span
            key={l}
            title={title}
            aria-label={title}
            className={cn(
              'inline-flex size-4 items-center justify-center rounded-[3px]',
              !s && 'text-muted-foreground/40',
              s?.how === 'filled' && 'bg-foreground font-semibold text-background',
              s?.how === 'outlined' && 'ring-1 ring-foreground/50 ring-inset',
              s?.how === 'ringed' && 'rounded-full ring-1 ring-foreground/70 ring-offset-1 ring-offset-background',
            )}
          >
            {l}
          </span>
        )
      })}
    </span>
  )
}
