// Browser side of the server API (ARCHITECTURE.md "Server API"). Responses are untrusted: checked here.
import { z } from 'zod'
import type { Act, ActType, PostActs } from '@/lib/model/acts'
import type { Packet } from '@/lib/model/packet-types'
import type { Viewer } from '@/lib/model/state'
import { TOUR_READ_ONLY_REASON, tourBlocksWrite } from '@/components/tour/guard'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const ViewerZ = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['preparer', 'reviewer', 'partner', 'firm_administrator', 'quality_reviewer', 'client']),
  kind: z.enum(['staff', 'client']),
  clearance: z.boolean(),
  active_from: z.string(),
  credential: z.string().nullish(),
})

const BootstrapZ = z.object({ engagement: z.string(), viewer: ViewerZ, identities: z.array(ViewerZ), packetSha: z.string() })
export interface Bootstrap {
  engagement: string
  viewer: Viewer
  identities: Viewer[]
  packetSha: string
}

const ACT_TYPES = [
  'verify', 'adjust', 'decide', 'dispose', 'note', 'reply', 'resolve', 'attach', 'signoff', 'request_approval',
  'client_approve', 'file', 'amend_open', 'revert', 'assign', 'time', 'clock', 'view_sensitive', 'agency_result',
] as const satisfies readonly ActType[]

const ActZ = z.object({
  seq: z.coerce.number().int(), // bigserial may arrive as a string
  id: z.string(),
  engagement: z.string(),
  recorded_at: z.string(),
  season_at: z.string(),
  actor: z.string(),
  actor_role: z.string(),
  type: z.enum(ACT_TYPES),
  target: z.string(),
  refs: z.array(z.string()),
  body: z.record(z.string(), z.unknown()),
  derived: z.record(z.string(), z.unknown()),
  batch_id: z.string().nullable(),
  hash: z.string(),
  prev_hash: z.string(),
})
const ActsZ = z.object({ acts: z.array(ActZ) })
const RevealZ = z.object({ value: z.string() })
const ReasonZ = z.object({ reason: z.string() })
const ErrorZ = z.object({ error: z.string() })
// The packet is 2 MB and typed by contract; only its outline is checked.
const PacketOutlineZ = z.object({
  packet: z.object({ name: z.string() }),
  firm: z.object({ staff: z.array(z.unknown()) }),
  documents: z.array(z.unknown()),
  extracted_values: z.array(z.unknown()),
  return_versions: z.array(z.unknown()).min(1),
})

export const TIMEOUT_MS = 10_000

// API calls time out, so a hung request cannot keep an act form busy (post() awaits the follow-up poll).
// The sha-pinned packet (2 MB, HTTP-cached) is exempt: on a slow link it may need longer.
async function call(url: string, init?: { method: 'POST'; body: unknown }, cache: RequestCache = 'no-store'): Promise<unknown> {
  const res = await fetch(url, {
    cache,
    method: init?.method ?? 'GET',
    headers: init ? { 'content-type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init.body) : undefined,
    signal: cache === 'no-store' ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError(0, `No answer from ${url.split('?')[0]} after ${TIMEOUT_MS / 1000} s`)
    throw e
  })
  const json: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const reason = ReasonZ.safeParse(json).data?.reason ?? ErrorZ.safeParse(json).data?.error
    throw new ApiError(res.status, reason ?? `${res.status} ${res.statusText || 'request failed'}`)
  }
  return json
}

function check<S extends z.ZodType>(url: string, schema: S, json: unknown): z.output<S> {
  const r = schema.safeParse(json)
  if (!r.success) throw new ApiError(0, `Unexpected response from ${url}: ${z.prettifyError(r.error)}`)
  return r.data
}

export async function getBootstrap(): Promise<Bootstrap> {
  return check('/api/bootstrap', BootstrapZ, await call('/api/bootstrap'))
}

/** Sha-pinned URL: the server marks it immutable, so the 2 MB masked packet comes from the HTTP cache after the first load. */
export async function getPacket(sha: string): Promise<Packet> {
  const json = await call(`/api/packet?sha=${encodeURIComponent(sha)}`, undefined, 'default')
  check('/api/packet', PacketOutlineZ, json)
  return json as Packet
}

export async function getActs(engagement: string, after: number): Promise<Act[]> {
  const url = `/api/acts?engagement=${encodeURIComponent(engagement)}&after=${after}`
  return check('/api/acts', ActsZ, await call(url)).acts
}

// The tour is read-only on the shared engagement (components/tour/guard.ts): its writes are refused here, before any request.
function refuseDuringTour(engagement: string): void {
  if (tourBlocksWrite(engagement)) throw new ApiError(403, TOUR_READ_ONLY_REASON)
}

export async function postActs(body: PostActs): Promise<Act[]> {
  refuseDuringTour(body.engagement)
  return check('/api/acts', ActsZ, await call('/api/acts', { method: 'POST', body })).acts
}

export async function postReveal(engagement: string, token: string, context: string): Promise<string> {
  refuseDuringTour(engagement)
  return check('/api/reveal', RevealZ, await call('/api/reveal', { method: 'POST', body: { engagement, token, context } })).value
}

export async function postIdentity(actor: string): Promise<void> {
  await call('/api/identity', { method: 'POST', body: { actor } })
}

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
