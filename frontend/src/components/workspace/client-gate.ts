import type { Viewer } from '@/lib/model/state'

/** Where a viewer on `pathname` belongs: clients use the portal. UX only; authorize() is the authority on acts. */
export function staffRedirect(viewer: Pick<Viewer, 'kind'>, pathname: string): string | null {
  return viewer.kind === 'client' && !pathname.startsWith('/client') ? '/client' : null
}
