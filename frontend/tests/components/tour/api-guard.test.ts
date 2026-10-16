// The tour is read-only on the shared engagement, and the check sits where the requests are made (workspace/api.ts), so every
// caller is covered: the act forms, Undo, the queue's bulk actions, the clock, Reveal. fetch is stubbed, so "refused" means
// that no request was ever sent.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTourOpen, TOUR_READ_ONLY_REASON } from '@/components/tour/guard'
import { ApiError, getActs, postActs, postIdentity, postReveal } from '@/components/workspace/api'

const actsOk = () => new Response(JSON.stringify({ acts: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
const stub = () => {
  const f = vi.fn(async () => actsOk())
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  setTourOpen(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the tour write guard at the network layer', () => {
  it('refuses an act on the shared engagement while the tour is up, without sending anything', async () => {
    const f = stub()
    setTourOpen(true)
    const err = await postActs({ engagement: 'main', acts: [], base_seq: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).message).toBe(TOUR_READ_ONLY_REASON)
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses a Reveal on the shared engagement while the tour is up, without sending anything', async () => {
    const f = stub()
    setTourOpen(true)
    const err = await postReveal('main', '«ssn·3309·eq:abc»', 'household:theo#ssn').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe(TOUR_READ_ONLY_REASON)
    expect(f).not.toHaveBeenCalled()
  })

  it('sends the same requests once the tour is closed (the negative control: the guard is what stopped them)', async () => {
    const f = stub()
    await postActs({ engagement: 'main', acts: [], base_seq: 0 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('leaves a fresh copy writable while the tour is up, so there is somewhere to experiment', async () => {
    const f = stub()
    setTourOpen(true)
    await postActs({ engagement: 'copy-0a1b2c3d', acts: [], base_seq: 0 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('never blocks reading, or the identity cookie (it appends nothing to the log)', async () => {
    const f = stub()
    setTourOpen(true)
    await getActs('main', 0)
    await postIdentity('st-01')
    expect(f).toHaveBeenCalledTimes(2)
  })
})
