'use client'
// The Workspace context. Kept apart from the provider so atoms can read it without importing the
// provider (and, through it, the act host), which would make an import cycle.
import { createContext, use } from 'react'
import { browser } from 'react-dom'
import type { Workspace } from './types'

/** The loaded workspace; null while the provider is loading (and outside any provider). */
export const WorkspaceContext = createContext<Workspace | null>(null)

/** Settles when the provider's first load is in. Null outside any provider. */
export const WorkspaceLoading = createContext<Promise<void> | null>(null)

/**
 * The loaded workspace. The provider loads it in the browser and renders its children meanwhile (so every route
 * segment is in the static shell), so until then this suspends: call it below a <Suspense>. On the server the
 * nearest boundary sends its fallback and leaves its content to the browser (react-dom `browser()`); in the
 * browser that boundary shows its fallback until the first load is in.
 */
export function useWorkspace(): Workspace {
  const ws = use(WorkspaceContext)
  const loading = use(WorkspaceLoading)
  if (!ws && !loading) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  if (loading) {
    if (!ws) use(browser('The workpaper loads in the browser'))
    // Called on every render, loaded or not: a retry after suspending must make the same use() calls.
    // Once loaded the provider marks the promise fulfilled, so this returns without suspending.
    use(loading)
  }
  if (!ws) throw new Error('The workspace finished loading without a value')
  return ws
}
