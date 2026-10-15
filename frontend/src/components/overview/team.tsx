'use client'
// Team and areas (spec §4.7): who works each area, what is open, where sign-off and time stand. Reassign shows only to
// roles that may assign (OvAct hides a refusal), so a preparer does not get a column of disabled buttons.
import Link from 'next/link'
import { hours as round } from '@/components/firm/firm-logic'
import { cn } from '@/lib/utils'
import type { TeamRow } from './overview-model'
import { OvAct } from './replay-safe'

const TH = 'px-2 py-1.5 font-medium'
const TD = 'px-2 py-2 align-top'
const LINK = 'underline-offset-2 hover:underline'

const SIGNOFFS: Record<TeamRow['signoffs'], string> = {
  changed: 'Changed after sign-off',
  partner: 'Partner signed',
  reviewed: 'Reviewed',
  prepared: 'Prepared, not reviewed',
  none: 'Not signed',
}

function hoursText(r: TeamRow): string {
  if (r.budget === null) return `${round(r.hours)} h, no budget set`
  return `${round(r.hours)} of ${round(r.budget)} h${r.over ? ', over' : ''}`
}

export function TeamSection({ team }: { team: TeamRow[] }) {
  return (
    <section aria-labelledby="ov-team" className="flex flex-col gap-3">
      <h2 id="ov-team" className="text-base font-semibold">
        Team and areas
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="pb-2 text-left text-xs text-muted-foreground">
            Who works each area, how many claims are still open, and where sign-off and time stand.
          </caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className={TH}>Area</th>
              <th scope="col" className={TH}>Assignee</th>
              <th scope="col" className={cn(TH, 'text-right')}>Open</th>
              <th scope="col" className={TH}>Sign-offs</th>
              <th scope="col" className={cn(TH, 'text-right')}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {team.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <th scope="row" className={cn(TD, 'text-left font-medium')}>
                  <Link href={r.href} className={cn(LINK, 'text-primary')}>
                    {r.label}
                  </Link>
                </th>
                <td className={TD}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{r.assignee.name}</span>
                    {r.assignee.inactiveUntil && <span className="text-xs text-warning">{`not active until ${r.assignee.inactiveUntil}`}</span>}
                    <OvAct request={{ type: 'assign', target: `area:${r.key}` }} whenRefused="hide" size="xs" variant="outline">
                      Reassign<span className="sr-only">{` ${r.label}`}</span>
                    </OvAct>
                  </span>
                </td>
                <td className={cn(TD, 'text-right tabular-nums')}>{r.open}</td>
                <td className={TD}>
                  <Link href="/filing#matrix" className={cn(LINK, (r.signoffs === 'reviewed' || r.signoffs === 'partner') && 'text-success')}>
                    {SIGNOFFS[r.signoffs]}
                  </Link>
                </td>
                <td className={cn(TD, 'text-right whitespace-nowrap')}>
                  <Link href="/firm#time" className={cn(LINK, 'tabular-nums', r.over && 'font-medium text-warning')}>
                    {hoursText(r)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
