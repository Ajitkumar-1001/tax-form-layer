'use client'
// Where we are (spec §4.8): the required steps as marks, and the claims in the file by status, in plain words (§6).
import Link from 'next/link'
import { ClaimSpectrum } from '@/components/shell/rail'
import { cn } from '@/lib/utils'
import type { Where } from './overview-model'

export function WhereSection({ where }: { where: Where }) {
  const { steps, done, claims } = where
  return (
    <section aria-labelledby="ov-where" className="flex flex-col gap-4">
      <h2 id="ov-where" className="text-base font-semibold">
        Where we are
      </h2>
      <div className="flex flex-col gap-2">
        <Link href="/filing#steps" className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline">
          {`${done} of ${steps.length} required steps`}
        </Link>
        {/* Filled when met, hollow when not: the shape carries it, not the colour alone. The link above says it in words. */}
        <span aria-hidden className="flex gap-1">
          {steps.map((s) => (
            <span
              key={s.n}
              title={`${s.n}. ${s.label}: ${s.ok ? 'met' : 'not met'}`}
              className={cn('h-2 flex-1 rounded-full', s.ok ? 'bg-success' : 'ring-1 ring-foreground/55 ring-inset')}
            />
          ))}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{`${claims.total} claims in the file`}</p>
        <ClaimSpectrum parts={claims.parts} className="h-2.5 gap-0.5 overflow-hidden rounded-sm" />
        <ul className="flex flex-col gap-1 text-sm">
          {claims.parts.map((p) => {
            const row = (
              <>
                <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', p.tone)} />
                <span className="min-w-0 flex-1">{p.label}</span>
                <span className="tabular-nums">{p.count}</span>
              </>
            )
            return (
              <li key={p.key}>
                {p.key === 'open' ? (
                  <Link href="/queue?mine=0" className="flex items-center gap-2 text-primary underline-offset-2 hover:underline">
                    {row}
                  </Link>
                ) : (
                  <span className="flex items-center gap-2">{row}</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
