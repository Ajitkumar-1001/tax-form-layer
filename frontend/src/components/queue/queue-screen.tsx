'use client'
// The Queue: the list of work grouped by consequence, and the claim pane for ?c=<ref> on the right. Filters live in the
// URL (area, mine, q). Picks are kept until acted on or cleared, but the bulk bar counts and acts only on visible ones.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { SearchIcon, XIcon } from 'lucide-react'
import { RefLink, refHref } from '@/components/atoms'
import { useOpenAct } from '@/components/acts/act-host'
import { type DispositionT, fixToRequest } from '@/components/acts/draft'
import { inOverlay, isTypingTarget } from '@/components/shell/keys'
import { ClaimPane } from '@/components/trace/claim-pane'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/components/workspace/context'
import type { ActInput } from '@/lib/model/acts'
import { AREAS, AREA_LABEL } from '@/lib/model/ids'
import { plainMasked } from '@/lib/model/mask-token'
import type { State } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { BulkBar } from './bulk-bar'
import {
  GROUPS, type GroupKey, type Row, type TiedRow,
  acceptInputs, acceptLevel, buildQueue, chunk, disposeInputs, lastUndoTarget, parseFilters,
} from './queue-model'
import { GroupView, RowView, countLabel } from './queue-rows'

export const HIDE_EXPLAIN_KEY = 'wp:hide-explain'

/** The area filter's choices; '' is "All areas" (no ?area). */
export const AREA_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All areas' },
  ...AREAS.map((a) => ({ value: a, label: AREA_LABEL[a] })),
]

const TIED = GROUPS.find((g) => g.key === 'tied')!
const NOT_REVIEWER = 'Accepting a tied check is a reviewer or partner act.'

/** The picks the bulk bar counts and acts on: rows in open groups that match the filters (the rows j/k reach). */
export function visiblePicked(picked: readonly string[], navRows: readonly { key: string }[]): string[] {
  const reachable = new Set(navRows.map((r) => r.key))
  return picked.filter((k) => reachable.has(k))
}

/** A group's select-all checkbox: none, some or all of its row keys picked. */
export function pickState(picked: readonly string[], keys: readonly string[]): 'none' | 'some' | 'all' {
  const n = keys.filter((k) => picked.includes(k)).length
  return n === 0 ? 'none' : n === keys.length ? 'all' : 'some'
}

/** Bulk accept takes each claim a check tied out (read_ok) once and skips every other row. A UI guard against
 * select-all; the server's rules are unchanged. */
export function splitTied<R extends Pick<Row, 'claim'>>(rows: readonly R[], claims: State['claims']): { claims: string[]; skipped: R[] } {
  const tied = new Set<string>()
  const skipped: R[] = []
  for (const r of rows) {
    if (r.claim && claims[r.claim]?.status === 'read_ok') tied.add(r.claim)
    else skipped.push(r)
  }
  return { claims: [...tied], skipped }
}

/** Toast text: tokens in their display form first, then the clip, so a cut never lands inside a token. */
export function clipPlain(text: string, n = 40): string {
  const plain = plainMasked(text)
  return plain.length > n ? `${plain.slice(0, n)}…` : plain
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_EXPLAIN_KEY) === '1'
  } catch {
    return false
  }
}

function writeHidden(hide: boolean): void {
  try {
    if (hide) localStorage.setItem(HIDE_EXPLAIN_KEY, '1')
    else localStorage.removeItem(HIDE_EXPLAIN_KEY)
  } catch {
    // storage unavailable: the choice lasts for this page view only
  }
}

/** History API updates sync with useSearchParams without a server round trip (Next docs, linking-and-navigating). */
function setParams(updates: Record<string, string | null>, push = false): void {
  const p = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) p.delete(k)
    else p.set(k, v)
  }
  const url = `${window.location.pathname}${p.size ? `?${p}` : ''}`
  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

