// The tour's script is data, so its rules are tests: stable ids, real routes, short copy, nothing that the shared log can change,
// and nothing that points a visitor at a control that writes.
import { describe, expect, it } from 'vitest'
import { NAV } from '@/components/shell/nav'
import { END, STEPS } from '@/components/tour/steps'

const ROUTES = new Set<string>(NAV.map((n) => n.href))
const routeOf = (href: string) => href.split('?')[0]
// A staff screen (the client portal has no tour) or a trace page.
const staffRoute = (href: string) => href.startsWith('/') && routeOf(href) !== '/client' && (ROUTES.has(routeOf(href)) || routeOf(href).startsWith('/r/'))
// `[attr="value"]`, `section[attr="value"]` or `#id`, alone or as a comma-separated list: the forms anchors.test.ts can look for
// in the source.
const ONE = '(?:section)?\\[[\\w-]+="[^"]+"\\]|#[\\w-]+'
const ANCHOR_FORM = new RegExp(`^(?:${ONE})(?:\\s*,\\s*(?:${ONE}))*$`)

describe('STEPS', () => {
  it('has the first release: seven stops', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(7)
  })

  it('has unique, kebab-case ids, and none is the closing card', () => {
    const ids = STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(ids).not.toContain(END)
  })

  it('sends every stop, and every link inside a card, to a staff screen', () => {
    for (const s of STEPS) {
      expect(staffRoute(s.href), `${s.id}: ${s.href}`).toBe(true)
      if (s.more) expect(staffRoute(s.more.href), `${s.id} more: ${s.more.href}`).toBe(true)
    }
  })

  it('keeps each card short enough to read at a glance', () => {
    for (const s of STEPS) {
      expect(s.title.length, s.id).toBeLessThanOrEqual(48)
      expect(s.body.length, s.id).toBeGreaterThanOrEqual(40)
      expect(s.body.length, s.id).toBeLessThanOrEqual(300)
    }
  })

  it('quotes nothing the shared log can change: no dollar amounts, thousands, act numbers or "n of m" counts', () => {
    for (const s of STEPS) {
      const text = `${s.title} ${s.body}`
      expect(text, s.id).not.toMatch(/\$\s?\d/)
      expect(text, s.id).not.toMatch(/\d,\d{3}/)
      expect(text, s.id).not.toMatch(/#\d/)
      expect(text, s.id).not.toMatch(/\b\d+ of \d+\b/)
    }
  })

  it('never tells a visitor to click: the tour only looks', () => {
    for (const s of STEPS) expect(`${s.title} ${s.body}`, s.id).not.toMatch(/\bclick/i)
  })

  it('uses anchor selectors in a form the source check understands', () => {
    for (const s of STEPS) if (s.anchor) expect(s.anchor, s.id).toMatch(ANCHOR_FORM)
  })

  it('never rings a control that writes: a ring is a picture, and a picture invites a click', () => {
    for (const s of STEPS) if (s.anchor) expect(s.anchor, s.id).not.toMatch(/reveal|save|accept|dispose|clock|submit|approve|signoff/i)
  })
})
