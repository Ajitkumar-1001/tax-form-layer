'use client'
// Money at stake (spec §4.6): proven errors with what fixing them all would move, unproven risk, engine alternatives
// kept out of every total, and what adjustments already moved. Only the top errors link: the other numbers have no
// exact view to open (spec §5.1), so they stay text.
import Link from 'next/link'
import { formatMoney, refHref } from '@/components/atoms'
import type { Money, Pick } from './overview-model'
import { OvMasked } from './replay-safe'

const LINK = 'text-primary underline-offset-2 hover:underline'
const dollars = (n: number) => `$${formatMoney(Math.round(Math.abs(n)))}`
const signed = (n: number) => formatMoney(Math.round(n), true)
const stake = (fed: number, ca: number) => `Federal ${signed(fed)} · California ${signed(ca)}`
// Most titles open with their claim id, which the link in front already shows.
const withoutClaim = (title: string, claim: string) => (title.startsWith(`${claim} `) ? title.slice(claim.length + 1) : title)
const big = (p: Pick) => Math.max(Math.abs(p.fed), Math.abs(p.ca))

export function MoneySection({ money }: { money: Money }) {
  const { errors, unproven, choices, adjusted } = money
  const largest = Math.max(0, ...errors.top.map(big))
  return (
    <section aria-labelledby="ov-money" className="flex flex-col gap-3">
      <h2 id="ov-money" className="text-base font-semibold">
        Money at stake
      </h2>
      {errors.count === 0 && unproven.count === 0 && <p className="text-sm text-muted-foreground">No money at stake in open issues.</p>}
      {errors.count > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            <span className="text-xl font-semibold tabular-nums">{dollars(errors.exposure.fed)}</span>
            {' federal and '}
            <span className="text-xl font-semibold tabular-nums">{dollars(errors.exposure.ca)}</span>
            {' California at stake if every error is fixed'}
          </p>
          <p className="text-xs text-muted-foreground">
            {`${errors.count} ${errors.count === 1 ? 'error' : 'errors'} proven against the evidence. Net change if every error is fixed: ${stake(errors.net.fed, errors.net.ca)} (a minus lowers the tax).`}
          </p>
        </div>
      )}
      {errors.top.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {errors.count > errors.top.length ? `Largest ${errors.top.length} of ${errors.count} errors` : 'Largest errors'}
          </h3>
          <ol className="flex flex-col gap-2.5">
            {errors.top.map((p) => (
              <li key={p.finding} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  {/* The claim id is the link: a title can hold a masked token, whose Reveal button cannot sit inside a link. */}
                  <Link href={refHref(p.claim)} className={`${LINK} font-mono text-xs`}>
                    {p.claim}
                  </Link>
                  <span className="min-w-0 flex-1">
                    <OvMasked text={withoutClaim(p.title, p.claim)} context={p.claim} />
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{stake(p.fed, p.ca)}</span>
                </div>
                <div aria-hidden className="h-1.5 rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full bg-foreground/55"
                    style={{ width: `${Math.max(2, Math.round((big(p) / largest) * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {unproven.count > 0 && (
          <li>
            <span className="text-warning">Unproven:</span>
            {` ${unproven.count} ${unproven.count === 1 ? 'item' : 'items'}, about ${dollars(unproven.exposure.fed)} federal and ${dollars(unproven.exposure.ca)} California`}
          </li>
        )}
        {choices > 0 && (
          <li className="text-muted-foreground">
            {choices === 1
              ? '1 engine alternative (an option, not an error) is not counted'
              : `${choices} engine alternatives (options, not errors) are not counted`}
          </li>
        )}
        <li className="text-muted-foreground">{`Already corrected: ${stake(adjusted.fed, adjusted.ca)}`}</li>
      </ul>
    </section>
  )
}
