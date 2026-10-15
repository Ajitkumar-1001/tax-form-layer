'use client'
// /documents (spec §3.3): the document index. Exceptions first, ?unlanded=1 and ?area= filters, batch dispose.
import { type FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MaskedText, RefLink } from '@/components/atoms'
import { DISPOSITION_LABEL, DISPOSITION_NEEDS_REF } from '@/components/acts/draft'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { Disposition } from '@/lib/model/acts'
import { AREA_LABEL, AREAS } from '@/lib/model/ids'
import { cn } from '@/lib/utils'
import { type DispositionT, type DocRow, disposeActs, documentRows, exceptionsFirst, filterDocs, isException } from './documents'

const FIELD = 'h-8 rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring'
const BADGE = 'inline-flex h-4.5 items-center rounded-full px-1.5 text-[11px] whitespace-nowrap'

export function DocumentsView() {
  const { model, state } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const unlanded = params.get('unlanded') === '1'
  const area = params.get('area')
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  const all = documentRows(model, state)
  const filtered = exceptionsFirst(filterDocs(all, { unlanded, area }))
  const rows = showAll || unlanded ? filtered : filtered.filter(isException)
  const open = all.filter((r) => r.unlanded && !r.disposition).length

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const q = next.toString()
    router.replace(q ? `/documents?${q}` : '/documents')
  }
  // Only shown rows can be acted on: a selection hidden by a filter change is not disposed.
  const chosen = selected.filter((id) => rows.some((r) => r.id === id))
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const allShown = rows.length > 0 && rows.every((r) => selected.includes(r.id))

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 print:p-0">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Every document lands on a line or says why not. <span className="font-medium text-foreground">{open}</span> used document
          {open === 1 ? '' : 's'} with no landed line and no disposition (step 4). “Unlanded” means the pipeline marked it used, but no number came
          from it.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm print:hidden">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={unlanded} onChange={(e) => setParam('unlanded', e.target.checked ? '1' : null)} className="size-4" />
          Unlanded only
        </label>
        <label className="inline-flex items-center gap-1.5">
          Area
          <select value={area ?? ''} onChange={(e) => setParam('area', e.target.value || null)} className={FIELD}>
            <option value="">All areas</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        {!unlanded && (
          <Button size="sm" variant="outline" onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>
            {showAll ? 'Exceptions only' : `Show all ${filtered.length}`}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {rows.length} of {all.length} shown
        </span>
      </div>

      {chosen.length > 0 && <BatchDispose ids={chosen} onDone={() => setSelected([])} />}

      <div className="overflow-x-auto rounded-md border print:overflow-visible">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="w-8 px-2 py-1.5 print:hidden">
                <input
                  type="checkbox"
                  aria-label="Select all shown documents"
                  checked={allShown}
                  onChange={() => setSelected(allShown ? [] : rows.map((r) => r.id))}
                  className="size-4"
                />
              </th>
              {['Id', 'Title', 'Type', 'Belongs to', 'Received', 'Extraction', 'Lines landed', 'Disposition', 'Lineage', 'Open findings', 'Views'].map((h) => (
                <th key={h} scope="col" className={cn('px-2 py-1.5 font-medium whitespace-nowrap', (h === 'Lines landed' || h === 'Open findings' || h === 'Views') && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <DocRowView key={r.id} row={r} checked={selected.includes(r.id)} onToggle={() => toggle(r.id)} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No documents match. <Link href="/documents" className="text-primary underline">Clear filters</Link></p>}
    </div>
  )
}

function DocRowView({ row: r, checked, onToggle }: { row: DocRow; checked: boolean; onToggle: () => void }) {
  return (
    <tr className={cn('border-t align-top', r.notYetInFile && 'opacity-60')}>
      <td className="px-2 py-1 print:hidden">
        <input type="checkbox" aria-label={`Select ${r.id}`} checked={checked} onChange={onToggle} className="size-4" />
      </td>
      <td className="px-2 py-1 whitespace-nowrap">
        <RefLink to={r.id} />
      </td>
      <td className="min-w-48 px-2 py-1">{r.title}</td>
      <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{r.type}</td>
      <td className="px-2 py-1 whitespace-nowrap">{r.belongsTo}</td>
      <td className="px-2 py-1 whitespace-nowrap">
        <span className="tabular-nums">{r.receivedAt.slice(0, 10)}</span>
        {r.afterV3 && <span className={cn(BADGE, 'ml-1 bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200')}>after v3</span>}
        {r.notYetInFile && <span className={cn(BADGE, 'ml-1 border border-dashed text-muted-foreground')}>not yet in file</span>}
      </td>
      <td className={cn('px-2 py-1', r.partial && 'text-amber-700 dark:text-amber-400')}>{r.extraction}</td>
      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
        {r.landed.length ? (
          <RefLink to={r.id}>
            <span title={r.landed.slice(0, 12).join(', ')}>{r.landed.length}</span>
          </RefLink>
        ) : (
          <span className={r.unlanded ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}>{r.unlanded ? 'unlanded' : r.used ? '0' : 'not used'}</span>
        )}
      </td>
      <td className="min-w-32 px-2 py-1">{r.disposition ? <MaskedText text={r.disposition} context={r.id} /> : <span className="text-muted-foreground">—</span>}</td>
      <td className="min-w-40 px-2 py-1">
        {r.lineage.map((l, i) => (
          <div key={i}>{l.ref ? <RefLink to={l.ref}>{l.text}</RefLink> : l.text}</div>
        ))}
      </td>
      <td className={cn('px-2 py-1 text-right tabular-nums', r.openFindings && 'text-red-700 dark:text-red-400')}>{r.openFindings || ''}</td>
      <td className="px-2 py-1 text-right tabular-nums">{r.views || ''}</td>
    </tr>
  )
}

/** Dispose the selected documents with one reason, as one all-or-nothing batch. Refusals are shown before posting. */
function BatchDispose({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const ws = useWorkspace()
  const [disposition, setDisposition] = useState<DispositionT>('informational')
  const [reason, setReason] = useState('')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const needsRef = DISPOSITION_NEEDS_REF.has(disposition)
  const acts = disposeActs(ids, disposition, reason.trim(), needsRef ? ref.trim() : undefined)
  const refused = acts.flatMap((a) => {
    const r = ws.can(a)
    return r.ok ? [] : [`${a.target}: ${r.reason}`]
  })
  const invalid = reason.trim().length < 3 ? 'Give a reason (at least 3 characters).' : needsRef && !ref.trim() ? 'This disposition points at another item: give its ref.' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (invalid || refused.length) return
    setBusy(true)
    const r = await ws.post(acts, { undoLabel: `Disposed ${ids.length}` })
    setBusy(false)
    if (r.ok) onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm print:hidden" aria-label="Dispose selected documents">
      <div className="flex flex-wrap items-end gap-2">
        <span className="self-center font-medium" title={ids.join(', ')}>
          {ids.length} selected: {ids.length > 8 ? `${ids.slice(0, 8).join(', ')} …` : ids.join(', ')}
        </span>
        <label className="flex flex-col gap-0.5 text-xs">
          Disposition
          <select value={disposition} onChange={(e) => setDisposition(Disposition.parse(e.target.value))} className={FIELD}>
            {Disposition.options.map((d) => (
              <option key={d} value={d}>
                {DISPOSITION_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        {needsRef && (
          <label className="flex flex-col gap-0.5 text-xs">
            Points at
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. D09" className={cn(FIELD, 'w-28')} />
          </label>
        )}
        <label className="flex min-w-64 flex-1 flex-col gap-0.5 text-xs">
          Reason (one for all)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. IP PIN notice and IDs: informational" className={FIELD} />
        </label>
        <Button type="submit" size="sm" disabled={busy || Boolean(invalid) || refused.length > 0}>
          {busy ? 'Saving…' : `Dispose ${ids.length}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Clear
        </Button>
      </div>
      {invalid && reason.length > 0 && <p className="text-xs text-muted-foreground">{invalid}</p>}
      {refused.length > 0 && (
        <p className="text-xs text-destructive">
          {refused.length} of {acts.length} refused, so the batch cannot be posted: {refused.slice(0, 3).join(' · ')}
          {refused.length > 3 ? ' …' : ''}
        </p>
      )}
    </form>
  )
}
