'use client'
// Public entry: screens import `useWorkspace` and the types from here. The root layout mounts
// <WorkspaceProvider> once, so staff routes and the client portal share one bootstrap.
export type { Workspace, OpenActRequest, PostResult } from './types'
export { WorkspaceContext, useWorkspace } from './context'
export { WorkspaceProvider } from './provider'
