// MaskedText holds a reveal (or a refusal) in component state, which is the viewer's authority, not the page's: it must
// not outlive an identity switch, and its Reveal button must stay a focusable, named control. Server-rendered with
// renderToString, so what a screen reader announces after a press is left to the browser check.
//
// What a press sets, and in what order, is runReveal: a pure function, run below with recording setters and no React.
// A server render never changes state, though, and a token keeps what it shows and whether it is busy in two useState
// values. So renderFace seeds those two values for one render, to read the Hide, busy and refused faces a press leads to.
// pressTokenReveal seeds them idle and runs the token's own Reveal onClick with recording setters: runReveal's order holds
// only if the handler goes through it.
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readPacket } from '../records/fixture'
import { MaskedText, runReveal } from '@/components/atoms/masked-text'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import { authorize, canReveal } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { makeToken } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'

const seed = vi.hoisted(() => ({
  /** What renderFace is seeding. Null the rest of the time, when useState below is React's own. */
  face: null as { shown: unknown; busy: boolean } | null,
  /** The states the token declared while that face rendered, in order. */
  declared: [] as string[],
  /** Where the seeded setters record each call (`shown=null`), while pressTokenReveal presses; null the rest of the time. */
  trail: null as string[] | null,
}))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: (init: unknown) => {
      if (!seed.face) return react.useState(init)
      // A seed is placed by what a state starts as: `shown` starts null, `busy` starts false. Any other start is a state
      // this seed knows nothing about, so it fails the render instead of being handed a value meant for another.
      const name = init === null ? 'shown' : init === false ? 'busy' : null
      if (!name) throw new Error(`MaskedToken declared a state that starts as ${String(init)}; teach renderFace to seed it`)
      seed.declared.push(name)
      // A server render never calls the setter; the handler pressTokenReveal runs after the render does, and is recorded.
      return [seed.face[name], (next: unknown) => { seed.trail?.push(`${name}=${JSON.stringify(next)}`) }]
    },
  }
})

const { masked } = maskPacket(readPacket())
const model = buildModel(masked)

function ws(viewerId: string): Workspace {
  const viewer = viewerOf(masked, viewerId)
  const state = project(model, [], viewer)
  return {
    model, state, viewer, identities: identities(masked), engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const render = (el: ReactElement, viewerId = 'st-01') => renderToString(h(WorkspaceContext, { value: ws(viewerId) }, el))

/**
 * One masked token rendered with its two state values seeded: the Hide, busy and refused faces a press leads to. The token
 * must declare exactly those two, shown then busy; a third state, or a reorder, fails here instead of being seeded wrong.
 */
function renderFace(face: { shown?: { value: string } | { reason: string }; busy?: boolean }, token: string, viewerId = 'st-01'): string {
  seed.face = { shown: face.shown ?? null, busy: face.busy ?? false }
  seed.declared = []
  try {
    const html = render(h(MaskedText, { text: token, context: 'x' }), viewerId)
    expect(seed.declared, 'MaskedToken should declare shown, then busy, and nothing else').toEqual(['shown', 'busy'])
    return html
  } finally {
    seed.face = null
  }
}

/** The HTML without React's `<!-- -->` marks between neighbouring text nodes. */
const flat = (html: string) => html.replaceAll('<!-- -->', '')

// The opening tags of a token's four parts, each captured for its class list: the parts are styled separately.
const WRAPPER = /<span class="([^"]*)"><span data-tour="masked-value"/
const VALUE = /<span data-tour="masked-value"[^>]*\sclass="([^"]*)"/
const BUTTON = /<button type="button"[^>]*\sclass="([^"]*)"/ // Reveal or Hide: a token renders one at a time
const STATUS = /<span role="status" class="([^"]*)"/
function classesOf(html: string, tag: RegExp): string[] {
  const m = tag.exec(html)
  if (!m) throw new Error(`${tag} is not in ${html}`)
  return m[1].split(' ')
}

// Reset the host's face (mono, semibold, 20 px) and give both buttons a pseudo-element hit area that grows vertically only.
const BUTTON_RESET = ['font-sans', 'font-normal', 'cursor-pointer', 'relative', 'after:absolute', 'after:inset-x-0', 'after:-inset-y-1', 'pointer-coarse:after:-inset-y-2']

/** What authorize() says to st-04, who has no sensitive-data clearance, when Reveal is pressed. */
function refusalForSt04(): string {
  const w = ws('st-04')
  const r = canReveal(w.state, w.viewer)
  if (r.ok) throw new Error('st-04 has no clearance, so Reveal is refused')
  return r.reason
}

/** What a press sets and asks, in order, when the server answers `answer`: the ask and both setters log to one trail. */
async function pressReveal(answer: Awaited<ReturnType<Workspace['reveal']>>): Promise<string[]> {
  const trail: string[] = []
  await runReveal(
    async () => { trail.push('ask'); return answer },
    { busy: (on) => trail.push(`busy=${on}`), shown: (next) => trail.push(`shown=${JSON.stringify(next)}`) },
  )
  return trail
}

