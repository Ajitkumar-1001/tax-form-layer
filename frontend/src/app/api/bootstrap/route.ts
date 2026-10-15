import { viewerOf } from '@/lib/model/viewer'
import { currentIdentity } from '@/lib/server/cookies'
import { serverPacket } from '@/lib/server/state'

export async function GET() {
  const { actor, engagement } = await currentIdentity()
  const sp = await serverPacket()
  return Response.json(
    { engagement, viewer: viewerOf(sp.masked, actor), identities: sp.identities, packetSha: sp.sha },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
