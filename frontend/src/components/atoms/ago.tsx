'use client'
import { useSyncExternalStore } from 'react'
import { formatClock, relativeTime } from './format'

// Wall clock as an external store, bucketed to 30 s so the snapshot is stable between ticks.
// The server snapshot is null: the prerendered HTML shows the absolute time, the browser the relative one.
const BUCKET = 30_000
const subscribe = (onTick: () => void) => {
  const t = setInterval(onTick, BUCKET)
  return () => clearInterval(t)
}
const wallNow = () => Math.floor(Date.now() / BUCKET) * BUCKET
const serverNow = () => null

/** "3 minutes ago" for `iso`, relative to `now` (e.g. the season clock) or the wall clock; full time on hover. */
export function Ago({ iso, now }: { iso: string; now?: string }) {
  const wall = useSyncExternalStore(subscribe, wallNow, serverNow)
  const from = now ? Date.parse(now) : wall
  return (
    <time dateTime={iso} title={`${formatClock(iso)} UTC`} className="whitespace-nowrap">
      {from == null ? formatClock(iso) : relativeTime(iso, from)}
    </time>
  )
}
