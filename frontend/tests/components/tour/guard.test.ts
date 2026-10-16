import { afterEach, describe, expect, it } from 'vitest'
import { setTourOpen, TOUR_READ_ONLY_REASON, tourBlocksWrite } from '@/components/tour/guard'
import { DEFAULT_ENGAGEMENT } from '@/lib/server/identity'

afterEach(() => setTourOpen(false))

describe('the tour write guard', () => {
  it('blocks nothing while the tour is closed', () => {
    expect(tourBlocksWrite('main')).toBe(false)
    expect(tourBlocksWrite('copy-0a1b2c3d')).toBe(false)
  })

  it('blocks writes to the shared engagement while the tour is up', () => {
    setTourOpen(true)
    expect(tourBlocksWrite('main')).toBe(true)
  })

  it('guards the engagement the server treats as the shared one: the guard\'s literal and the server\'s default must agree', () => {
    setTourOpen(true)
    expect(tourBlocksWrite(DEFAULT_ENGAGEMENT)).toBe(true)
  })

  it('leaves a fresh copy writable, so there is somewhere to experiment', () => {
    setTourOpen(true)
    expect(tourBlocksWrite('copy-0a1b2c3d')).toBe(false)
  })

  it('lets go the moment the tour closes', () => {
    setTourOpen(true)
    setTourOpen(false)
    expect(tourBlocksWrite('main')).toBe(false)
  })

  it('says why, in words a reviewer can act on', () => {
    expect(TOUR_READ_ONLY_REASON).toMatch(/read-only/)
    expect(TOUR_READ_ONLY_REASON).toMatch(/skip/i)
  })
})
