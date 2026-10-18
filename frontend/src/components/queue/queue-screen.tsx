'use client'
// The Queue: the list of work grouped by consequence, full width, and the claim drawer for ?c=<ref> (claim-drawer.tsx).
// Filters live in the URL (area, mine, q). Picks are kept until acted on or cleared, but the bulk bar counts and acts
// only on visible ones; its Clear clears every pick, hidden ones included (ruled).
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { SearchIcon } from 'lucide-react'
import { refHref } from '@/components/atoms'
import { useOpenAct } from '@/components/acts/act-host'
import { type DispositionT, type LevelT, fixToRequest } from '@/components/acts/draft'
import { inertButton, takesQueueKeys } from '@/components/shell/keys'
import { CLAIM_DRAWER_TITLE_ID } from '@/components/trace/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/components/workspace/context'
import type { OpenActRequest } from '@/components/workspace/types'
import type { Act, ActInput } from '@/lib/model/acts'
import { AREAS, AREA_LABEL } from '@/lib/model/ids'
import { plainMasked } from '@/lib/model/mask-token'
import type { AuthResult, State } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { BulkBar } from './bulk-bar'
import { ClaimDrawer, canClose, closeAction, drawerEntry, keepsDrawerMark, openWrite } from './claim-drawer'
import {
  GROUPS, type GroupKey, type Row, type TiedRow,
  acceptInputs, acceptLevel, buildQueue, chunk, disposeInputs, lastUndoTarget, listRegainsFocus, parseFilters,
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
// The open drawer's width as right padding, from lg up to xl only: from xl the section itself pads by it.
const ROOM = 'lg:max-xl:pr-[min(36rem,45vw)]'

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

/** Why Accept is refused (the tied Accept N and the bulk bar; spec §3: disabled, with the reason as text): the role
 *  sentence without the role, else authorize()'s reason for the first input in display form, else null. One input
 *  stands for the batch; with none to judge it is null and the toast says why. */
export function acceptRefusal(level: LevelT | null, first: ActInput | undefined, can: (input: ActInput) => AuthResult): string | null {
  if (!level) return NOT_REVIEWER
  const auth = first ? can(first) : null
  return auth && !auth.ok ? plainMasked(auth.reason) : null
}

/** A bulk post's toast text (postAllowed, and undo's refusal): the inputs authorize() allows; `none`, the description
 *  when it allows none (the caller's note and the first reason, joined); and `tail`, what the undo label adds after
 *  "<verb> N". Every reason is in display form (tokens as •••-••-3309). */
export function postText(
  checked: readonly { input: ActInput; auth: AuthResult }[], verb: string, skippedElsewhere: readonly string[] = [], note = '',
): { allowed: ActInput[]; none: string; tail: string } {
  const allowed = checked.filter((c) => c.auth.ok).map((c) => c.input)
  const reasons = [...checked.flatMap((c) => (c.auth.ok ? [] : [c.auth.reason])), ...skippedElsewhere].map(plainMasked)
  const none = [note && `${verb} 0; ${note}`, reasons[0]].filter(Boolean).join(' · ') || 'Nothing selected can take this act.'
  const tail = `${note ? `; ${note}` : ''}${reasons.length ? ` · ${reasons.length} skipped (${reasons[0]})` : ''}`
  return { allowed, none, tail }
}

/** ?c as the URL has it now. useSearchParams lags it: Next commits the History API sync in a transition. */
const liveC = (): string | null => new URLSearchParams(window.location.search).get('c')

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

/**
 * History API updates sync with useSearchParams without a server round trip (Next docs, linking-and-navigating). Only
 * opening the drawer pushes, and it marks that entry as the drawer's (claim-drawer.tsx) so closing can go back. A replace
 * keeps the mark only when it writes ?c alone and ?c stays; a filter write (any other key) replaces with a null state, so
 * a later close replaces ?c away instead of going back to the entry with the old filters (spec §6). Never pass
 * history.state itself: it holds Next's keys, and Next skips its sync for those.
 */
function setParams(updates: Record<string, string | null>, push = false): void {
  const p = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) p.delete(k)
    else p.set(k, v)
  }
  const url = `${window.location.pathname}${p.size ? `?${p}` : ''}`
  if (push) window.history.pushState(drawerEntry(), '', url)
  else window.history.replaceState(keepsDrawerMark(updates, p.has('c'), window.history.state) ? drawerEntry() : null, '', url)
}

