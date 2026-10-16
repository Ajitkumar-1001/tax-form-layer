// The host loads only in the browser, but if it were ever rendered on the server it must produce nothing, so it cannot mismatch
// hydration (the pattern of rail-toggle.test.ts). Everything it does after mount is checked in the browser.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TourHost } from '@/components/tour/tour-host'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/about' }))

describe('TourHost', () => {
  it('renders nothing on the server', () => {
    expect(renderToString(h(TourHost))).toBe('')
  })
})
