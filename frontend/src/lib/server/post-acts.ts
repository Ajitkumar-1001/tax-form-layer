// POST /api/acts, minus HTTP. One transaction per batch: Zod → engagement lock → project → for each act:
// authorize against the evolving state, 409 check, derive, seal, insert, re-project. A refusal throws, so a
// batch is all-or-nothing. A file{submit} also writes the simulated agency answers as actor `system`.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { type Act, type ActInput, PostActsZ, refsOf } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { deriveFor } from '@/lib/model/derive'
import { type MaskKind, splitMasked } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import type { Viewer } from '@/lib/model/state'
import { viewerOf } from '@/lib/model/viewer'
import { agencyActs } from './agency'
import { insertActs, listActs, listSealed, type NewAct, type SealedSecret } from './acts-repo'
import { type Tx, withEngagementLock } from './db'
import { ENGAGEMENT_RE, pinHash } from './identity'
import { issuedToken, mapStrings, maskFact, type MaskText, type Secret, type Secrets, textMasker } from './mask'
import { type ServerPacket, serverPacket } from './state'

export interface ApiResult {
  status: number
  body: Record<string, unknown>
}

class Refusal extends Error {
  constructor(
    readonly status: 403 | 409,
    readonly reason: string,
    readonly act?: Act,
  ) {
    super(reason)
  }
}

/** Landed act types that change a value (a revert changes whatever its reverted acts changed). */
const CHANGES_VALUE = new Set(['adjust', 'decide'])
/** Incoming act types that are judged against the value the client saw. Notes, time, assign etc. never conflict. */
const READS_VALUE = new Set(['adjust', 'decide', 'verify', 'dispose', 'revert'])

function valueTargets(log: Act[], type: string, target: string): string[] {
  if (type !== 'revert') return [target]
  const i = target.indexOf(':')
  const [kind, id] = [target.slice(0, i), target.slice(i + 1)]
  return log
    .filter((a) => CHANGES_VALUE.has(a.type) && (kind === 'act' ? String(a.seq) === id : a.batch_id === id))
    .map((a) => a.target)
}

/** The first value-changing act on the same target that landed after the client's base_seq. */
function conflict(log: Act[], input: ActInput, baseSeq: number): Act | undefined {
  if (!READS_VALUE.has(input.type)) return
  const mine = valueTargets(log, input.type, input.target)
  return log.find(
    (a) =>
      a.seq > baseSeq &&
      (CHANGES_VALUE.has(a.type) || a.type === 'revert') &&
      valueTargets(log, a.type, a.target).some((t) => mine.includes(t)),
  )
}

/** Tokens the server issued: the packet's and those sealed in this engagement. */
const issuedIn = (sp: ServerPacket, sealed: SealedSecret[]): Secrets => new Map([...sp.secrets, ...sealed.map((x) => [x.eq, x] as const)])

/** A value made only of issued tokens (one, or `routing / account`) is already masked; anything else is tokenized whole. */
const onlyTokens = (s: string, issued: Secrets) =>
  splitMasked(s).every((p) => (typeof p === 'string' ? /^\s*\/?\s*$/.test(p) : issuedToken(p, issued)))

const digits = (v: string) => v.match(/\d/g)?.length ?? 0
/** The fewest digits a real value has: an account can be short, an IP PIN is 6, an SSN or routing number 9. */
const floor = (kind: MaskKind) => (kind === 'account' || kind === 'routing' ? 4 : 6)

/**
 * The masker for act text: the packet's sensitive values, values sealed earlier in this engagement and this act's
 * own new values (`own`). Sealed values join only with 6+ digits, so a fact once set to "pending" or "2024" cannot
 * tokenize every later "pending" or rewrite refs such as py:/return_2024; the act's own values use a per-kind floor.
 */
export function actMasker(sp: ServerPacket, sealed: SealedSecret[], own: Secret[] = []): MaskText {
  const extra = [...sealed.filter((x) => digits(x.value) >= 6), ...own.filter((x) => digits(x.value) >= floor(x.kind))]
  return textMasker(new Map([...sp.known, ...extra.map((x) => [x.value, x.kind] as const)]), issuedIn(sp, sealed))
}

/**
 * What is stored for an input: a new value for a sensitive fact becomes a token (clear value sealed), a client
 * PIN becomes a keyed hash, and free text is masked (actMasker), plus any dashed SSN. Only tokens the server issued
 * pass as given; a made-up token is tokenized whole (a fact value) or masked as text.
 */