/** The keyboard cursor: its row's key, and the row's index when it was set, for when that row leaves the list. */
export interface Cursor {
  key: string
  index: number
}

/** The cursor row's index in navRows: its key while it is listed, else the row now at its old index (clamped); -1 for none. */
export function cursorIndex(navRows: readonly { key: string }[], cursor: Cursor | null): number {
  if (!cursor || !navRows.length) return -1
  const i = navRows.findIndex((r) => r.key === cursor.key)
  return i >= 0 ? i : Math.min(cursor.index, navRows.length - 1)
}

/**
 * The cursor once ?c changes: it stays on a row that already shows c (rows can share a ref across groups, and j / k must
 * not jump back to the first of them), else it moves to the first row showing c, else it stays.
 */
export function cursorFrom(navRows: readonly { key: string; ref: string }[], c: string | null, cursor: Cursor | null): Cursor | null {
  const at = cursorIndex(navRows, cursor)
  if (!c || (at >= 0 && navRows[at].ref === c)) return cursor
  const i = navRows.findIndex((r) => r.ref === c)
  return i < 0 ? cursor : { key: navRows[i].key, index: i }
}

/** j / k from index i of n rows: -1 (no cursor) starts at the top for j and the bottom for k; null at the ends, which stop. */
export function stepCursor(n: number, i: number, d: 1 | -1): number | null {
  if (!n) return null
  if (i < 0) return d > 0 ? 0 : n - 1
  const next = i + d
  return next < 0 || next >= n ? null : next
}

const UNDO_REASON = 'Undone from the queue (u)'

/** u: the Revert form for the viewer's last live act or batch, its reason filled in. A key that writes opens a dialog
 *  (rule 13): a revert cannot itself be reverted (authorize.ts), so it could leave no Undo. null: nothing of theirs is live. */
export function undoRequest(acts: Act[], viewerId: string): OpenActRequest | null {
  const target = lastUndoTarget(acts, viewerId)
  return target ? { type: 'revert', target, prefill: { reason: UNDO_REASON } } : null
}

