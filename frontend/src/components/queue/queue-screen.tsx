'use client'
// The Queue (spec §3.1), home for preparer, reviewer and partner: Next card, area strip and grouped rows on
// the left; the claim pane for ?c=<ref> on the right. Filters live in the URL (area, mine, q).
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { SearchIcon, XIcon } from 'lucide-react'
import { RefLink, refHref } from '@/components/atoms'
import { useOpenAct } from '@/components/acts/act-host'
import { type DispositionT, fixToRequest } from '@/components/acts/draft'
import { ClaimPane } from '@/components/trace/claim-pane'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/components/workspace/context'
import type { ActInput } from '@/lib/model/acts'
import { AREA_LABEL, type AreaKey } from '@/lib/model/ids'
import type { AuthResult } from '@/lib/model/state'
import { cn } from '@/lib/utils'
import { AreaStrip } from './area-strip'
import { BulkBar } from './bulk-bar'
import { NextCard } from './next-card'
import {
  GROUPS, type GroupKey, type NextAction, type Row, SUPPORT_LEGEND, type TiedRow,
  acceptInputs, acceptLevel, buildQueue, chunk, disposeInputs, lastUndoTarget, nextAction, parseFilters,
} from './queue-model'
import { GroupView, RowView } from './queue-rows'

const LEARN_KEY = 'wp:learn'
const TIED = GROUPS.find((g) => g.key === 'tied')!
const NOT_REVIEWER = 'Accepting a tied check is a reviewer or partner act.'

function readLearn(): boolean {
  try {
    return localStorage.getItem(LEARN_KEY) === '1'
  } catch {
    return false
  }
}