export function sealInput(
  sp: ServerPacket, input: ActInput, actor: string, sealedBefore: SealedSecret[] = [],
): Pick<NewAct, 'target' | 'refs' | 'body' | 'sealed'> {
  const found: Secrets = new Map()
  let body: Record<string, unknown> = input.body
  if (input.type === 'client_approve') body = { pin_hash: pinHash(actor, input.body.pin) }
  if (input.type === 'adjust' && input.body.field === 'value' && sp.model.claims[input.target]?.sensitive) {
    const to = input.body.to
    if ((typeof to === 'string' && !onlyTokens(to, issuedIn(sp, sealedBefore))) || typeof to === 'number') {
      body = { ...body, to: maskFact(input.target, String(to), found) }
    }
  }
  const mask = actMasker(sp, sealedBefore, [...found.values()])
  // Encoded values are not text: a digit run inside base64 must not be rewritten.
  body = mapStrings(body, (s, key) => (key === 'data_base64' || key === 'pin_hash' ? s : mask(s, found))) as Record<string, unknown>
  const target = mask(input.target, found)
  const known = new Set(sealedBefore.map((x) => x.eq))
  const secrets = [...found].filter(([eq]) => !sp.secrets.has(eq) && !known.has(eq)).map(([eq, x]) => ({ eq, ...x }))
  return {
    target,
    refs: refsOf({ ...input, target, body } as ActInput),
    body,
    sealed: secrets.length ? { secrets } : undefined,
  }
}

async function writeBatch(
  tx: Tx, sp: ServerPacket, viewer: Viewer, engagement: string, inputs: ActInput[], baseSeq: number,
): Promise<Act[]> {
  const prior = await listActs(engagement, 0, tx)
  const sealed = await listSealed(tx, engagement)
  let log = prior
  let state = project(sp.model, log, viewer, engagement)
  const batch = inputs.length > 1 ? randomUUID() : null
  const out: Act[] = []
  for (const [i, input] of inputs.entries()) {
    const stored = sealInput(sp, input, viewer.id, sealed)
    // Rules, conflicts and derived fields judge what is stored (tokens), never the clear value the client typed.
    const judged = { ...input, target: stored.target, body: stored.body } as ActInput
    const where = inputs.length > 1 ? `Act ${i + 1} of ${inputs.length} (${judged.type} ${judged.target}): ` : ''
    const auth = authorize(sp.model, state, judged, viewer)
    if (!auth.ok) throw new Refusal(403, where + auth.reason)
    const clash = conflict(prior, judged, baseSeq)
    if (clash) {
      throw new Refusal(409, `${where}${clash.actor} recorded ${clash.type} on ${clash.target} (act ${clash.seq}) after you loaded it. Reload and try again.`, clash)
    }
    const written = await insertActs(tx, [{
      ...stored,
      engagement,
      recorded_at: new Date().toISOString(),
      season_at: state.clock,
      actor: viewer.id,
      actor_role: viewer.role,
      type: input.type,
      derived: deriveFor(sp.model, state, judged),
      batch_id: batch,
    }])
    sealed.push(...(stored.sealed?.secrets ?? []))
    log = [...log, ...written]
    if (input.type === 'file' && input.body.kind === 'submit') {
      state = project(sp.model, log, viewer, engagement)
      const answers = await insertActs(tx, agencyActs(sp.model, state, written[0], input.body.jurisdictions))
      written.push(...answers)
      log = [...log, ...answers]
    }
    out.push(...written)
    if (i < inputs.length - 1) state = project(sp.model, log, viewer, engagement)
  }
  return out
}

export async function postActs(actorId: string, raw: unknown): Promise<ApiResult> {
  const parsed = PostActsZ.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { reason: 'Invalid request', issues: parsed.error.issues } }
  const { engagement, acts: inputs, base_seq } = parsed.data
  if (!ENGAGEMENT_RE.test(engagement)) return { status: 400, body: { reason: `Unknown engagement ${engagement}` } }
  const sp = await serverPacket()
  const viewer = viewerOf(sp.masked, actorId)
  try {
    const acts = await withEngagementLock(engagement, (tx) => writeBatch(tx, sp, viewer, engagement, inputs, base_seq))
    return { status: 200, body: { acts } }
  } catch (e) {
    if (e instanceof Refusal) return { status: e.status, body: e.act ? { reason: e.reason, act: e.act } : { reason: e.reason } }
    throw e
  }
}
