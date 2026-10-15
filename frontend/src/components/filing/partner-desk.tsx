'use client'
// Every item over 1,000 that needs the partner, in one list; select some, sign partner level over their areas.
import { useState } from 'react'
import { MaskedText, RefLink, Stake } from '@/components/atoms'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useWorkspace } from '@/components/workspace/context'
import type { ActInput } from '@/lib/model/acts'
import { areaLabel, type DeskItem, partnerDesk, signTargets } from './filing-logic'

export function PartnerDesk() {
  const ws = useWorkspace()
  const { model, state, identities } = ws
  const items = partnerDesk(model, state)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const chosen = items.filter((i) => selected.includes(i.key))
  const targets = signTargets(chosen)
  const inputs: ActInput[] = targets.map((target) => ({ type: 'signoff', target, body: { level: 'partner' } }))
  const refusal = inputs.map((i) => ws.can(i)).find((a) => !a.ok)
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  const toggle = (key: string, on: boolean) => setSelected((s) => (on ? [...new Set([...s, key])] : s.filter((k) => k !== key)))

  async function sign() {
    setBusy(true)
    const r = await ws.post(inputs, { undoLabel: `Partner sign-off on ${targets.map((t) => (t === 'return' ? 'the return' : t.slice(5))).join(', ')}` })
    setBusy(false)
    if (r.ok) setSelected([])
  }

  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing over 1,000 is waiting for the partner.</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setSelected(items.filter((i) => !i.covered).map((i) => i.key))}>
          Select uncovered ({items.filter((i) => !i.covered).length})
        </Button>
        <span title={refusal && !refusal.ok ? refusal.reason : undefined} className="inline-flex">
          <Button size="sm" disabled={!chosen.length || busy || (refusal && !refusal.ok)} onClick={() => void sign()}>
            Partner sign-off{targets.length ? ` on ${targets.length} ${targets.length === 1 ? 'scope' : 'scopes'}` : ''}
          </Button>
        </span>
        {chosen.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Covers {targets.map((t) => (t === 'return' ? 'the whole return' : areaLabel(t.slice(5) as DeskItem['area']))).join(', ')}
          </span>
        )}
      </div>
      {refusal && !refusal.ok && chosen.length > 0 && (
        <p role="status" className="text-xs text-destructive">
          {refusal.reason}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-lg ring-1 ring-foreground/10">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-3 px-3 py-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={selected.includes(i.key)}
              onCheckedChange={(on) => toggle(i.key, on)}
              aria-label={`Select ${i.target}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <RefLink to={i.target} />
                <span className="text-xs text-muted-foreground">{areaLabel(i.area)}</span>
                <span className="text-xs text-muted-foreground">{i.kind === 'adjust' ? <RefLink to={i.key}>adjust {i.key}</RefLink> : <RefLink to={i.key}>finding</RefLink>}</span>
                <span
                  className={
                    i.covered
                      ? 'rounded-full bg-emerald-100 px-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'rounded-full bg-info-soft px-2 text-xs text-info'
                  }
                >
                  {i.covered ? 'Covered' : 'Needs partner'}
                </span>
              </div>
              <p className="text-xs">
                <MaskedText text={i.reason} context={i.target} />
              </p>
              <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                {i.preparedBy.length > 0 && <span>Prepared by {i.preparedBy.map(nameOf).join(', ')}</span>}
                {i.evidence.slice(0, 3).map((e) => (
                  <RefLink key={e} to={e} />
                ))}
              </p>
            </div>
            <Stake fed={i.effect.fed} ca={i.effect.ca} />
          </li>
        ))}
      </ul>
    </div>
  )
}
