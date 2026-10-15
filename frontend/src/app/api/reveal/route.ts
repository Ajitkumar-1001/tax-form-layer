import { currentIdentity } from '@/lib/server/cookies'
import { reveal } from '@/lib/server/reveal'

export async function POST(request: Request) {
  const { actor } = await currentIdentity()
  const r = await reveal(actor, await request.json().catch(() => null))
  return Response.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
}
