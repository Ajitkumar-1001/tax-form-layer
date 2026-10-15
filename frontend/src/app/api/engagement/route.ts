// `{ fresh: true }` starts a new engagement with an empty log (the packet as delivered, shared demo untouched);
// only the firm administrator may. `{ id }` switches to an existing one. Either way the choice rides in wp_eng.
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { currentIdentity, setEngagementCookie } from '@/lib/server/cookies'
import { ENGAGEMENT_RE, freshCopyRefusal } from '@/lib/server/identity'
import { viewerFor } from '@/lib/server/state'

const BodyZ = z.union([z.object({ fresh: z.literal(true) }), z.object({ id: z.string().regex(ENGAGEMENT_RE) })])

export async function POST(request: Request) {
  const parsed = BodyZ.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ reason: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  let engagement: string
  if ('fresh' in parsed.data) {
    const viewer = await viewerFor((await currentIdentity()).actor)
    const refusal = freshCopyRefusal(viewer)
    if (refusal) return Response.json({ reason: refusal }, { status: 403 })
    engagement = `copy-${randomBytes(4).toString('hex')}`
  } else {
    engagement = parsed.data.id
  }
  await setEngagementCookie(engagement)
  return Response.json({ engagement })
}