export function QueueScreen() {
  const ws = useWorkspace()
  const { model, state, viewer, lastSeenSeq } = ws
  const params = useSearchParams()
  const router = useRouter()
  const openAct = useOpenAct()
  const [hideExplain, setHideExplain] = useState(readHidden)
  const [closed, setClosed] = useState<GroupKey[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  // Never pruned when a filter changes, so undoing the filter restores the selection.
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState(params.get('q') ?? '')
  const search = useRef<HTMLInputElement>(null)

  const filters = { ...parseFilters(params, viewer), q }
  const selected = params.get('c')
  const queue = buildQueue(model, state, lastSeenSeq, filters)
  const allRows = queue.groups.flatMap((g) => g.rows)
  const navRows = queue.groups.filter((g) => !closed.includes(g.key)).flatMap((g) => g.rows)
  const cursorRow = navRows.find((r) => r.key === cursor) ?? null
  const shownPicks = visiblePicked(picked, navRows)
  const pickedRows = navRows.filter((r) => shownPicks.includes(r.key))
  const level = acceptLevel(viewer)

  const select = (row: Row) => {
    setCursor(row.key)
    setParams({ c: row.ref }, true)
  }
  const openFull = (row: Row) => router.push(refHref(row.ref))
  const togglePick = (row: Row) => setPicked((p) => (p.includes(row.key) ? p.filter((k) => k !== row.key) : [...p, row.key]))
  const toggleAll = (rows: Row[]) => {
    const keys = rows.map((r) => r.key)
    setPicked((p) => (pickState(p, keys) === 'all' ? p.filter((k) => !keys.includes(k)) : [...p, ...keys.filter((k) => !p.includes(k))]))
  }
  const unpick = (rows: Row[]) => setPicked((p) => p.filter((k) => !rows.some((r) => r.key === k)))
  const toggleGroup = (k: GroupKey, open: boolean) => setClosed((c) => (open ? c.filter((x) => x !== k) : c.includes(k) ? c : [...c, k]))
  const toggleExplain = () => {
    writeHidden(!hideExplain)
    setHideExplain(!hideExplain)
  }

  function move(d: 1 | -1) {
    if (!navRows.length) return
    const i = navRows.findIndex((r) => r.key === cursor)
    const n = navRows[i < 0 ? (d > 0 ? 0 : navRows.length - 1) : Math.min(navRows.length - 1, Math.max(0, i + d))]
    setCursor(n.key)
    document.querySelector<HTMLElement>(`[data-row="${CSS.escape(n.key)}"]`)?.focus()
  }

  function actOn(kind: 'adjust' | 'verify' | 'note', row: Row) {
    const f = row.findings[0] ? model.findingsById[row.findings[0]] : undefined
    const claimKind = row.claim ? model.claims[row.claim].kind : undefined
    if (kind === 'note') openAct({ type: 'note', target: row.claim ?? row.ref })
    else if (kind === 'verify' && row.claim) openAct({ type: 'verify', target: row.claim })
    else if (kind === 'verify') toast('Nothing to verify on this row', { description: 'Open it and verify the claim it points to.' })
    else if (f?.fix) openAct(fixToRequest(f))
    else if (row.claim && (claimKind === 'line' || claimKind === 'fact')) openAct({ type: 'adjust', target: row.claim })
    else toast('Nothing to adjust on this row', { description: 'Only a return line or a household fact takes an adjustment.' })
  }

  /** Posts what authorize() allows, in batches of 300 (the API limit); says what was skipped and why. `note` is the
   * caller's own skip clause (bulk accept's "skipped 2 not tied by a check", spec §2). Returns whether every batch landed
   * and the targets recorded, so a bulk act unpicks only the rows it acted on. */
  async function postAllowed(inputs: ActInput[], verb: string, skippedElsewhere: string[] = [], note = ''): Promise<{ ok: boolean; done: Set<string> }> {
    const checked = inputs.map((input) => ({ input, auth: ws.can(input) }))
    const allowed = checked.filter((c) => c.auth.ok).map((c) => c.input)
    const reasons = [...checked.flatMap((c) => (c.auth.ok ? [] : [plainMasked(c.auth.reason)])), ...skippedElsewhere]
    const done = new Set<string>()
    if (!allowed.length) {
      toast.error(`Nothing ${verb.toLowerCase()}`, { description: reasons[0] ?? (note ? `${verb} 0; ${note}` : 'Nothing selected can take this act.') })
      return { ok: false, done }
    }
    const skipped = `${note ? `; ${note}` : ''}${reasons.length ? ` · ${reasons.length} skipped (${reasons[0]})` : ''}`
    setBusy(true)
    let ok = true
    for (const part of chunk(allowed)) {
      const r = await ws.post(part, { undoLabel: `${verb} ${part.length}${skipped}` })
      if (!r.ok) {
        ok = false
        break
      }
      for (const i of part) done.add(i.target)
    }
    setBusy(false)
    return { ok, done }
  }

  async function disposePicked(disposition: DispositionT, reason: string): Promise<boolean> {
    const { inputs, skipped } = disposeInputs(model, pickedRows, disposition, reason)
    const { ok, done } = await postAllowed(inputs, 'Disposed', skipped.map((r) => `${clipPlain(r.title)} is cleared where it lives`))
    // disposeInputs targets a row's top finding, or the claim itself.
    unpick(pickedRows.filter((r) => !skipped.includes(r) && done.has(r.findings[0] ?? r.claim ?? '')))
    return ok
  }

  async function acceptPicked() {
    if (!level) return
    const { claims, skipped } = splitTied(pickedRows, state.claims)
    // Spec §2's wording: "Accepted N; skipped M not tied by a check".
    const note = skipped.length ? `skipped ${skipped.length} not tied by a check` : ''
    const { done } = await postAllowed(acceptInputs(model, state, claims, level), 'Accepted', [], note)
    unpick(pickedRows.filter((r) => r.claim !== undefined && done.has(r.claim)))
  }

  async function acceptTied(t: TiedRow) {
    if (level) await postAllowed(acceptInputs(model, state, t.claims, level), `Accepted (${t.label})`)
  }

  async function undo() {
    const target = lastUndoTarget(state.acts, viewer.id)
    if (!target) {
      toast('Nothing of yours to undo')
      return
    }
    const input: ActInput = { type: 'revert', target, body: { reason: 'Undone from the queue (u)' } }
    const auth = ws.can(input)
    if (!auth.ok) toast.error('Undo refused', { description: plainMasked(auth.reason) })
    else await ws.post([input], { undoLabel: `Undone: ${target}` })
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    const el = e.target instanceof Element ? e.target : null
    if (isTypingTarget(el) || inOverlay(el)) return
    const row = cursorRow
    // A focused button or link activates itself on Enter; Shift+Enter opens the full Trace page.
    if (e.key === 'Enter' && !e.shiftKey && el?.closest('button, a, summary')) return
    const keys: Record<string, (() => void) | undefined> = {
      j: () => move(1),
      k: () => move(-1),
      '/': () => search.current?.focus(),
      u: () => void undo(),
      Escape: () => setParams({ c: null }),
      Enter: row ? () => (e.shiftKey ? openFull(row) : select(row)) : undefined,
      x: row ? () => togglePick(row) : undefined,
      a: row ? () => actOn('adjust', row) : undefined,
      v: row ? () => actOn('verify', row) : undefined,
      n: row ? () => actOn('note', row) : undefined,
    }
    const run = keys[e.key]
    if (!run) return
    e.preventDefault()
    run()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const handlers = { onSelect: select, onOpen: openFull, onPick: togglePick, onCursor: (r: Row) => setCursor(r.key) }
  const filtered = filters.area !== null || filters.mine || filters.q.trim() !== ''
  const nothing = !allRows.length && !queue.tied.length
  const tiedCount = queue.tied.reduce((s, t) => s + t.claims.length, 0)

  return (
    <div className="grid lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <section aria-label="Queue" className="flex min-w-0 flex-col gap-3 p-3 lg:border-r">
        {/* The page's one h1 (the top bar's title is a link). sr-only is absolutely positioned, so the column's gap is unchanged. */}
        <h1 className="sr-only">Queue</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="queue-q" className="sr-only">
              Search the queue
            </label>
            <Input
              id="queue-q"
              ref={search}
              value={q}
              placeholder="Search by ref, label or finding"
              className="h-8 pl-7"
              onChange={(e) => {
                setQ(e.target.value)
                setParams({ q: e.target.value || null })
              }}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
            />
          </div>
          <Select items={AREA_OPTIONS} value={filters.area ?? ''} onValueChange={(v) => setParams({ area: v || null })}>
            <SelectTrigger aria-label="Filter by area">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AREA_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="flex items-center gap-1.5 text-xs">
            <Switch aria-label="Assigned to me" checked={filters.mine} onCheckedChange={(on) => setParams({ mine: on ? '1' : '0' })} />
            Assigned to me
          </span>
        </div>

        {shownPicks.length > 0 && (
          // Sticky only from lg: below it the header is taller and sticky too. The form is translucent, so the wrapper paints the page.
          <div className="bg-background lg:sticky lg:top-14 lg:z-20">
            <BulkBar
              count={shownPicks.length}
              busy={busy}
              acceptReason={level ? null : NOT_REVIEWER}
              onDispose={disposePicked}
              onAccept={() => void acceptPicked()}
              onClear={() => setPicked([])}
            />
          </div>
        )}

        {!nothing && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {!hideExplain && <p className="min-w-0 flex-1">Click a row to open it beside the list. Press ? for shortcuts.</p>}
            <Button size="xs" variant="ghost" className="ml-auto" onClick={toggleExplain}>
              {hideExplain ? 'Show explanations' : 'Hide explanations'}
            </Button>
          </div>
        )}

        {nothing && filtered ? (
          <div className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing matches these filters.{' '}
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setQ('')
                setParams({ area: null, mine: '0', q: null })
              }}
            >
              Show everything
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {queue.groups.map((g) => {
              const open = !closed.includes(g.key)
              const keys = g.rows.map((r) => r.key)
              return (
                <GroupView
                  key={g.key}
                  group={g}
                  count={g.rows.length}
                  countLabel={countLabel(g, g.rows.length)}
                  open={open}
                  explanation={hideExplain || !g.rows.length ? null : g.learn}
                  selectAll={{ state: pickState(picked, keys), enabled: open && keys.length > 0, onToggle: () => toggleAll(g.rows) }}
                  onToggle={(o) => toggleGroup(g.key, o)}
                  toolbar={g.key === 'new' && <MarkSeen seen={lastSeenSeq} head={state.head} onMark={ws.markSeen} />}
                >
                  {g.rows.length ? (
                    <ul>
                      {g.rows.map((r) => (
                        <RowView
                          key={r.key}
                          row={r}
                          model={model}
                          state={state}
                          selected={selected === r.ref}
                          cursor={cursor === r.key}
                          picked={picked.includes(r.key)}
                          on={handlers}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Nothing here{filtered ? ' for these filters' : ''}.</p>
                  )}
                </GroupView>
              )
            })}
            <GroupView
              group={TIED}
              count={tiedCount}
              countLabel={countLabel(TIED, tiedCount)}
              open={!closed.includes('tied')}
              explanation={hideExplain || !queue.tied.length ? null : TIED.learn}
              selectAll={null}
              onToggle={(o) => toggleGroup('tied', o)}
            >
              <ul>
                {queue.tied.map((t) => (
                  <li key={t.area} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-1.5 text-sm first:border-t-0">
                    <button
                      type="button"
                      onClick={() => setParams({ area: t.area })}
                      title="Filter the queue to this area"
                      className="min-w-0 flex-auto truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t.label}: <span className="tabular-nums">{t.claims.length}</span> read ok, 0 findings
                    </button>
                    {!level && <span className="text-xs text-muted-foreground">{NOT_REVIEWER}</span>}
                    <span title={level ? `Accept ${t.claims.length} tied claims as ${level}` : undefined} className="inline-flex">
                      <Button size="xs" variant="outline" disabled={!level || busy} onClick={() => void acceptTied(t)}>
                        {`Accept ${t.claims.length}`}
                      </Button>
                    </span>
                  </li>
                ))}
                {!queue.tied.length && <li className="px-3 py-2 text-xs text-muted-foreground">Nothing tied here.</li>}
              </ul>
            </GroupView>
          </div>
        )}
      </section>

      <aside aria-label="Selected claim" className={cn('min-w-0 border-t lg:border-t-0', !selected && 'hidden lg:block')}>
        <div className="lg:sticky lg:top-14 lg:max-h-[calc(100svh-3.5rem)] lg:overflow-y-auto">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                <RefLink to={selected} className="font-mono">
                  {selected}
                </RefLink>
                <span className="text-muted-foreground">· Shift+Enter or double-click opens the full page</span>
                <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Close the claim pane" onClick={() => setParams({ c: null })}>
                  <XIcon />
                </Button>
              </div>
              <ClaimPane key={selected} claimRef={selected} compact />
            </>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Select a row (click, or j / k then Enter) to see its evidence, history and fix here.</p>
          )}
        </div>
      </aside>
    </div>
  )
}

function MarkSeen({ seen, head, onMark }: { seen: number; head: number; onMark: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-1.5 text-xs text-muted-foreground">
      <span>New since you last marked the log seen.</span>
      <Button size="xs" variant="outline" disabled={seen >= head} onClick={onMark}>
        Mark seen
      </Button>
    </div>
  )
}