/**
 * What the token's own Reveal handler sets and asks, in order, when the server answers `answer`. The token is called as a
 * function inside a probe component, its two states seeded idle, so the Reveal button's onClick can be taken from the element
 * it returns and run after the render; the ask and the seeded setters log to one trail, in pressReveal's form.
 */
async function pressTokenReveal(answer: Awaited<ReturnType<Workspace['reveal']>>, viewerId = 'st-04'): Promise<string[]> {
  type El = ReactElement<{ children?: ReactNode; onClick?: () => Promise<void> }>
  const kids = (el: El) => ([] as ReactNode[]).concat(el.props.children).filter(isValidElement) as El[]
  const trail: string[] = []
  const presses: (() => Promise<void>)[] = []
  function Probe() {
    const span = MaskedText({ text: makeToken('ssn', '3309', 'a'), context: 'x' }) as El
    const token = kids(span).find((k) => typeof k.type === 'function') as El & { type: (props: unknown) => El }
    const onClick = kids(token.type(token.props)).find((k) => k.type === 'button')?.props.onClick
    if (onClick) presses.push(onClick)
    return null
  }
  seed.face = { shown: null, busy: false }
  seed.declared = []
  seed.trail = trail
  try {
    renderToString(h(WorkspaceContext, { value: { ...ws(viewerId), reveal: async () => { trail.push('ask'); return answer } } }, h(Probe)))
    expect(seed.declared, 'MaskedToken should declare shown, then busy, and nothing else').toEqual(['shown', 'busy'])
    expect(presses.length, 'the idle token renders one Reveal button').toBe(1)
    await presses[0]()
  } finally {
    seed.face = null
    seed.trail = null
  }
  return trail
}

