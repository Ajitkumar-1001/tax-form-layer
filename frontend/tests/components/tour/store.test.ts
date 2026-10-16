// No jsdom: localStorage is stubbed, including the browsers that refuse it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRESH, parseTour, startTour } from '@/components/tour/machine'
import { closeTour, openTour, readTourEngaged, readTourRaw, resetTourMemory, subscribeTour, writeTour } from '@/components/tour/store'

function storage(opts: { failGet?: boolean; failSet?: boolean; seed?: string } = {}) {
  const data = new Map<string, string>(opts.seed ? [['wp:tour', opts.seed]] : [])
  return {
    data,
    getItem: (k: string) => {
      if (opts.failGet) throw new Error('blocked')
      return data.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (opts.failSet) throw new Error('quota')
      data.set(k, v)
    },
  }
}

afterEach(() => {
  resetTourMemory()
  vi.unstubAllGlobals()
})

describe('the stored tour', () => {
  it('is nothing before anything is written', () => {
    vi.stubGlobal('localStorage', storage())
    expect(readTourRaw()).toBeNull()
    expect(parseTour(readTourRaw())).toEqual(FRESH)
  })

  it('keeps what is written under wp:tour and reads it back', () => {
    const s = storage()
    vi.stubGlobal('localStorage', s)
    writeTour({ seen: true, step: 'checks' })
    expect(JSON.parse(s.data.get('wp:tour') ?? 'null')).toEqual({ seen: true, step: 'checks' })
    expect(parseTour(readTourRaw())).toEqual({ seen: true, step: 'checks' })
  })

  it('tells subscribers, until they unsubscribe', () => {
    vi.stubGlobal('localStorage', storage())
    const seen = vi.fn()
    const off = subscribeTour(seen)
    writeTour(startTour())
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    writeTour(startTour())
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('still works for this page view when the browser refuses to store', () => {
    vi.stubGlobal('localStorage', storage({ failSet: true }))
    writeTour({ seen: true, step: 'standing' })
    expect(parseTour(readTourRaw())).toEqual({ seen: true, step: 'standing' })
  })

  it('reads as a first visit when the browser refuses to read', () => {
    vi.stubGlobal('localStorage', storage({ failGet: true }))
    expect(parseTour(readTourRaw())).toEqual(FRESH)
  })

  it('opens at the first stop and closes for good', () => {
    vi.stubGlobal('localStorage', storage())
    openTour()
    expect(parseTour(readTourRaw())).toEqual(startTour())
    closeTour()
    expect(parseTour(readTourRaw())).toEqual({ seen: true, step: null })
  })
})

describe('engaged: whether this page view has touched the tour', () => {
  it('is false on a fresh page view even when a running tour is stored, so it can only be offered back', () => {
    vi.stubGlobal('localStorage', storage({ seed: JSON.stringify({ seen: true, step: 'checks' }) }))
    expect(parseTour(readTourRaw())).toEqual({ seen: true, step: 'checks' })
    expect(readTourEngaged()).toBe(false)
  })

  it('turns true the moment anything is written in this page view', () => {
    vi.stubGlobal('localStorage', storage())
    expect(readTourEngaged()).toBe(false)
    writeTour({ seen: true, step: 'checks' })
    expect(readTourEngaged()).toBe(true)
  })

  it('stays false when storage cannot be read: a first visit is a welcome, not a running tour', () => {
    vi.stubGlobal('localStorage', storage({ failGet: true }))
    expect(readTourEngaged()).toBe(false)
  })
})
