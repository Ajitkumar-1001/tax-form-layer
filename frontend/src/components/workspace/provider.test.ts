// Regression: the provider used to render a skeleton instead of its children until the browser had loaded,
// so every route segment was dropped from the server render and Next.js reported "Could not validate that a
// segment in your UI has instant navigation" (instant-unrendered-segment) on every route.
import { createElement as h, Suspense } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/shell/app-shell'
import { useWorkspace, WorkspaceContext, WorkspaceLoading } from './context'
import { WorkspaceProvider } from './provider'
import type { Workspace } from './types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/errors' }))

function Screen() {
  return h('p', null, `engagement ${useWorkspace().engagement}`)
}

describe('WorkspaceProvider server render (regression: instant-unrendered-segment)', () => {
  it('renders the route below it instead of a skeleton', () => {
    expect(renderToString(h(WorkspaceProvider, null, h('p', null, 'the segment')))).toContain('the segment')
  })

  it('leaves a screen that reads the workspace to the browser: its <Suspense> sends the fallback', () => {
    const html = renderToString(h(WorkspaceProvider, null, h(Suspense, { fallback: h('i', null, 'waiting') }, h(Screen))))
    expect(html).toContain('waiting')
    expect(html).toContain('<!--$!-->') // client-rendered boundary, not a failed render
    expect(html).not.toContain('engagement')
  })

  it('renders the staff frame and the page; workspace parts wait in their own boundaries', () => {
    const html = renderToString(h(WorkspaceProvider, null, h(AppShell, null, h('p', null, 'the page'))))
    expect(html).toContain('aria-label="Workpaper"') // the nav
    expect(html).toContain('the page')
    expect(html).not.toContain('Filing blocked') // the gate bar reads the state, so it is the browser's
  })

  it('holds a page that reads the workspace without its own boundary in the shell, not the whole app', () => {
    const html = renderToString(h(WorkspaceProvider, null, h(AppShell, null, h(Screen))))
    expect(html).toContain('aria-label="Workpaper"')
    expect(html).toContain('Loading the workpaper') // the page skeleton inside <main>
  })
})

describe('useWorkspace', () => {
  const ws = { engagement: 'main' } as Workspace
  const loaded = Object.assign(Promise.resolve(), { status: 'fulfilled', value: undefined })

  it('returns the loaded workspace without suspending', () => {
    const html = renderToString(h(WorkspaceLoading, { value: loaded }, h(WorkspaceContext, { value: ws }, h(Screen))))
    expect(html).toContain('engagement main')
  })

  it('still works with a workspace and no provider (tests and previews)', () => {
    expect(renderToString(h(WorkspaceContext, { value: ws }, h(Screen)))).toContain('engagement main')
  })

  it('throws outside any provider', () => {
    expect(() => renderToString(h(Screen))).toThrow(/inside <WorkspaceProvider>/)
  })
})
