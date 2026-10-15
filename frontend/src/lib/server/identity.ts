// Demo identity (a role switcher, not authentication): the chosen actor rides in an HMAC-signed cookie so the
// server, not the request body, decides who is acting. The server re-resolves role and clearance from the packet.
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Viewer } from '@/lib/model/state'

export const ACTOR_COOKIE = 'wp_actor'
export const ENGAGEMENT_COOKIE = 'wp_eng'
export const DEFAULT_ACTOR = 'st-01'
export const DEFAULT_ENGAGEMENT = 'main'
/** 'main' or a fresh copy. Anything else is refused, so requests cannot mint engagements. */
export const ENGAGEMENT_RE = /^(main|copy-[0-9a-f]{8})$/

function identitySecret(): string {
  const s = process.env.IDENTITY_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('IDENTITY_SECRET must be set in production')
  return 'dev-only-identity-secret'
}

export const identityHmac = (data: string) => createHmac('sha256', identitySecret()).update(data).digest('base64url')

export const signActor = (actor: string) => `${actor}.${identityHmac(`actor:${actor}`)}`

/** The actor in a signed cookie value, or the default when it is missing or tampered with. */
export function verifyActor(cookie: string | undefined): string {
  const dot = cookie?.lastIndexOf('.') ?? -1
  if (!cookie || dot < 1) return DEFAULT_ACTOR
  const actor = cookie.slice(0, dot)
  const given = Buffer.from(cookie.slice(dot + 1))
  const want = Buffer.from(identityHmac(`actor:${actor}`))
  return given.length === want.length && timingSafeEqual(given, want) ? actor : DEFAULT_ACTOR
}

export const engagementOf = (cookie: string | undefined) =>
  cookie && ENGAGEMENT_RE.test(cookie) ? cookie : DEFAULT_ENGAGEMENT

/** Starting a fresh copy (an empty log over the packet) is the firm administrator's job. */
export const freshCopyRefusal = (viewer: Viewer): string | null =>
  viewer.role === 'firm_administrator' ? null : `Only the firm administrator can start a fresh copy; ${viewer.name} is signed in.`

/** Client approval PINs are never stored; this keyed hash is (a bare SHA-256 of 5 digits is reversible). */
export const pinHash = (actor: string, pin: string) => identityHmac(`pin:${actor}:${pin}`)
