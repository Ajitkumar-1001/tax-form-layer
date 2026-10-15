// The server's view of the packet: masked once per process, modelled once, projected per request.
import 'server-only'
import { buildModel, type Model } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import type { State, Viewer } from '@/lib/model/state'
import { identities, viewerOf } from '@/lib/model/viewer'
import { loadPacketRaw, PACKET_SHA256 } from '@/lib/packet'
import { listActs } from './acts-repo'
import { type Db, sql } from './db'
import { eqOf, type MaskedPacket, maskPacket } from './mask'

export interface ServerPacket extends MaskedPacket {
  sha: string
  /** The masked packet, serialised once for GET /api/packet. */
  maskedJson: string
  /** Changes with the packet and with MASK_SECRET (tokens depend on both). */
  etag: string
  model: Model
  identities: Viewer[]
}

let cached: Promise<ServerPacket> | undefined
export function serverPacket(): Promise<ServerPacket> {
  cached ??= loadPacketRaw().then(({ packet }) => {
    const mp = maskPacket(packet)
    return {
      ...mp,
      sha: PACKET_SHA256,
      maskedJson: JSON.stringify(mp.masked),
      etag: `"${PACKET_SHA256.slice(0, 16)}.${eqOf(PACKET_SHA256)}"`,
      model: buildModel(mp.masked),
      identities: identities(mp.masked),
    }
  })
  return cached
}

export async function viewerFor(actor: string): Promise<Viewer> {
  return viewerOf((await serverPacket()).masked, actor)
}

export async function projectFor(engagement: string, viewer: Viewer, db: Db = sql): Promise<State> {
  const { model } = await serverPacket()
  return project(model, await listActs(engagement, 0, db), viewer, engagement)
}
