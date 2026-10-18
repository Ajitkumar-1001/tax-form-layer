'use client'
// WorkspaceProvider: bootstraps in the browser (so every page is a static shell), keeps the act log
// fresh by polling, and is the only code that writes to /api. State is recomputed from packet + acts.
// Children render from the first (server) render on, so Next.js can prerender and validate every route
// segment; what reads the workspace waits under a <Suspense> (see useWorkspace).
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { z } from 'zod'
import { TriangleAlertIcon, RotateCwIcon, WifiOffIcon } from 'lucide-react'
import { ActHostProvider } from '@/components/acts/act-host'
import { Button } from '@/components/ui/button'
import { type Act, type ActInput, PostActsZ } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel, type Model } from '@/lib/model/build'
import { plainMasked } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import type { State, Viewer } from '@/lib/model/state'
import * as api from './api'
import { WorkspaceContext, WorkspaceLoading } from './context'
import { describeActs, mergeActs, offerUndo, readSeen, undoInput, writeSeen } from './log'
import { PageSkeleton, TopBarSkeleton } from './skeleton'
import type { PostResult, Workspace } from './types'

const POLL_MS = 3000

interface Log {
  engagement: string
  acts: Act[]
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [boot, setBoot] = useState<api.Bootstrap | null>(null)
  const [model, setModel] = useState<Model | null>(null)
  const [log, setLog] = useState<Log | null>(null)
  const [lastSeenSeq, setLastSeenSeq] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Set by the polling effect; post() and reveal() call it to pull the acts they caused.
  const pull = useRef<() => Promise<void>>(async () => {})
  // Latest log for handlers that outlive a render (the Undo button in a toast).
  const latest = useRef<Log | null>(null)
  // Highest seq the poll has returned. Every act up to it is held, so it is the base_seq that cannot skip an
  // unseen act (a POST response can run ahead of a gap). Set outside render, so it is current between renders.
  const polled = useRef(0)
  // Resolved after the first load commits; until then useWorkspace() suspends on it.
  const [loaded] = useState(() => Promise.withResolvers<void>())

  useEffect(() => {
    latest.current = log
  }, [log])

  useEffect(() => {
    let alive = true
    api
      .getBootstrap()
      .then(async (b) => {
        const packet = await api.getPacket(b.packetSha)
        if (!alive) return
        setBoot(b)
        setLastSeenSeq(readSeen(b.engagement, b.viewer.id))
        setModel(buildModel(packet))
      })
      .catch((e) => alive && setError(api.message(e)))
    return () => {
      alive = false
    }
  }, [attempt])

