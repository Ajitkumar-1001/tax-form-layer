'use client'
// Partner desk (spec 3 §7), body only: the section shell, heading and hint are filing-page.tsx's. Every live adjustment
// over 1,000 and every open process finding that needs the partner, in one list. Only a viewer who may sign at partner
// level gets the checkboxes and the toolbar; anyone else with uncovered items sees the server's reason once.
import { type ReactElement, useId, useState } from 'react'
import { MaskedText, Money, refHref } from '@/components/atoms'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useWorkspace } from '@/components/workspace/context'
import type { ActInput } from '@/lib/model/acts'
import type { AreaKey } from '@/lib/model/ids'
import { plainMasked } from '@/lib/model/mask-token'
import type { AuthResult } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { areaLabel, partnerDesk, signTargets } from './filing-logic'
import { labelOf, nameOf } from './filing-status'
import { A, ItemList } from './item-list'

type Refused = Extract<AuthResult, { ok: false }>
const refused = (a: AuthResult): a is Refused => !a.ok

export function PartnerDesk(): ReactElement {
  const ws = useWorkspace()
  const { model, state } = ws
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const hintId = useId()
  const coversId = useId()
  const refusalId = useId()
  const items = partnerDesk(model, state)
  const uncovered = items.filter((i) => !i.covered)
  const results = signTargets(uncovered).map((t) => ws.can({ type: 'signoff', target: t, body: { level: 'partner' } }))
  const signer = results.some((r) => r.ok)
  const denied = results.find(refused)
  const chosen = items.filter((i) => selected.includes(i.key))
  const targets = signTargets(chosen)
  const inputs: ActInput[] = targets.map((target) => ({ type: 'signoff', target, body: { level: 'partner' } }))
  const refusal = inputs.map((i) => ws.can(i)).find(refused)
  const toggle = (key: string, on: boolean) => setSelected((s) => (on ? [...new Set([...s, key])] : s.filter((k) => k !== key)))

  // `btn` is the pressed button. When the sign-off covers the last uncovered item, the toolbar holding it unmounts, so
  // the desk's section (filing-page.tsx, a focus return) takes focus, but only if focus fell to body with the button:
  // focus moved during the post (role switcher, a dialog) stays put. Polls and identity switches never run this.
  async function sign(btn: HTMLElement) {
    const back = btn.closest<HTMLElement>('[data-focus-return]')
    setBusy(true)
    const undoLabel = plainMasked(`Partner sign-off on ${targets.map((t) => (t === 'return' ? 'the return' : areaLabel(t.slice(5) as AreaKey))).join(', ')}`)
    const r = await ws.post(inputs, { undoLabel })
    setBusy(false)
    if (r.ok) setSelected([])
    const fell = document.activeElement === null || document.activeElement === document.body
    if (r.ok && !btn.isConnected && fell) back?.focus({ preventScroll: true })
  }

  if (!items.length) return <p className="text-sm text-muted-foreground">{"Nothing is waiting for the partner's sign-off."}</p>
  // The sign button's reason is always visible text: what to do first, the server's refusal, or what it covers.
  const describedBy = !chosen.length ? hintId : refusal ? refusalId : coversId
  return (
    <div className="flex flex-col gap-3">
      {signer ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button size="sm" variant="outline" onClick={() => setSelected(uncovered.map((i) => i.key))}>
              {`Select uncovered (${uncovered.length})`}
            </Button>
            <Button
              size="sm"
              disabled={!chosen.length || busy || !!refusal}
              focusableWhenDisabled
              className="data-disabled:opacity-50"
              aria-describedby={describedBy}
              onClick={(e) => void sign(e.currentTarget)}
            >
              {`Partner sign-off${targets.length ? ` on ${targets.length} ${targets.length === 1 ? 'scope' : 'scopes'}` : ''}`}
            </Button>
            {chosen.length > 0 ? (
              <span id={coversId} className="text-xs text-muted-foreground">
                {`Covers ${targets.map((t) => (t === 'return' ? 'the whole return' : areaLabel(t.slice(5) as AreaKey))).join(', ')}`}
              </span>
            ) : (
              <span id={hintId} className="text-xs text-muted-foreground">Select the items to sign.</span>
            )}
          </div>
          {refusal && chosen.length > 0 && <p id={refusalId} role="status" data-refusal className="text-xs text-danger"><MaskedText text={refusal.reason} context="return" /></p>}
        </div>
      ) : (
        denied && <p data-refusal className="text-xs text-muted-foreground"><MaskedText text={denied.reason} context="return" /></p>
      )}
      <ul className="flex flex-col divide-y">
        {items.map((i) => {
          const label = plainMasked(labelOf(model, i.target))
          return (
            <li key={i.key} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-start sm:gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {signer && (
                    <Checkbox
                      className="self-center"
                      checked={selected.includes(i.key)}
                      onCheckedChange={(on) => toggle(i.key, on)}
                      aria-label={`Select ${label}`}
                    />
                  )}
                  <A href={refHref(i.target)}>{label}</A>
                  <span className="text-xs text-muted-foreground">{areaLabel(i.area)}</span>
                  <A href={refHref(i.key)} className="text-xs">{i.kind === 'adjust' ? `change ${i.key.slice(4)}` : 'Process finding'}</A>
                  <span className={cn('rounded-full px-2 text-xs', i.covered ? 'bg-success-soft text-success' : 'bg-info-soft text-info')}>
                    {i.covered ? 'Covered' : 'Needs partner'}
                  </span>
                </div>
                <p className="text-xs">
                  <MaskedText text={i.reason} context={i.target} />
                </p>
                <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground wrap-anywhere">
                  {i.preparedBy.length > 0 && <span>{`Prepared by ${i.preparedBy.map((id) => nameOf(model, id)).join(', ')}`}</span>}
                  {i.evidence.length > 0 && <ItemList what="Evidence" refs={i.evidence} step={null} />}
                </div>
              </div>
              {(i.effect.fed !== 0 || i.effect.ca !== 0) && (
                <div className="text-xs whitespace-nowrap sm:shrink-0 sm:text-right">
                  {i.kind === 'adjust' ? 'Tax effect: ' : 'At stake: '}Federal <Money value={i.effect.fed} /> · California <Money value={i.effect.ca} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