export function QueueScreen() {
  const ws = useWorkspace()
  const { model, state, viewer, lastSeenSeq } = ws
  const params = useSearchParams()
  const router = useRouter()
  const openAct = useOpenAct()
  const [hideExplain, setHideExplain] = useState(readHidden)
  const [closed, setClosed] = useState<GroupKey[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [cursorFor, setCursorFor] = useState<string | null>(null)
  // Never pruned when a filter changes, so undoing the filter restores the selection.
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState(params.get('q') ?? '')
  const search = useRef<HTMLInputElement>(null)
  const worklist = useRef<HTMLElement>(null)
  // The ?c a close started on, and the claim the drawer was last pointed at (canClose in claim-drawer.tsx).
  const closing = useRef<string | null>(null)
  const shownRef = useRef<string | null>(params.get('c'))

  const filters = { ...parseFilters(params, viewer), q }
  const selected = params.get('c')
  const queue = buildQueue(model, state, lastSeenSeq, filters)
  const allRows = queue.groups.flatMap((g) => g.rows)
  const navRows = queue.groups.filter((g) => !closed.includes(g.key)).flatMap((g) => g.rows)
  // The cursor follows every ?c change (a click, Enter, j / k, Back, a deep link): adjusted while rendering, not in an effect.
  if (cursorFor !== selected) {
    setCursorFor(selected)
    setCursor(cursorFrom(navRows, selected, cursor))
  }
  const at = cursorIndex(navRows, cursor)
  const cursorRow = at >= 0 ? navRows[at] : null
  const shownPicks = visiblePicked(picked, navRows)
  const pickedRows = navRows.filter((r) => shownPicks.includes(r.key))
  const level = acceptLevel(viewer)

  const pointAt = (row: Row) => setCursor({ key: row.key, index: Math.max(0, navRows.findIndex((r) => r.key === row.key)) })
  const select = (row: Row) => {
    pointAt(row)
    // Opening pushes one history entry, so Back closes the drawer; switching claims while it is open replaces. Judged on
    // the live ?c, so a second click before the first commits pushes nothing.
    const write = openWrite(liveC(), row.ref)
    if (!write) {
      // The claim already open: Enter or a click on its row takes the keyboard back to the drawer (spec §5, as amended).
      document.getElementById(CLAIM_DRAWER_TITLE_ID)?.focus()
      return
    }
    shownRef.current = row.ref
    closing.current = null
    setParams({ c: row.ref }, write === 'push')
  }
  useEffect(() => {
    shownRef.current = selected
    closing.current = null
  }, [selected])
  // Every traversal ends a close in flight, even one landing on an entry with the same ?c, which leaves `selected` as it
  // was: without this the guard would refuse every later ✕ and Esc.
  useEffect(() => {
    const reset = () => {
      closing.current = null
    }
    window.addEventListener('popstate', reset)
    return () => window.removeEventListener('popstate', reset)
  }, [])
  /** ✕ and Esc. Only while the live ?c is the drawer's claim, and once: Back lands a tick later, and Base UI can report
   *  one Esc twice, so a second call in that tick must not go back again and leave /queue. */
  const closeDrawer = () => {
    const c = liveC()
    if (!canClose(c, shownRef.current, closing.current)) return
    closing.current = c
    if (closeAction(window.history.state) === 'back') window.history.back()
    else setParams({ c: null })
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
    const i = stepCursor(navRows.length, at, d)
    if (i === null) return
    const n = navRows[i]
    setCursor({ key: n.key, index: i })
    const el = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(n.key)}"]`)
    // The live ?c: j right after opening moves the drawer, even before the open commits.
    if (!liveC()) {
      el?.focus()
      return
    }
    // The drawer follows the cursor; focus moves to its new title once ?c changes (claim-drawer.tsx), not to the row.
    el?.scrollIntoView({ block: 'nearest' })
    shownRef.current = n.ref
    setParams({ c: n.ref })
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
    const { allowed, none, tail } = postText(inputs.map((input) => ({ input, auth: ws.can(input) })), verb, skippedElsewhere, note)
    const done = new Set<string>()
    if (!allowed.length) {
      toast.error(`Nothing ${verb.toLowerCase()}`, { description: none })
      return { ok: false, done }
    }
    setBusy(true)
    let ok = true
    for (const part of chunk(allowed)) {
      const r = await ws.post(part, { undoLabel: `${verb} ${part.length}${tail}` })
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

  function undo() {
    const req = undoRequest(state.acts, viewer.id)
    if (!req) {
      toast('Nothing of yours to undo')
      return
    }
    const input: ActInput = { type: 'revert', target: req.target, body: { reason: UNDO_REASON } }
    const { allowed, none } = postText([{ input, auth: ws.can(input) }], 'Undone')
    if (!allowed.length) toast.error('Undo refused', { description: none })
    else openAct(req)
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target instanceof Element ? e.target : null
    // A key another component handled stays its own, but not on a refused drawer button that keeps focus: Base UI prevents
    // every key there but Tab (keys.ts, inertButton).
    if (e.defaultPrevented && !inertButton(el)) return
    // Only inside the worklist or the drawer, never in a field, on a Select trigger or in an overlay (rule 13, keys.ts).
    if (!takesQueueKeys(el)) return
    const row = cursorRow
    // A focused button or link activates itself on Enter; Shift+Enter opens the full Trace page.
    if (e.key === 'Enter' && !e.shiftKey && el?.closest('button, a, summary')) return
    // With the drawer open, x / a / v / n act only on the claim it shows; Enter on that claim's row moves focus to the
    // drawer's heading (select). Escape is the drawer's alone (claim-drawer.tsx).
    const shown = !!row && row.ref === selected
    const target = row && (!selected || shown) ? row : null
    const keys: Record<string, (() => void) | undefined> = {
      j: () => move(1),
      k: () => move(-1),
      '/': () => search.current?.focus(),
      u: undo,
      Enter: row ? () => (e.shiftKey ? openFull(row) : select(row)) : undefined,
      x: target ? () => togglePick(target) : undefined,
      a: target ? () => actOn('adjust', target) : undefined,
      v: target ? () => actOn('verify', target) : undefined,
      n: target ? () => actOn('note', target) : undefined,
    }
    const run = keys[e.key]
    if (!run) return
    e.preventDefault()
    // Pressed on the section itself (a focus return, search Esc, a click on its text): start from the cursor row. A dialog a
    // key opens gives focus back to what had it, and Base UI turns a tabIndex -1 element into its first tabbable child, the
    // search box, where the next letter would type.
    if (el === worklist.current && row) document.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.key)}"]`)?.focus({ preventScroll: true })
    run()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  // The bulk bar unmounts with the last pick (Clear, or a Dispose or an Accept that landed) and drops the focus inside it on
  // <body>, where the keys never run: the worklist takes it back (listRegainsFocus). From 0, so the first mount moves nothing.
  const hadPicks = useRef(0)
  useEffect(() => {
    const prev = hadPicks.current
    hadPicks.current = shownPicks.length
    if (listRegainsFocus(prev, shownPicks.length, document.activeElement === document.body)) worklist.current?.focus({ preventScroll: true })
  }, [shownPicks.length])

  const handlers = { onSelect: select, onOpen: openFull, onPick: togglePick, onCursor: pointAt }
  const filtered = filters.area !== null || filters.mine || filters.q.trim() !== ''
  const nothing = !allRows.length && !queue.tied.length
  const tiedCount = queue.tied.reduce((s, t) => s + t.claims.length, 0)
  const acceptWhy = (claims: string[]) => acceptRefusal(level, level ? acceptInputs(model, state, claims.slice(0, 1), level)[0] : undefined, ws.can)

  return (
    <>
      {/* Room for the open drawer (lg:w-[min(36rem,45vw)] in claim-drawer.tsx). From xl the section pads by its width, so it
          covers nothing. From lg to xl it overlays the right of the list, whose rows stay reachable by scrolling and j / k,
          while the controls (the toolbar, the bulk bar, the explanations row and each tied block) pad by it (ROOM), so
          none sits under it (spec §2, as amended). The section is the worklist: it owns the single keys (takesQueueKeys).
          It is also the focus return (act-host.tsx returnFocusTo) for an act that a key opens from a row when the act then
          moves or removes that row. It outlives every row. */}
      <section
        ref={worklist}
        aria-label="Queue"
        data-worklist=""
        data-focus-return
        tabIndex={-1}
        className={cn('flex min-w-0 flex-col gap-3 p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected && 'xl:pr-[min(36rem,45vw)]')}
      >
        {/* The page's one h1 (the top bar's title is a link). sr-only is absolutely positioned, so the column's gap is unchanged. */}
        <h1 className="sr-only">Queue</h1>
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', selected && ROOM)}>
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
              // Esc leaves the field for the worklist, where the keys run (rule 13), not for <body>; the next key starts from
              // the cursor row (onKey). worklist.current is read in a handler, which the React Compiler allows.
              onKeyDown={(e) => e.key === 'Escape' && worklist.current?.focus({ preventScroll: true })}
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
          <div className={cn('bg-background lg:sticky lg:top-14 lg:z-20', selected && ROOM)}>
            <BulkBar
              count={shownPicks.length}
              busy={busy}
              acceptReason={acceptWhy(splitTied(pickedRows, state.claims).claims)}
              onDispose={disposePicked}
              onAccept={() => void acceptPicked()}
              onClear={() => setPicked([])}
            />
          </div>
        )}

        {!nothing && (
          <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', selected && ROOM)}>
            {!hideExplain && <p className="min-w-0 flex-1">Click a row to open it beside the list. Press ? for shortcuts.</p>}
            <Button size="xs" variant="ghost" className="ml-auto" onClick={toggleExplain}>
              {hideExplain ? 'Show explanations' : 'Hide explanations'}
            </Button>
          </div>
        )}

        {nothing && filtered ? (
          <div className={cn('rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground', selected && ROOM)}>
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
                          cursor={cursorRow?.key === r.key}
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
                {queue.tied.map((t) => {
                  // Judged on the first claim, so a refusal other than the role (a frozen return) disables it too.
                  const why = acceptWhy(t.claims)
                  return (
                    <li key={t.area} className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-1.5 text-sm first:border-t-0', selected && ROOM)}>
                      <button
                        type="button"
                        onClick={() => setParams({ area: t.area })}
                        title="Filter the queue to this area"
                        className="min-w-0 flex-auto truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t.label}: <span className="tabular-nums">{t.claims.length}</span> read ok, 0 findings
                      </button>
                      {why && <span className="text-xs text-muted-foreground">{why}</span>}
                      <span title={why ? undefined : `Accept ${t.claims.length} tied claims as ${level}`} className="inline-flex">
                        <Button size="xs" variant="outline" disabled={why !== null || busy} onClick={() => void acceptTied(t)}>
                          {`Accept ${t.claims.length}`}
                        </Button>
                      </span>
                    </li>
                  )
                })}
                {!queue.tied.length && <li className="px-3 py-2 text-xs text-muted-foreground">Nothing tied here.</li>}
              </ul>
            </GroupView>
          </div>
        )}
      </section>

      <ClaimDrawer selected={selected} onClose={closeDrawer} finalFocusKey={cursorRow?.key ?? null} />
    </>
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
