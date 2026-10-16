// The boundary is a class, so it can be driven without a DOM: what it renders, and that catching a failure releases the guard.
import { afterEach, describe, expect, it } from 'vitest'
import { setTourOpen, tourBlocksWrite } from '@/components/tour/guard'
import { TourBoundary } from '@/components/tour/tour-boundary'

afterEach(() => setTourOpen(false))

describe('TourBoundary', () => {
  it('renders what is inside it until something fails', () => {
    expect(new TourBoundary({ children: 'the tour' }).render()).toBe('the tour')
  })

  it('renders nothing once it has caught a failure, so the app carries on without the tour', () => {
    const b = new TourBoundary({ children: 'the tour' })
    b.state = TourBoundary.getDerivedStateFromError()
    expect(b.render()).toBeNull()
  })

  it('releases the write guard when it catches a failure, so nobody is left locked out', () => {
    setTourOpen(true)
    expect(tourBlocksWrite('main')).toBe(true)
    new TourBoundary({ children: null }).componentDidCatch()
    expect(tourBlocksWrite('main')).toBe(false)
  })
})
