'use client'
// Season replay (spec §5.4): the Overview's Replay button and the bar that steps the dashboard through the log one
// change at a time. The committed point lives only in the URL (?at=<seq>&eng=<engagement>), written in place on
// release and on button clicks, never while dragging: a reload or a copied link keeps the point, and the history
// API is not flooded. Replay is read-only, so the bar shows masked values masked and offers no Reveal.
import { useEffect, useEffectEvent, useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, HistoryIcon } from 'lucide-react'
import { formatClock } from '@/components/atoms/format'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { VERB } from '@/components/workspace/log'
import type { Act } from '@/lib/model/acts'
import { displayMasked, splitMasked } from '@/lib/model/mask-token'

const AT = /^\d{1,15}$/

/**
 * The replay point the URL names: the first `index` acts of the log replay (0 = before the first change), and `seq`
 * is the last of them (0 for none). Null means live: `at` must be 0 or the seq of an act in this log, and `eng` this
 * engagement, so a link copied from another engagement never replays a log it does not name.
 */
export function parseReplayCursor(params: { get(k: string): string | null }, acts: Act[], engagement: string): { index: number; seq: number } | null {
  const at = params.get('at')
  if (at === null || !AT.test(at) || params.get('eng') !== engagement) return null
  const seq = Number(at)
  if (seq === 0) return { index: 0, seq: 0 }
  const i = acts.findIndex((a) => a.seq === seq)
  return i < 0 ? null : { index: i + 1, seq }
}

/** Writes the replay point in place, or removes it (null). History API updates reach useSearchParams without a server round trip. */
export function writeReplayCursor(point: { seq: number; engagement: string } | null): void {
  const p = new URLSearchParams(window.location.search)
  if (point) {
    p.set('at', String(point.seq))
    p.set('eng', point.engagement)
  } else {
    p.delete('at')
    p.delete('eng')
  }
  window.history.replaceState(null, '', `${window.location.pathname}${p.size ? `?${p}` : ''}${window.location.hash}`)
}

const plain = (text: string) => splitMasked(text).map((p) => (typeof p === 'string' ? p : displayMasked(p))).join('')

export function ReplayBar({ cursor, drag, onDrag }: {
  cursor: { index: number; seq: number } | null
  /** The thumb while it is dragged and not yet released; null otherwise. */
  drag: number | null
  /** The dragged index on every input; null when a button moves the point. */
  onDrag: (index: number | null) => void
}) {
  const { state, engagement, identities } = useWorkspace()
  const toggle = useRef<HTMLButtonElement>(null)
  const acts = state.acts
  const n = acts.length
  const names: Record<string, string> = Object.fromEntries(identities.map((v) => [v.id, v.name]))
  const who = (a: Act) => names[a.actor] ?? (a.actor === 'system' ? 'System' : a.actor)
  const did = (a: Act) => `${who(a)} ${VERB[a.type].toLowerCase()}`
  const describe = (i: number) => {
    const a = acts[i - 1]
    return a ? `Change ${i} of ${n}: ${did(a)} ${plain(a.target)}, ${formatClock(a.season_at)}` : 'Before the first change'
  }
  const banner = (c: { index: number; seq: number }) => {
    const a = acts[c.index - 1]
    if (!a) return 'Replaying: before the first change. Actions are off.'
    // The server writes a filing's simulated agency results right after it: say so, rather than look final.
    const answered = acts.slice(c.index).some((x) => x.type === 'agency_result' && x.target === `act:${c.seq}`)
    return `Replaying the dashboard as of change ${c.index} of ${n} (${did(a)}, ${formatClock(a.season_at)}). Actions are off.${answered ? " The agency's response to this filing comes in the next change." : ''}`
  }
  const commit = (i: number) => writeReplayCursor({ seq: i === 0 ? 0 : acts[i - 1].seq, engagement })
  // A button drops the drag first; the slider's own commit keeps it until the URL moves (see OverviewScreen).
  const go = (i: number) => {
    onDrag(null)
    commit(i)
  }
  const live = () => {
    onDrag(null)
    writeReplayCursor(null)
    toggle.current?.focus()
  }
  const index = cursor === null ? 0 : (drag ?? cursor.index)

  return (
    <>
      {n > 0 && (
        <Button
          ref={toggle}
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
          aria-expanded={cursor !== null}
          aria-controls={cursor ? 'replay-bar' : undefined}
          onClick={() => (cursor ? live() : go(n))}
        >
          <HistoryIcon /> Replay
        </Button>
      )}
      {cursor && (
        // min-w-0: as a flex item of the header its min-content is the one-line output, which would push the page
        // wider than a phone; with it the bar takes the header's width and the output truncates.
        <section id="replay-bar" aria-label="Season replay" className="flex min-w-0 basis-full flex-col gap-2 rounded-xl bg-muted px-3 py-2.5 ring-1 ring-foreground/10 ring-inset">
          <p role="status" className="text-sm">{banner(cursor)}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="One change back"
              disabled={cursor.index === 0}
              focusableWhenDisabled
              className="data-disabled:opacity-50"
              onClick={() => go(cursor.index - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <Scrubber value={index} max={n} text={describe(index)} onInput={onDrag} onCommit={commit} />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="One change forward"
              disabled={cursor.index >= n}
              focusableWhenDisabled
              className="data-disabled:opacity-50"
              onClick={() => go(cursor.index + 1)}
            >
              <ChevronRightIcon />
            </Button>
            {/* The slider speaks its aria-valuetext and the banner announces the committed point: no third voice. */}
            <output htmlFor="replay-range" aria-live="off" className="min-w-0 basis-full truncate text-xs text-muted-foreground tabular-nums sm:flex-1 sm:basis-0">
              {describe(index)}
            </output>
            <Button variant="outline" size="sm" onClick={live}>
              Back to live
            </Button>
          </div>
        </section>
      )}
    </>
  )
}

/**
 * A native range. React's onChange is the DOM input event (every step of a drag), so it only previews; the DOM
 * change event (on release, and on each key press) commits.
 */
function Scrubber({ value, max, text, onInput, onCommit }: { value: number; max: number; text: string; onInput: (i: number) => void; onCommit: (i: number) => void }) {
  const range = useRef<HTMLInputElement>(null)
  const commit = useEffectEvent((i: number) => onCommit(i))
  useEffect(() => {
    const el = range.current
    if (!el) return
    const onChange = () => commit(el.valueAsNumber)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  return (
    <input
      ref={range}
      id="replay-range"
      type="range"
      min={0}
      max={max}
      step={1}
      value={value}
      aria-label="Replay position"
      aria-valuetext={text}
      onChange={(e) => onInput(e.currentTarget.valueAsNumber)}
      className="h-7 min-w-40 flex-1 cursor-pointer accent-primary"
    />
  )
}
