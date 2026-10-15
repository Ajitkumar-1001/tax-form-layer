// Cookie I/O for route handlers (next/headers needs a request scope, so the logic it wraps lives in identity.ts).
import 'server-only'
import { cookies } from 'next/headers'
import { ACTOR_COOKIE, ENGAGEMENT_COOKIE, engagementOf, signActor, verifyActor } from './identity'

const OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30,
} as const

export async function currentIdentity(): Promise<{ actor: string; engagement: string }> {
  const jar = await cookies()
  return { actor: verifyActor(jar.get(ACTOR_COOKIE)?.value), engagement: engagementOf(jar.get(ENGAGEMENT_COOKIE)?.value) }
}

export async function setActorCookie(actor: string): Promise<void> {
  ;(await cookies()).set(ACTOR_COOKIE, signActor(actor), OPTIONS)
}

export async function setEngagementCookie(engagement: string): Promise<void> {
  ;(await cookies()).set(ENGAGEMENT_COOKIE, engagement, OPTIONS)
}
