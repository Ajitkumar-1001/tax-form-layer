// No jsdom: the cards are checked as the HTML they render. Clicks, keys and focus are checked in the browser.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClosingCard, StepCard, WelcomeCard } from '@/components/tour/cards'
import { STEPS } from '@/components/tour/steps'

const noop = () => {}
const step = (id: string) => STEPS.find((s) => s.id === id)!
// React separates adjacent text nodes in server output with <!-- -->; the words are what is checked.
const markup = (html: string) => html.replace(/<!-- -->/g, '')
const stepCard = (over: Partial<Parameters<typeof StepCard>[0]> = {}) =>
  markup(renderToString(h(StepCard, { step: STEPS[0], index: 0, total: STEPS.length, focusNext: false, away: false, onBack: noop, onNext: noop, onClose: noop, onReturn: noop, ...over })))
// A disabled Back button: the attribute itself (every Button's class list also holds the word "disabled:").
const backDisabled = /<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Back/

describe('WelcomeCard, on a first visit', () => {
  const html = markup(renderToString(h(WelcomeCard, { stops: 7, onStart: noop, onSkip: noop })))

  it('is a labelled, non-modal dialog that offers the tour or leaves the visitor alone', () => {
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain('aria-labelledby="tour-title"')
    expect(html).toContain('Take the tour')
    expect(html).toContain('Explore on my own')
  })

  it('says how long it takes and promises that the tour only looks', () => {
    expect(html).toContain('7 stops')
    expect(html).toContain('about five minutes')
    expect(html).toContain('never changes any data')
  })

  it('says the app is read-only while the tour is open, and how to start it again later', () => {
    expect(html).toContain('while it is open the app is read-only')
    expect(html).toContain('open search and type tour')
  })
})

describe('WelcomeCard, for a tour left unfinished', () => {
  const html = markup(renderToString(h(WelcomeCard, { stops: 7, resume: { index: 2, title: 'The checks already ran', onResume: noop }, onStart: noop, onSkip: noop })))

  it('offers it back, saying where the visitor was', () => {
    expect(html).toContain('Pick up the tour?')
    expect(html).toContain('stop 3 of 7: The checks already ran')
  })

  it('lets the visitor resume, start over, or say not now', () => {
    expect(html).toContain('Resume')
    expect(html).toContain('Start over')
    expect(html).toContain('Not now')
    expect(html).not.toContain('Explore on my own')
  })
})

describe('StepCard', () => {
  it('shows the stop, its place in the tour, and Next', () => {
    const html = stepCard()
    expect(html).toContain(STEPS[0].title)
    expect(html).toContain(`1 of ${STEPS.length}`)
    expect(html).toContain('Next')
    expect(html).toContain('Skip tour')
  })

  it('cannot go Back from the first stop, and says Finish on the last', () => {
    expect(stepCard({ index: 0 })).toMatch(backDisabled)
    const last = stepCard({ step: STEPS[STEPS.length - 1], index: STEPS.length - 1 })
    expect(last).toContain('Finish')
    expect(last).not.toMatch(backDisabled)
  })

  it('links to a closer look when the stop has one', () => {
    const html = stepCard({ step: step('checks'), index: 2 })
    expect(html).toContain(step('checks').more!.label)
    expect(html).toContain(`href="${step('checks').more!.href}"`)
  })

  it('moves focus to Next only once the visitor has driven the tour', () => {
    expect(stepCard({ focusNext: true })).toContain('autofocus')
    expect(stepCard({ focusNext: false })).not.toContain('autofocus')
  })

  it('announces each stop to a screen reader through a polite live region', () => {
    expect(stepCard()).toMatch(/aria-live="polite" aria-atomic="true">Stop 1 of /)
  })

  it('says so when the visitor has left the stop\'s page, and offers the way back; otherwise says nothing', () => {
    const away = stepCard({ away: true })
    expect(away).toContain('You have left this stop.')
    expect(away).toContain('Go back to it')
    expect(stepCard({ away: false })).not.toContain('You have left this stop.')
  })

  it('never outgrows the window, and keeps an edge in forced colors, where box shadows disappear', () => {
    const html = stepCard()
    expect(html).toContain('max-h-[calc(100svh-14.5rem)]')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('forced-colors:outline')
  })

  it('docks bottom left beside the rail at either width, and as a sheet above the gate bar on a phone', () => {
    const html = stepCard()
    expect(html).toContain('left-4')
    expect(html).toContain('rail-narrow:left-20')
    expect(html).toContain('rail-wide:left-64')
    expect(html).toContain('max-lg:bottom-14')
    expect(html).toContain('print:hidden')
  })
})

describe('ClosingCard', () => {
  const html = markup(renderToString(h(ClosingCard, { focusClose: false, onBack: noop, onReplay: noop, onClose: noop })))

  it('points at the two hand-in pages and offers a replay', () => {
    expect(html).toContain('href="/about"')
    expect(html).toContain('href="/errors"')
    expect(html).toContain('Replay')
    expect(html).toContain('Close')
  })

  it('says that shared changes are permanent and where a copy to experiment in comes from, and how to get back', () => {
    expect(html).toContain('recorded permanently')
    expect(html).toContain('Undo adds another act')
    expect(html).toContain('30 days')
    expect(html).toContain('Fresh copy')
    expect(html).toContain('Back to the shared engagement')
  })
})
