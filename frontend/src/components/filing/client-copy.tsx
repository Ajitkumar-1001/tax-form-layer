'use client'
// The client copy: the effective summary and key lines, as filed when frozen. Used by the filing desk and the portal.
import { Money } from '@/components/atoms'
import { useWorkspace } from '@/components/workspace/context'
import type { TotalsSide } from '@/lib/model/state'
import { type CopyLine, KEY_LINES, keyLines } from './filing-logic'

const FED_ROWS: [string, string][] = [['agi', 'Adjusted gross income'], ['taxable_income', 'Taxable income'], ['total_tax', 'Total tax'], ['payments', 'Payments']]
const CA_ROWS: [string, string][] = [['total_agi', 'Total AGI (California law)'], ['ca_agi', 'California AGI'], ['total_tax', 'Total tax'], ['payments', 'Payments']]

export function ClientCopy() {
  const { model, state } = useWorkspace()
  const p = model.packet
  const filed = state.filings.filter((f) => f.kind === 'submit' && f.results.some((r) => r.status === 'accepted'))
  const spouses = p.household.people.filter((x) => x.role === 'taxpayer' || x.role === 'spouse').map((x) => x.name)
  const fed = keyLines(model, state, KEY_LINES.federal)
  const ca = keyLines(model, state, KEY_LINES.california)
  // moves: a delta is non-zero, so a "Changes since…" line shows and the refund or balance due includes the changes, as an estimate.
  const moves = state.totals.federal.delta !== 0 || state.totals.california.delta !== 0
  const changed = moves || [...fed, ...ca].some((l) => l.notRecomputed)
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 border-b pb-3">
        <p className="text-xs text-muted-foreground">{p.firm.name} · client copy</p>
        <h2 className="text-lg font-semibold">
          {spouses.join(' and ')} · tax year {p.household.tax_year}
        </h2>
        <p className="text-xs text-muted-foreground">
          {filed.length
            ? `As filed: ${filed.flatMap((f) => f.results.filter((r) => r.status === 'accepted').map((r) => `${r.jurisdiction} accepted`)).join(', ')} (season clock ${state.clock.slice(0, 10)}).`
            : `Not filed yet: a draft as of ${state.clock.slice(0, 10)}.`}
        </p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <Summary title="Federal (Form 1040)" side={state.totals.federal} rows={FED_ROWS} />
        <Summary title="California (Form 540NR)" side={state.totals.california} rows={CA_ROWS} />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Lines title="Federal key lines" lines={fed} />
        <Lines title="California key lines" lines={ca} />
      </div>
      {changed && (
        <p className="text-xs text-muted-foreground">
          {moves ? (
            <>
              The tax software has not recomputed this return since our changes. Lines marked “not recomputed” and the figures above each
              “Changes since…” line are its figures from before them; the refund or balance due includes every change, as an estimate.
            </>
          ) : (
            <>
              The tax software has not recomputed this return since our changes. Lines marked “not recomputed” are its figures from
              before them, and so is the refund or balance due: it does not yet reflect those changes.
            </>
          )}
        </p>
      )}
    </article>
  )
}

function Summary({ title, side, rows }: { title: string; side: TotalsSide; rows: [string, string][] }) {
  const adjusted = side.delta !== 0
  const owe = side.balance_estimate
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {rows.map(([k, label]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">
              <Money value={side.v3[k]} />
            </dd>
          </div>
        ))}
        {adjusted && (
          <>
            <dt className="text-muted-foreground">Changes since the software computed it (estimate)</dt>
            <dd className="text-right">
              <Money value={side.delta} signed />
            </dd>
          </>
        )}
        <dt className="font-medium">{owe >= 0 ? 'Balance due' : 'Refund'}{adjusted && ' (estimate)'}</dt>
        <dd className="text-right font-medium">
          <Money value={Math.abs(owe)} />
        </dd>
      </dl>
    </section>
  )
}

function Lines({ title, lines }: { title: string; lines: CopyLine[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <table className="w-full text-xs">
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-b last:border-0">
              <td className="py-1 pr-2 font-mono text-muted-foreground">{l.key}</td>
              <td className="py-1 pr-2">{l.label}</td>
              <td className="py-1 text-right whitespace-nowrap">
                {typeof l.value === 'number' ? <Money value={l.value} /> : String(l.value ?? '—')}
                {l.notRecomputed && <span className="ml-1 text-muted-foreground">not recomputed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