  const engagement = boot?.engagement
  useEffect(() => {
    if (!engagement) return
    let alive = true
    let loaded = false
    let busy = false
    let cursor = 0 // highest seq returned by GET; only GET advances it, so no act is ever skipped
    let chain = Promise.resolve()
    polled.current = 0
    const run = async () => {
      busy = true
      const got = await settle(api.getActs(engagement, cursor))
      busy = false
      if (!alive) return
      if (!got.ok) {
        if (loaded) setOffline(true)
        else setError(api.message(got.error))
        return
      }
      const acts = got.value
      for (const a of acts) cursor = Math.max(cursor, a.seq)
      polled.current = cursor
      loaded = true
      setOffline(false)
      setLog((prev) => {
        if (prev?.engagement !== engagement) return { engagement, acts: mergeActs([], acts) }
        const merged = mergeActs(prev.acts, acts)
        return merged === prev.acts ? prev : { engagement, acts: merged }
      })
    }
    const pullNow = () => (chain = chain.then(run))
    pull.current = pullNow
    void pullNow()
    const tick = setInterval(() => {
      if (!busy && document.visibilityState === 'visible') void pullNow()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [engagement, attempt])

  const ready = !!boot && !!model && log?.engagement === boot.engagement
  useEffect(() => {
    if (!ready) return
    // status/value are React's thenable fields: use() then reads the promise synchronously, so screens that
    // mount after the load (and never suspended on it) do not suspend for a tick.
    Object.assign(loaded.promise, { status: 'fulfilled', value: undefined })
    loaded.resolve()
  }, [ready, loaded])

  if (error) {
    return (
      <ErrorPanel
        message={error}
        onRetry={() => {
          setError(null)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }
  if (!boot || !model || !log) return <Frame ws={null} loaded={loaded.promise}>{children}</Frame>
  // An identity switch picked up another engagement (its cookie changed elsewhere): wait for that log.
  if (log.engagement !== boot.engagement) return <WorkspaceSkeleton />

  const { viewer, identities, packetSha } = boot
  const eng = boot.engagement
  const built: Model = model // the hoisted handlers below do not see the guard's narrowing
  const projected = tryProject(model, log.acts, viewer, eng)
  if (projected instanceof Error) return <ErrorPanel message={`The projection failed: ${projected.message}`} />
  const state: State = projected

  // `quiet` suppresses every toast (success and refusal): the caller shows the result itself, e.g. inline in a form.
  // `quietRefusal` suppresses only the refusal toast, for a form that prints the reason itself but still wants the
  // success toast and its Undo.
  // `undoLabel` replaces the success toast text. base_seq is the poll cursor (see `polled`), read from a ref so a
  // late Undo is not stale. The pull is awaited so the next post's base_seq already covers this one and any gap.
  async function post(inputs: ActInput[], opts: { quiet?: boolean; quietRefusal?: boolean; undoLabel?: string } = {}): Promise<PostResult> {
    const body = PostActsZ.safeParse({ engagement: eng, acts: inputs, base_seq: polled.current })
    if (!body.success) return refuse(400, `Not sent: ${z.prettifyError(body.error)}`, opts.quiet || opts.quietRefusal)
    const held = latest.current?.engagement === eng ? latest.current.acts : []
    const sent = await settle(api.postActs(body.data))
    if (!sent.ok) {
      void pull.current()
      return refuse(sent.error instanceof api.ApiError ? sent.error.status : 0, api.message(sent.error), opts.quiet || opts.quietRefusal)
    }
    const acts = sent.value
    setLog((prev) => (prev?.engagement === eng ? { engagement: eng, acts: mergeActs(prev.acts, acts) } : prev))
    await pull.current()
    if (!opts.quiet) {
      const targets = offerUndo(built, held, acts, viewer, eng)
      toast.success(opts.undoLabel ?? describeActs(acts), {
        action: targets.length ? { label: 'Undo', onClick: () => void undo(targets) } : undefined,
      })
    }
    return { ok: true, acts }
  }

  function refuse(status: number, reason: string, quiet?: boolean): PostResult {
    if (!quiet) {
      if (status === 409) toast.error('Someone changed this after you loaded it', { description: `${plainMasked(reason)} Review before overriding.` })
      else toast.error('Not recorded', { description: plainMasked(reason) })
    }
    return { ok: false, status, reason }
  }

  async function undo(targets: string[]) {
    const r = await post(targets.map(undoInput), { quiet: true })
    if (r.ok) toast.success('Undone')
    else toast.error('Undo refused', { description: plainMasked(r.reason) })
  }

  async function reveal(token: string, context: string): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
    const got = await settle(api.postReveal(eng, token, context))
    void pull.current() // either way the server logged the view (or the refusal) as an act
    return got.ok ? { ok: true, value: got.value } : { ok: false, reason: api.message(got.error) }
  }

  async function switchIdentity(id: string) {
    const got = await settle(api.postIdentity(id).then(api.getBootstrap))
    if (!got.ok) {
      toast.error('Could not switch identity', { description: api.message(got.error) })
      return
    }
    const b = got.value
    setBoot(b)
    setLastSeenSeq(readSeen(b.engagement, b.viewer.id))
    toast.success(`Now acting as ${b.viewer.name}`, { description: 'Demo identity, not authentication.' })
    if (b.viewer.kind === 'client' && !window.location.pathname.startsWith('/client')) router.push('/client')
  }

  function markSeen() {
    writeSeen(eng, viewer.id, state.head)
    setLastSeenSeq(state.head)
  }

  const ws: Workspace = {
    model, state, viewer, identities, engagement: eng, packetSha,
    post,
    can: (input) => authorize(model, state, input, viewer),
    reveal, switchIdentity, lastSeenSeq, markSeen,
  }
  const notice = offline && (
    <div role="status" className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900 shadow dark:bg-amber-950 dark:text-amber-100">
      <WifiOffIcon className="size-3.5" /> Connection lost: showing the log as of #{state.head}, retrying
    </div>
  )
  return (
    <Frame ws={ws} loaded={loaded.promise} notice={notice}>
      {children}
    </Frame>
  )
}

// Loading and loaded render this same tree, so the route below is not remounted when the load lands. The
// <Suspense> catches what reads the workspace without a closer boundary (e.g. a layout that needs it whole).
function Frame({ ws, loaded, notice, children }: { ws: Workspace | null; loaded: Promise<void>; notice?: ReactNode; children: ReactNode }) {
  return (
    <WorkspaceLoading value={loaded}>
      <WorkspaceContext value={ws}>
        <ActHostProvider>
          <Suspense fallback={<WorkspaceSkeleton />}>{children}</Suspense>
        </ActHostProvider>
        {notice}
      </WorkspaceContext>
    </WorkspaceLoading>
  )
}

// try/catch lives outside the component: the React compiler cannot lower `finally` or value blocks
// (?:, ??, ?.) inside a try, and would otherwise skip the whole provider.
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p }
  } catch (error) {
    return { ok: false, error }
  }
}

function tryProject(model: Model, acts: Act[], viewer: Viewer, engagement: string): State | Error {
  try {
    return project(model, acts, viewer, engagement)
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e))
  }
}

function WorkspaceSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b">
        <TopBarSkeleton />
      </div>
      <PageSkeleton />
    </div>
  )
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div role="alert" className="flex max-w-lg flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
        <div className="flex items-center gap-2 font-medium text-destructive">
          <TriangleAlertIcon className="size-4" /> The workpaper could not load
        </div>
        <p className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
            <RotateCwIcon /> Try again
          </Button>
        )}
      </div>
    </div>
  )
}
