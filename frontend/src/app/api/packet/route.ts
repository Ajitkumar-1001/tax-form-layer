// The masked packet: one variant for every viewer (clear values come only through /api/reveal).
// `?sha=<packetSha>` makes the URL content-addressed, so it may be cached for a year.
import { connection } from 'next/server'
import { serverPacket } from '@/lib/server/state'

export async function GET(request: Request) {
  await connection() // MASK_SECRET is a runtime secret: never bake the masked packet at build time
  const sp = await serverPacket()
  const pinned = new URL(request.url).searchParams.get('sha') === sp.sha
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ETag: sp.etag,
    'Cache-Control': pinned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  }
  if (request.headers.get('if-none-match') === sp.etag) return new Response(null, { status: 304, headers })
  return new Response(sp.maskedJson, { headers })
}