function writeLearn(on: boolean): void {
  try {
    localStorage.setItem(LEARN_KEY, on ? '1' : '0')
  } catch {
    // storage unavailable: learn mode lasts for this page view only
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
  const { model, state, viewer, identities, lastSeenSeq } = ws
  const params = useSearchParams()
  const router = useRouter()
  const openAct = useOpenAct()
  const [learn, setLearn] = useState(readLearn)
  const [nextOpen, setNextOpen] = useState(learn)
  const [closed, setClosed] = useState<GroupKey[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState(params.get('q') ?? '')
  const search = useRef<HTMLInputElement>(null)

  const filters = { ...parseFilters(params, viewer), q }
  const selected = params.get('c')
  const queue = buildQueue(model, state, lastSeenSeq, filters)
  const next = nextAction(model, state, viewer)
  const names: Record<string, string> = Object.fromEntries(identities.map((v) => [v.id, v.name]))
  const allRows = queue.groups.flatMap((g) => g.rows)
  const navRows = queue.groups.filter((g) => !closed.includes(g.key)).flatMap((g) => g.rows)
  const cursorRow = navRows.find((r) => r.key === cursor) ?? null
  const pickedRows = allRows.filter((r) => picked.includes(r.key))
  const level = acceptLevel(viewer)

  const select = (row: Row) => {
    setCursor(row.key)
    setParams({ c: row.ref }, true)
  }
  const openFull = (row: Row) => router.push(refHref(row.ref))
  const togglePick = (row: Row) => setPicked((p) => (p.includes(row.key) ? p.filter((k) => k !== row.key) : [...p, row.key]))
  const toggleGroup = (k: GroupKey, open: boolean) => setClosed((c) => (open ? c.filter((x) => x !== k) : c.includes(k) ? c : [...c, k]))
  const setLearnMode = (on: boolean) => {
    setLearn(on)
    setNextOpen(on)
    writeLearn(on)
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

  /** Posts what authorize() allows, in batches of 300 (the API limit); says what was skipped and why. */
  async function postAllowed(inputs: ActInput[], verb: string, skippedElsewhere: string[] = []): Promise<boolean> {
    const checked = inputs.map((input) => ({ input, auth: ws.can(input) }))
    const allowed = checked.filter((c) => c.auth.ok).map((c) => c.input)
    const reasons = [...checked.flatMap((c) => (c.auth.ok ? [] : [c.auth.reason])), ...skippedElsewhere]
    if (!allowed.length) {
      toast.error(`Nothing ${verb.toLowerCase()}`, { description: reasons[0] ?? 'Nothing selected can take this act.' })
      return false
    }
    const skipped = reasons.length ? ` · ${reasons.length} skipped (${reasons[0]})` : ''
    setBusy(true)
    let ok = true
    for (const part of chunk(allowed)) {
      const r = await ws.post(part, { undoLabel: `${verb} ${part.length}${skipped}` })
      if (!r.ok) {
        ok = false
        break
      }
    }
    setBusy(false)
    return ok
  }

  async function disposePicked(disposition: DispositionT, reason: string): Promise<boolean> {
    const { inputs, skipped } = disposeInputs(model, pickedRows, disposition, reason)
    const ok = await postAllowed(inputs, 'Disposed', skipped.map((r) => `${r.title.slice(0, 40)}… is cleared where it lives`))
    if (ok) setPicked([])
    return ok
  }

  async function acceptPicked() {
    if (!level) return
    const claims = [...new Set(pickedRows.flatMap((r) => (r.claim ? [r.claim] : [])))]
    if (await postAllowed(acceptInputs(model, state, claims, level), 'Accepted')) setPicked([])
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
    if (!auth.ok) toast.error('Undo refused', { description: auth.reason })
    else await ws.post([input], { undoLabel: `Undone: ${target}` })
  }

  function go(n: NextAction, auth: AuthResult) {
    setParams({ c: n.ref }, true)
    if (n.request && auth.ok) openAct(n.request)
    else if (!auth.ok) toast('Opened the claim; the fix is not yours to record', { description: auth.reason })
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    const el = e.target instanceof Element ? e.target : null
    if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
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

  return (
    <div className="grid lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <section aria-label="Queue" className="flex min-w-0 flex-col gap-3 p-3 lg:border-r">
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
          <span className="flex items-center gap-1.5 text-xs">
            <Switch aria-label="Assigned to me" checked={filters.mine} onCheckedChange={(on) => setParams({ mine: on ? '1' : '0' })} />
            Assigned to me
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <Switch aria-label="Learn mode" checked={learn} onCheckedChange={setLearnMode} />
            Learn mode
          </span>
          {filters.area && (
            <Button size="xs" variant="secondary" onClick={() => setParams({ area: null })} aria-label={`Clear the area filter (${AREA_LABEL[filters.area]})`}>
              {AREA_LABEL[filters.area]}
              <XIcon />
            </Button>
          )}
        </div>
        <KeyHints />

        <NextCard next={next} open={nextOpen} onOpenChange={setNextOpen} onGo={go} />
        <AreaStrip areas={state.areas} active={filters.area} names={names} onPick={(a: AreaKey | null) => setParams({ area: a })} />
        {learn && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Support letters: </span>
            {SUPPORT_LEGEND}
          </p>
        )}
        {picked.length > 0 && (
          <BulkBar
            count={pickedRows.length}
            busy={busy}
            acceptReason={level ? null : NOT_REVIEWER}
            onDispose={disposePicked}
            onAccept={() => void acceptPicked()}
            onClear={() => setPicked([])}
          />
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
            {queue.groups.map((g) => (
              <GroupView
                key={g.key}
                group={g}
                count={g.rows.length}
                open={!closed.includes(g.key)}
                learn={learn}
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
                        names={names}
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
            ))}
            <GroupView
              group={TIED}
              count={queue.tied.reduce((s, t) => s + t.claims.length, 0)}
              open={!closed.includes('tied')}
              learn={learn}
              onToggle={(o) => toggleGroup('tied', o)}
            >
              <ul>
                {queue.tied.map((t) => (
                  <li key={t.area} className="flex items-center gap-2 border-t px-3 py-1.5 text-sm first:border-t-0">
                    <button
                      type="button"
                      onClick={() => setParams({ area: t.area })}
                      title="Filter the queue to this area"
                      className="min-w-0 flex-1 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t.label}: <span className="tabular-nums">{t.claims.length}</span> read ok, 0 findings
                    </button>
                    <span title={level ? `Accept ${t.claims.length} tied claims as ${level}` : NOT_REVIEWER} className="inline-flex">
                      <Button size="xs" variant="outline" disabled={!level || busy} onClick={() => void acceptTied(t)}>
                        Accept all
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
        <div className="lg:sticky lg:top-21 lg:max-h-[calc(100svh-7.5rem)] lg:overflow-y-auto">
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
      <span>
        Last looked at act #{seen}; the log is at #{head}.
      </span>
      <Button size="xs" variant="outline" disabled={seen >= head} onClick={onMark}>
        Mark seen
      </Button>
    </div>
  )
}

const HINTS: [string, string][] = [
  ['j k', 'move'], ['Enter', 'open'], ['Esc', 'close'], ['x', 'select'], ['a', 'adjust'], ['v', 'verify'], ['n', 'note'], ['u', 'undo'], ['/', 'search'],
]

function KeyHints() {
  return (
    <div role="group" className="hidden flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground md:flex" aria-label="Keyboard shortcuts">
      {HINTS.map(([k, what]) => (
        <span key={k} className="flex items-center gap-1">
          <Kbd>{k}</Kbd>
          {what}
        </span>
      ))}
    </div>
  )
}
