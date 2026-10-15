// Demo identity picker (not authentication): the server signs the choice and re-resolves the role from the packet.
import { z } from 'zod'
import { setActorCookie } from '@/lib/server/cookies'
import { serverPacket } from '@/lib/server/state'

const BodyZ = z.object({ actor: z.string().max(20) })

export async function POST(request: Request) {
  const parsed = BodyZ.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ reason: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  const viewer = (await serverPacket()).identities.find((v) => v.id === parsed.data.actor)
  if (!viewer) return Response.json({ reason: `Unknown identity ${parsed.data.actor}` }, { status: 400 })
  await setActorCookie(viewer.id)
  return Response.json({ viewer })
}
