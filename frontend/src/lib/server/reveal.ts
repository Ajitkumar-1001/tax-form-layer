// POST /api/reveal, minus HTTP. The view (or the refusal) is written to the act log first, in the same
// transaction, and only then is the clear value returned.
import 'server-only'
import { z } from 'zod'
import { canReveal } from '@/lib/model/authorize'
import { parseToken } from '@/lib/model/mask-token'
import { viewerOf } from '@/lib/model/viewer'
import { findSealed, insertActs, listSealed } from './acts-repo'
import { withEngagementLock } from './db'
import { ENGAGEMENT_RE } from './identity'
import { actMasker, type ApiResult } from './post-acts'
import { projectFor, serverPacket } from './state'

export const RevealZ = z.object({
  engagement: z.string().regex(ENGAGEMENT_RE),
  token: z.string().max(200),
  context: z.string().min(1).max(200), // the ref the viewer was looking at
})

export async function reveal(actorId: string, raw: unknown): Promise<ApiResult> {
  const parsed = RevealZ.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { reason: 'Invalid request', issues: parsed.error.issues } }
  const { engagement, token } = parsed.data
  const t = parseToken(token)
  if (!t) return { status: 400, body: { reason: 'Not a masked token' } }
  const sp = await serverPacket()
  const viewer = viewerOf(sp.masked, actorId)
  return withEngagementLock(engagement, async (tx): Promise<ApiResult> => {
    const state = await projectFor(engagement, viewer, tx)
    // The context is free text: mask it like act text, so it cannot log a value sealed in this engagement in clear.
    const context = actMasker(sp, await listSealed(tx, engagement))(parsed.data.context, new Map())
    // Look the tag up first: an unknown tag is not a view, so it is never logged (whatever the viewer's
    // clearance). Logging it would copy whatever was typed into the tag into the public log.
    const secret = sp.secrets.get(t.eq) ?? (await findSealed(tx, engagement, t.eq))
    if (!secret) return { status: 404, body: { reason: 'No masked value with that tag in this engagement' } }
    // The same rule the UI uses to show or hide Reveal: cleared, active staff only (st-04 has no clearance).
    const auth = canReveal(state, viewer)
    const refusal = auth.ok ? null : auth.reason
    await insertActs(tx, [{
      engagement,
      recorded_at: new Date().toISOString(),
      season_at: state.clock,
      actor: viewer.id,
      actor_role: viewer.role,
      type: 'view_sensitive',
      target: context,
      refs: [context],
      body: { eq: t.eq, kind: secret.kind, context, denied: refusal !== null, ...(refusal ? { reason: refusal } : {}) },
      derived: {},
      batch_id: null,
    }])
    return refusal ? { status: 403, body: { reason: refusal } } : { status: 200, body: { value: secret.value } }
  })
}