describe('MaskedText', () => {
  it('keys each masked token on the viewer, so an identity switch remounts it', () => {
    const text = `Theo ${makeToken('ssn', '3309', 'abc')} per D06`
    function keysFor(viewerId: string): string[] {
      const keys: string[] = []
      // MaskedText reads the workspace with use(), so it is called inside a component rendered under the context.
      function Probe() {
        const span = MaskedText({ text, context: 'household:theo#ssn' }) as ReactElement<{ children: ReactNode[] }>
        for (const child of span.props.children) if (isValidElement(child)) keys.push(String(child.key))
        return null
      }
      render(h(Probe), viewerId)
      return keys
    }
    const [a0, a1, a2] = keysFor('st-01')
    const [b0, b1, b2] = keysFor('st-04')
    expect([a0, a2, b0, b2]).toEqual(['0', '2', '0', '2'])
    expect(a1).not.toBe(b1)
    expect(a1).toContain('st-01')
    expect(b1).toContain('st-04')
  })

  it('keeps Reveal focusable when it cannot act and gives results a live region', () => {
    const token = makeToken('ssn', '3309', 'abc')
    // No provider: Reveal cannot act, but stays in the tab order and says so (a natively disabled button drops focus).
    const bare = renderToString(h(MaskedText, { text: token, context: 'x' }))
    expect(bare).toContain('aria-disabled="true"')
    expect(bare).not.toContain(' disabled=""')
    // Inside a workspace it can act: not disabled, the revealed value and the refusal are announced.
    const html = render(h(MaskedText, { text: token, context: 'x' }))
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).not.toContain(' disabled=""')
  })

  it('names each Reveal by the word it shows, then the kind and last four of its value as sr-only text', () => {
    const text = `${makeToken('ssn', '3309', 'a')} vs ${makeToken('ssn', '3390', 'b')}`
    const html = flat(render(h(MaskedText, { text, context: 'x' })))
    // The name is built from the content, so it starts with the visible word (WCAG 2.5.3): an aria-label would replace it.
    expect(html).toContain('Reveal<span class="sr-only"> ssn ending 3309</span>')
    expect(html).toContain('Reveal<span class="sr-only"> ssn ending 3390</span>')
    // The label sits flush against the icon: the icon's gap spaces it, and a pre-wrap host (the D08 page, a JSON view) would render a literal space.
    expect(html).toContain('</svg>Reveal<span')
    expect(html).not.toContain('aria-label="')
    // No last four: the name is the kind alone, with its underscore read as a space.
    expect(flat(render(h(MaskedText, { text: makeToken('ip_pin', '', 'c'), context: 'x' })))).toContain('Reveal<span class="sr-only"> ip pin</span>')
  })

  it('gives Hide and the busy Reveal the same sr-only suffix after the word they show', () => {
    const text = makeToken('ssn', '3309', 'a')
    const hide = flat(renderFace({ shown: { value: 'clear-value' } }, text))
    expect(hide).toContain('Hide<span class="sr-only"> ssn ending 3309</span>')
    expect(hide).toContain('</svg>Hide<span') // flush against the icon too (see the Reveal case)
    expect(hide).not.toContain('aria-label="')
    const busy = flat(renderFace({ busy: true }, text))
    expect(busy).toContain('Revealing…<span class="sr-only"> ssn ending 3309</span>')
    expect(busy).not.toContain('aria-label="')
  })

  it("wraps instead of pushing Hide off-screen and resets the host's type", () => {
    const html = flat(render(h(MaskedText, { text: makeToken('ssn', '3309', 'abc'), context: 'x' })))
    // Only the value refuses to break. The row may wrap, so a long revealed value drops Hide to the next line.
    const wrapper = classesOf(html, WRAPPER)
    expect(wrapper).toContain('flex-wrap')
    expect(wrapper).not.toContain('whitespace-nowrap')
    expect(classesOf(html, VALUE)).toContain('whitespace-nowrap')
    const reveal = classesOf(html, BUTTON)
    for (const c of BUTTON_RESET) expect(reveal, c).toContain(c)
    // The status line takes the whole row, in the page's face and a quiet ink. While empty it is taken out of the row: as a flex
    // item it would still add a column gap to an idle token's width. Absolute rather than hidden, because a display:none live
    // region is not announced.
    const status = classesOf(html, STATUS)
    for (const c of ['basis-full', 'font-sans', 'font-normal', 'text-xs', 'whitespace-normal', 'text-muted-foreground', 'empty:absolute']) expect(status, c).toContain(c)
    expect(status).not.toContain('text-destructive')
  })

  it('gives Hide the same reset and hit area, and a refusal its own line in muted ink', () => {
    const text = makeToken('ssn', '3309', 'a')
    const hide = classesOf(flat(renderFace({ shown: { value: 'clear-value' } }, text)), BUTTON)
    for (const c of BUTTON_RESET) expect(hide, c).toContain(c)
    // A refusal shows the authorize() sentence verbatim in the status line, beside a Reveal that can be pressed again.
    const reason = refusalForSt04()
    const html = flat(renderFace({ shown: { reason } }, text, 'st-04'))
    expect(/<span role="status" class="[^"]*">([^<]*)<\/span>/.exec(html)?.[1]).toBe(reason)
    const status = classesOf(html, STATUS)
    for (const c of ['basis-full', 'text-muted-foreground']) expect(status, c).toContain(c)
    expect(status).not.toContain('text-destructive')
    expect(html).toContain('Reveal<span class="sr-only"> ssn ending 3309</span>')
  })

  it('underlines Reveal on hover only while it can act', () => {
    const reveal = classesOf(flat(render(h(MaskedText, { text: makeToken('ssn', '3309', 'a'), context: 'x' }))), BUTTON)
    // hover:underline alone also fires on an aria-disabled button (busy, or no workspace), which would look pressable.
    expect(reveal).toContain('hover:not-aria-disabled:underline')
    expect(reveal).not.toContain('hover:underline')
    // The pointer likewise: TARGET's cursor-pointer is taken back while aria-disabled. Hide is never inert, so only Reveal has it.
    expect(reveal).toContain('aria-disabled:cursor-default')
  })

  it('runReveal clears the last refusal before it asks, so an identical one is announced again (pins the helper, not the handler)', async () => {
    const reason = refusalForSt04()
    // Reveal is pressed again after a refusal, and the server gives the same answer.
    const trail = await pressReveal({ ok: false, reason })
    // Same text set twice is no change to a live region, so it stays silent: the status must be empty before the answer.
    const asked = trail.indexOf('ask')
    expect(asked, 'the sequence asked the server').toBeGreaterThan(-1)
    expect(trail.slice(0, asked)).toContain('shown=null')
    expect(trail.at(-1)).toBe(`shown=${JSON.stringify({ reason })}`)
  })

  it('runReveal holds the value the server gives, and is idle again once it has (pins the helper, not the handler)', async () => {
    const trail = await pressReveal({ ok: true, value: 'clear-value' })
    expect(trail.indexOf('busy=false')).toBeGreaterThan(trail.indexOf('ask'))
    expect(trail.at(-1)).toBe(`shown=${JSON.stringify({ value: 'clear-value' })}`)
  })

  // The two cases above pin runReveal's order; this one pins that the token's own Reveal goes through it.
  it("the token's own Reveal clears the last refusal before it asks, and ends on the server's answer", async () => {
    const reason = refusalForSt04()
    const trail = await pressTokenReveal({ ok: false, reason })
    const asked = trail.indexOf('ask')
    expect(asked, "the token's handler asked the server").toBeGreaterThan(-1)
    expect(trail.slice(0, asked)).toContain('shown=null')
    expect(trail.at(-1)).toBe(`shown=${JSON.stringify({ reason })}`)
  })
})
