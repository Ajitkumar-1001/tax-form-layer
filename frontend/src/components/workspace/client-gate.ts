import type { Viewer } from '@/lib/model/state'

/** Where a viewer on `pathname` belongs: clients use the portal. UX only; authorize() is the authority on acts. */
export function staffRedirect(viewer: Pick<Viewer, 'kind'>, pathname: string): string | null {
  return viewer.kind === 'client' && !pathname.startsWith('/client') ? '/client' : null
}

/** Who "Back to staff view" signs a client in as: the first staff identity active on the season clock. Null when already staff. */
export function staffReturn(
  viewer: Pick<Viewer, 'id' | 'kind'>,
  identities: readonly Pick<Viewer, 'id' | 'kind' | 'active_from'>[],
  today: string,
): string | null {
  if (viewer.kind !== 'client') return null
  return identities.find((v) => v.kind === 'staff' && v.active_from <= today)?.id ?? null
}
