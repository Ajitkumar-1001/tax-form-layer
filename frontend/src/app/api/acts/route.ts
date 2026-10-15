import { z } from 'zod'
import { headSeq, listActs } from '@/lib/server/acts-repo'
import { currentIdentity } from '@/lib/server/cookies'
import { ENGAGEMENT_RE } from '@/lib/server/identity'
import { postActs } from '@/lib/server/post-acts'

const QueryZ = z.object({
  engagement: z.string().regex(ENGAGEMENT_RE).optional(),
  after: z.coerce.number().int().nonnegative().default(0),
})

export async function GET(request: Request) {
  const q = QueryZ.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!q.success) return Response.json({ reason: 'Invalid request', issues: q.error.issues }, { status: 400 })
  const engagement = q.data.engagement ?? (await currentIdentity()).engagement
  const acts = await listActs(engagement, q.data.after)
  const head = acts.at(-1)?.seq ?? (await headSeq(engagement))
  return Response.json({ acts, head }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const { actor } = await currentIdentity()
  const r = await postActs(actor, await request.json().catch(() => null))
  return Response.json(r.body, { status: r.status })
}
