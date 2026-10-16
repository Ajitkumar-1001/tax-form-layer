import { describe, expect, it } from 'vitest'
import { backTour, FRESH, nextTour, parseTour, phaseOf, skipTour, startTour } from '@/components/tour/machine'
import { END, STEPS } from '@/components/tour/steps'

describe('parseTour', () => {
  it('reads a stored state back', () => {
    expect(parseTour(JSON.stringify({ seen: true, step: 'checks' }))).toEqual({ seen: true, step: 'checks' })
    expect(parseTour(JSON.stringify({ seen: true, step: null }))).toEqual({ seen: true, step: null })
  })

  it('treats nothing, corrupt text and the wrong shape as a first visit', () => {
    expect(parseTour(null)).toEqual(FRESH)
    expect(parseTour('not json')).toEqual(FRESH)
    expect(parseTour('{"seen":"yes","step":3}')).toEqual(FRESH)
    expect(parseTour('[]')).toEqual(FRESH)
  })
})

describe('phaseOf, once the visitor has touched the tour in this page view', () => {
  it('offers the welcome card on a first visit and stays quiet once it has been dealt with', () => {
    expect(phaseOf(FRESH, true)).toEqual({ kind: 'welcome' })
    expect(phaseOf({ seen: true, step: null }, true)).toEqual({ kind: 'off' })
  })

  it('finds the stop a stored id names, and the closing card', () => {
    const p = phaseOf({ seen: true, step: STEPS[1].id }, true)
    expect(p.kind === 'step' && p.index).toBe(1)
    expect(phaseOf({ seen: true, step: END }, true)).toEqual({ kind: 'end' })
  })

  it('goes to the first stop when the stored id is one this build does not know', () => {
    const p = phaseOf({ seen: true, step: 'a-stop-that-was-removed' }, true)
    expect(p.kind === 'step' && p.index).toBe(0)
  })
})

describe('phaseOf, before the visitor has touched the tour in this page view', () => {
  it('only offers a tour that was running when an earlier visit ended: it never resumes by itself', () => {
    const p = phaseOf({ seen: true, step: STEPS[2].id }, false)
    expect(p.kind).toBe('resume')
    expect(p.kind === 'resume' && p.index).toBe(2)
  })

  it('offers a stop this build no longer has as the first one', () => {
    const p = phaseOf({ seen: true, step: 'a-stop-that-was-removed' }, false)
    expect(p.kind === 'resume' && p.index).toBe(0)
  })

  it('treats a tour that ended on its closing card as finished', () => {
    expect(phaseOf({ seen: true, step: END }, false)).toEqual({ kind: 'off' })
  })

  it('still shows the welcome card to a first-time visitor, and nothing to one who has said no', () => {
    expect(phaseOf(FRESH, false)).toEqual({ kind: 'welcome' })
    expect(phaseOf(skipTour(), false)).toEqual({ kind: 'off' })
  })
})

describe('moving through the tour', () => {
  it('starts at the first stop, and Skip closes it for good', () => {
    expect(startTour()).toEqual({ seen: true, step: STEPS[0].id })
    expect(phaseOf(skipTour(), true)).toEqual({ kind: 'off' })
  })

  it('walks every stop in order and ends on the closing card', () => {
    let s = startTour()
    const seen: string[] = []
    for (let i = 0; i < STEPS.length; i++) {
      const p = phaseOf(s, true)
      expect(p.kind).toBe('step')
      seen.push(p.kind === 'step' ? p.step.id : '')
      s = nextTour(s)
    }
    expect(seen).toEqual(STEPS.map((x) => x.id))
    expect(phaseOf(s, true)).toEqual({ kind: 'end' })
  })

  it('goes Back one stop, from the closing card to the last stop, and stays at the first', () => {
    expect(backTour({ seen: true, step: STEPS[1].id })).toEqual({ seen: true, step: STEPS[0].id })
    expect(backTour({ seen: true, step: END })).toEqual({ seen: true, step: STEPS[STEPS.length - 1].id })
    const first = startTour()
    expect(backTour(first)).toEqual(first)
  })

  it('moves nothing outside a running tour', () => {
    expect(nextTour(FRESH)).toEqual(FRESH)
    expect(nextTour(skipTour())).toEqual(skipTour())
    expect(nextTour({ seen: true, step: END })).toEqual({ seen: true, step: END })
    expect(backTour(FRESH)).toEqual(FRESH)
  })
})
