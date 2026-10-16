// Every element the tour rings must exist in the source. A screen that loses its hook breaks the ring silently (the card
// would show without one), so this fails first. No jsdom here: it reads the source text, which is where the hooks live.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STEPS } from '@/components/tour/steps'

// The tour's own folder is left out: steps.ts holds every selector, so counting it would make every hook look present.
const TOUR_DIR = path.join(process.cwd(), 'src/components/tour')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return p === TOUR_DIR ? [] : sources(p)
    return /\.tsx?$/.test(e.name) ? [readFileSync(p, 'utf8')] : []
  })
}

// What a selector looks like in JSX: `[a="b"]` and `section[a="b"]` are the attribute `a="b"`; `#x` is `id="x"`.
export function needleOf(selector: string): string {
  const attr = /\[([\w-]+)="([^"]+)"\]/.exec(selector)
  if (attr) return `${attr[1]}="${attr[2]}"`
  const id = /^#([\w-]+)$/.exec(selector)
  if (id) return `id="${id[1]}"`
  throw new Error(`unsupported anchor selector: ${selector}`)
}

/** A step may list alternatives (a comma-separated selector): each one's JSX. The anchor exists if any of them does. */
export function needlesOf(selector: string): string[] {
  return selector.split(',').map((s) => needleOf(s.trim()))
}

describe('needleOf', () => {
  it('turns each selector form into the JSX that provides it', () => {
    expect(needleOf('[data-tour="chain-demo"]')).toBe('data-tour="chain-demo"')
    expect(needleOf('section[aria-label="Next"]')).toBe('aria-label="Next"')
    expect(needleOf('#steps')).toBe('id="steps"')
    expect(needleOf('[data-tour="queue-group"] > summary')).toBe('data-tour="queue-group"')
  })
})

describe('needlesOf', () => {
  it('lists every alternative of a comma-separated selector', () => {
    expect(needlesOf('section[aria-label="Next"], [data-tour="queue-group"]')).toEqual(['aria-label="Next"', 'data-tour="queue-group"'])
    expect(needlesOf('#steps')).toEqual(['id="steps"'])
  })
})

describe('the tour anchors', () => {
  const all = sources(path.join(process.cwd(), 'src')).join('\n')

  it("does not count the tour's own script as a place a hook lives", () => {
    expect(all).not.toContain(`anchor: '[data-tour="claim-tabs"]'`)
  })

  // The attribute is written out where the screen renders it. Letting `id="x"` stand in for `aria-labelledby="x"` (a component
  // passing the id through) would still pass with the <section> gone, and that stop's ring would vanish unnoticed.
  it('exist in the source of the screens (at least one alternative of each)', () => {
    for (const s of STEPS) if (s.anchor) expect(needlesOf(s.anchor).some((n) => all.includes(n)), `${s.id}: ${s.anchor}`).toBe(true)
  })
})
