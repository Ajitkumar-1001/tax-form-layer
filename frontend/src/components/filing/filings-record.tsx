'use client'
// The filing record (spec 3 §8.1): the client copy, Open amendment once something is frozen, and every filing with its
// agency results, newest first. Body only: filing-page.tsx writes the section, its heading and its hint.
import { useState } from 'react'
import { FileTextIcon } from 'lucide-react'
import { formatClock, MaskedText, refHref } from '@/components/atoms'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { OpenActRequest } from '@/components/workspace/types'
import type { FilingView } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { ClientCopy } from './client-copy'
import { ActReasonText, FilingAct } from './filing-act'
import { filingResults } from './filing-logic'
import { cap, JUR, nameOf, plainRule } from './filing-status'
import { A } from './item-list'
import { PrintSheet } from './print-sheet'

const AMEND: OpenActRequest = { type: 'amend_open', target: 'return' }

/** The agency's answer as a chip: signal colours only (DESIGN §2). */
const RESULT_TONE = {
  accepted: 'bg-success-soft text-success',
  rejected: 'bg-danger-soft text-danger',
  held: 'bg-warning-soft text-warning',
} as const

export function FilingsRecord() {
  const { state } = useWorkspace()
  // The overlay is fixed and printing is visibility-based, so where it sits in the DOM does not matter.
  const [copy, setCopy] = useState(false)
  const frozen = state.frozen.federal || state.frozen.california
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setCopy(true)}>
          <FileTextIcon /> Client copy
        </Button>
        {/* Nothing is frozen, nothing to amend: hidden for everyone until then, then shown to every role. */}
        {frozen && (
          <FilingAct request={AMEND} reason={<ActReasonText request={AMEND} gate={null} />} variant="outline">
            Open amendment
          </FilingAct>
        )}
      </div>
      {copy && (
        <PrintSheet title="Client copy" onClose={() => setCopy(false)}>
          <ClientCopy />
        </PrintSheet>
      )}
      {state.filings.length ? (
        <ol className="flex flex-col divide-y">
          {[...state.filings].reverse().map((f) => (
            <FilingItem key={f.seq} filing={f} />
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">Nothing has been filed in this engagement.</p>
      )}
    </div>
  )
}

function FilingItem({ filing: f }: { filing: FilingView }) {
  const { model, state } = useWorkspace()
  const results = filingResults(state, f)
  const rule = results.find((r) => r.rule)?.rule
  return (
    <li className="flex flex-col gap-1.5 py-2">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">{f.kind === 'submit' ? 'E-file' : 'Extension'}</span>
        {` · ${f.jurisdictions.map((j) => JUR[j]).join(' and ')} · by ${nameOf(model, f.actor)} · `}
        <A href={refHref(`act:${f.seq}`)}>{`change ${f.seq}`}</A>
        {` · ${formatClock(f.recorded_at)}`}
      </p>
      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">No agency result recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {results.map((r) => (
            <li key={r.seq} className="flex flex-col gap-0.5 text-xs">
              <span className="flex flex-wrap items-center gap-2">
                <span className="w-20">{cap(JUR[r.jurisdiction])}</span>
                <span className={cn('rounded-full px-2 font-medium', RESULT_TONE[r.status])}>{r.status}</span>
                {r.season_at && <span className="text-muted-foreground">{`on ${r.season_at.slice(0, 10)}`}</span>}
                {r.retainUntil && (
                  <span className="text-muted-foreground">{`retain until ${r.retainUntil.slice(0, 10)} (destruction not implemented)`}</span>
                )}
              </span>
              {r.errors.map((e) => (
                <span key={e.code} className="pl-22 text-danger">
                  <span className="font-mono">{e.code}</span> <MaskedText text={e.message} context={`act:${r.seq}`} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {rule && <p className="text-xs text-muted-foreground">{`Simulation rule: ${plainRule(rule)}`}</p>}
    </li>
  )
}
