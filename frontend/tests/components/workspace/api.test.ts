import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getActs, getBootstrap, getPacket, postActs, postIdentity, postReveal, TIMEOUT_MS, UNREACHABLE } from '@/components/workspace/api'

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const row = {
  seq: '42', id: 'u', engagement: 'main', recorded_at: '2026-10-14T00:00:00Z', season_at: '2026-06-23T06:05:00Z', actor: 'st-01',
  actor_role: 'preparer', type: 'verify', target: 'F1040.1a', refs: ['F1040.1a'], body: {}, derived: {}, batch_id: null, hash: 'h', prev_hash: 'p',
}

describe('api', () => {
  it('parses acts and coerces a bigserial seq sent as a string', async () => {
    respond(200, { acts: [row], head: '42' })
    const acts = await getActs('main', 0)
    expect(acts[0].seq).toBe(42)
  })
  it('rejects a malformed response instead of passing it to the projection', async () => {
    respond(200, { acts: [{ ...row, type: 'nonsense' }] })
    await expect(getActs('main', 0)).rejects.toThrow(/Unexpected response from \/api\/acts/)
  })
  it('surfaces the server refusal reason and status', async () => {
    respond(403, { reason: 'Marcus Bell has no sensitive-data clearance' })
    const err = await postReveal('main', '«ssn·3309·eq:abc»', 'household:theo#ssn').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).message).toBe('Marcus Bell has no sensitive-data clearance')
  })
  it('validates the bootstrap viewer', async () => {
    const viewer = { id: 'st-01', name: 'Priya Raman', role: 'preparer', kind: 'staff', clearance: true, active_from: '2025-08-01', credential: null }
    respond(200, { engagement: 'main', viewer, identities: [viewer], packetSha: 'ee01f8508bd2' })
    expect((await getBootstrap()).viewer.name).toBe('Priya Raman')
    respond(200, { engagement: 'main', viewer: { ...viewer, role: 'admin' }, identities: [], packetSha: 'x' })
    await expect(getBootstrap()).rejects.toThrow(ApiError)
  })
  // Regression: post() awaits the follow-up GET, so a hung request kept the act form busy with no toast.
  it('times out API calls with a readable reason, but not the packet download', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('signal timed out', 'TimeoutError')))
    const hang = vi.fn((_url: string, init?: RequestInit) =>
      init?.signal?.aborted ? Promise.reject(init.signal.reason) : new Promise<Response>(() => {}),
    )
    vi.stubGlobal('fetch', hang)
    await expect(getActs('main', 0)).rejects.toThrow(`No answer from /api/acts after ${TIMEOUT_MS / 1000} s`)
    await expect(postActs({ engagement: 'main', acts: [], base_seq: 0 })).rejects.toBeInstanceOf(ApiError)
    expect(timeout).toHaveBeenCalledWith(TIMEOUT_MS)
    void getPacket('sha')
    expect(hang.mock.calls.at(-1)?.[1]?.signal).toBeUndefined()
  })
  // The browser rejects fetch with a bare TypeError('Failed to fetch') when the request never leaves the machine. Mapped at the
  // source, so every caller (acts, Reveal, identity switch, boot) shows words, and a POST that may have landed is not called a no-op.
  it('a request that cannot reach the server says so in words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const err = await postReveal('main', '«ssn·3309·eq:abc»', 'household:theo#ssn').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
    expect((err as ApiError).message).toBe(UNREACHABLE)
    expect(UNREACHABLE).toBe('Could not reach the server; check your connection and try again.')
  })
  it('says so for acts, the identity switch, the poll, boot and the packet download too (the mapping sits in call())', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const sends = [
      () => postActs({ engagement: 'main', acts: [], base_seq: 0 }),
      () => postIdentity('st-01'),
      () => getActs('main', 0),
      () => getBootstrap(),
      () => getPacket('sha'),
    ]
    for (const send of sends) {
      const err = await send().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(0)
      expect((err as ApiError).message).toBe(UNREACHABLE)
    }
  })
})
