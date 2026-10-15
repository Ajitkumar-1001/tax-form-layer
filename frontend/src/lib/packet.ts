import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Packet } from './model/packet-types'

export type * from './model/packet-types'

// The packet is loaded exactly as delivered: frontend/data holds a byte-identical copy of ../data
// (so Vercel ships it with root = frontend) and the sha pin refuses anything else.
export const PACKET_SHA256 = 'ee01f8508bd2fd9854754b82fd9c4a055bdc55e2778a132002a25381c412ad19'
const PACKET_PATH = path.join(process.cwd(), 'data', 'okafor_lindqvist_2025_packet.json')

let cached: Promise<{ packet: Packet; raw: string }> | undefined
export function loadPacketRaw(): Promise<{ packet: Packet; raw: string }> {
  cached ??= readFile(PACKET_PATH, 'utf8').then((raw) => {
    const sha = createHash('sha256').update(raw).digest('hex')
    if (sha !== PACKET_SHA256) throw new Error(`Packet sha mismatch: ${sha}`)
    return { packet: JSON.parse(raw) as Packet, raw }
  })
  return cached
}

export async function loadPacket(): Promise<Packet> {
  return (await loadPacketRaw()).packet
}
