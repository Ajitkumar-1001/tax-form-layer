// The host loads only in the browser, but if it were ever rendered on the server it must produce nothing, so it cannot mismatch
// hydration (the pattern of rail-toggle.test.ts). Everything it does after mount is checked in the browser.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TourHost } from '@/components/tour/tour-host'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/about' }))

describe('TourHost', () => {
  it('renders nothing on the server', () => {
    expect(renderToString(h(TourHost))).toBe('')
  })

  // A tripwire, not a proof: vitest has no DOM, so the effect itself cannot run here. The browser gate (docs/superpowers/tools/
  // tour-gate.cjs, write probe) is the proof; this only fails if someone deletes the wiring from the source.
  it('keeps the write guard wired to what is on screen (tripwire; the gate proves the behaviour)', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/tour/tour-host.tsx'), 'utf8')
    expect(source).toMatch(/const open = lockOpen\(phase, ctx\)/)
    expect(source).toMatch(/setTourOpen\(open\)/)
    expect(source).toMatch(/return \(\) => setTourOpen\(false\)/)
  })
})
