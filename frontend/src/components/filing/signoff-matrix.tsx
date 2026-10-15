'use client'
import { CircleCheckIcon, RotateCcwIcon } from 'lucide-react'
import { RefLink } from '@/components/atoms'
import { ActButton } from '@/components/acts/act-host'
import { useWorkspace } from '@/components/workspace/context'
import { type MatrixCell, MATRIX_LEVELS, signoffMatrix } from './filing-logic'

const CHANGED_SHOWN = 3

export function SignoffMatrix() {
  const { state } = useWorkspace()
  const rows = signoffMatrix(state)
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Sign-offs by area and level. Each cell is valid, reopened or empty.</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Area</th>
            {MATRIX_LEVELS.map((l) => (
              <th key={l} scope="col" className="px-3 py-2 font-medium capitalize">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.target} className="border-t align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {r.target === 'return' ? r.label : <RefLink to={r.target}>{r.label}</RefLink>}
              </th>
              {r.cells.map((c) => (
                <td key={c.level} className="px-3 py-2">
                  <Cell cell={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ cell }: { cell: MatrixCell }) {
  const { identities } = useWorkspace()
  const s = cell.signoff
  const name = s ? (identities.find((v) => v.id === s.actor)?.name ?? s.actor) : ''
  return (
    <div className="flex flex-col items-start gap-1 text-xs">
      {cell.state === 'empty' && <span className="text-muted-foreground">Not signed</span>}
      {cell.state === 'valid' && s && (
        <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300" title={`${s.scope_size} claims, ${s.recorded_at.slice(0, 16).replace('T', ' ')}`}>
          <CircleCheckIcon className="size-3.5" /> Valid · {name}
        </span>
      )}
      {cell.state === 'reopened' && s && (
        <span className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-orange-800 dark:text-orange-300">
            <RotateCcwIcon className="size-3.5" /> Reopened · {name} · {s.changed.length} changed
          </span>
          <span className="flex flex-wrap gap-x-1.5">
            {s.changed.slice(0, CHANGED_SHOWN).map((id) => (
              <RefLink key={id} to={id} />
            ))}
            {s.changed.length > CHANGED_SHOWN && <span className="text-muted-foreground">+{s.changed.length - CHANGED_SHOWN}</span>}
          </span>
        </span>
      )}
      <ActButton type="signoff" target={cell.target} prefill={{ level: cell.level }} size="xs" variant="outline">
        {cell.state === 'empty' ? 'Sign' : 'Re-sign'}
      </ActButton>
    </div>
  )
}
