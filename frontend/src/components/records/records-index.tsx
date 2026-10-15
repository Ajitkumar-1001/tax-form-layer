'use client'
// /records: the papers a CPA expects, one card each with what it proves and how many exceptions it holds.
import Link from 'next/link'
import { useWorkspace } from '@/components/workspace/context'
import { BUILDERS } from './builders'
import { RECORDS } from './registry'

const CARD = 'flex flex-col gap-1 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring'

export function RecordsIndex() {
  const { model, state } = useWorkspace()
  const exceptions = (name: string) => BUILDERS[name](model, state).groups.reduce((s, g) => s + g.rows.filter((r) => r.exception).length, 0)
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Records</h1>
        <p className="text-sm text-muted-foreground">Saved views over the same claims. Every cell opens its trace.</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <Link href="/documents" className={CARD}>
            <span className="font-medium">Document index</span>
            <span className="text-muted-foreground">Every document lands on a line or says why not.</span>
          </Link>
        </li>
        {RECORDS.map((r) => {
          const n = exceptions(r.name)
          return (
            <li key={r.name}>
              <Link href={`/records/${r.name}`} className={CARD}>
                <span className="flex items-baseline justify-between gap-2 font-medium">
                  {r.title}
                  <span className={n ? 'text-xs font-normal text-amber-700 dark:text-amber-400' : 'text-xs font-normal text-muted-foreground'}>
                    {n} exception{n === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="text-muted-foreground">{r.proves}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
