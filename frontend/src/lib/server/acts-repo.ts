// The act log: read, append with a SHA-256 hash chain, verify. The `sealed` column never leaves this file
// except through findSealed (used by reveal after it has logged the view) and listSealed (used to mask act text).
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { Act, ActType } from '@/lib/model/acts'
import { canonical } from '@/lib/model/hash'
import type { MaskKind } from '@/lib/model/mask-token'
import type { JSONValue } from 'postgres'
import { type Db, ensureSchema, sql, type Tx } from './db'

export const GENESIS_HASH = '0'.repeat(64)

export interface SealedSecret {
  eq: string
  kind: MaskKind
  value: string
}
export interface Sealed {
  secrets: SealedSecret[]
}

/** What a writer supplies; id, chain and seq are assigned here. */
export type NewAct = Omit<Act, 'seq' | 'id' | 'hash' | 'prev_hash'> & { sealed?: Sealed }

interface ActRow {
  seq: string // bigint arrives as a string
  id: string
  engagement: string
  recorded_at: Date
  season_at: Date
  actor: string
  actor_role: string
  type: string
  target: string
  refs: string[]
  body: Record<string, unknown>
  derived: Record<string, unknown>
  batch_id: string | null
  prev_hash: string
  hash: string
}

const toAct = (r: ActRow): Act => ({
  seq: Number(r.seq),
  id: r.id,
  engagement: r.engagement,
  recorded_at: r.recorded_at.toISOString(),
  season_at: r.season_at.toISOString(),
  actor: r.actor,
  actor_role: r.actor_role,
  type: r.type as ActType,
  target: r.target,
  refs: r.refs,
  body: r.body,
  derived: r.derived,
  batch_id: r.batch_id,
  prev_hash: r.prev_hash,
  hash: r.hash,
})

/**
 * sha256(prev_hash || canonical(row without seq and hash)). `sealed` is deliberately outside the hash:
 * the hash is public, and a hash over a clear SSN with every other field known is brute-forceable.
 * Sealed values stay bound to the chain through their HMAC equality tag in the body.
 */
export function actHash(a: Omit<Act, 'seq' | 'hash'>): string {
  const row = {
    id: a.id, engagement: a.engagement, recorded_at: a.recorded_at, season_at: a.season_at, actor: a.actor,
    actor_role: a.actor_role, type: a.type, target: a.target, refs: a.refs, body: a.body, derived: a.derived,
    batch_id: a.batch_id, prev_hash: a.prev_hash,
  }
  return createHash('sha256').update(a.prev_hash + canonical(row)).digest('hex')
}

/** Acts of one engagement with seq > after, oldest first. Never selects `sealed`. */
export async function listActs(engagement: string, after = 0, db: Db = sql): Promise<Act[]> {
  if (db === sql) await ensureSchema()
  const rows = await db<ActRow[]>`
    select seq, id, engagement, recorded_at, season_at, actor, actor_role, type, target, refs, body, derived,
           batch_id, prev_hash, hash
    from acts where engagement = ${engagement} and seq > ${after} order by seq`
  return rows.map(toAct)
}

/** Highest seq in an engagement (0 when empty). */
export async function headSeq(engagement: string, db: Db = sql): Promise<number> {
  if (db === sql) await ensureSchema()
  const [{ head }] = await db<{ head: string }[]>`select coalesce(max(seq), 0) as head from acts where engagement = ${engagement}`
  return Number(head)
}

/** Append rows (one engagement) to the chain. Call inside withEngagementLock so the head cannot move. */
export async function insertActs(tx: Tx, rows: NewAct[]): Promise<Act[]> {
  if (!rows.length) return []
  const engagement = rows[0].engagement
  if (rows.some((r) => r.engagement !== engagement)) throw new Error('insertActs: one engagement per call')
  const [head] = await tx<{ hash: string }[]>`select hash from acts where engagement = ${engagement} order by seq desc limit 1`
  let prev = head?.hash ?? GENESIS_HASH
  const out: Act[] = []
  for (const { sealed, ...r } of rows) {
    // Hash exactly what reads back (ms ISO timestamps, JSON-normalised bodies), or the chain would not re-verify.
    const unsigned = {
      ...r,
      recorded_at: new Date(r.recorded_at).toISOString(),
      season_at: new Date(r.season_at).toISOString(),
      body: JSON.parse(JSON.stringify(r.body)) as Record<string, unknown>,
      derived: JSON.parse(JSON.stringify(r.derived)) as Record<string, unknown>,
      id: randomUUID(),
      prev_hash: prev,
    }
    const hash = actHash(unsigned)
    const [{ seq }] = await tx<{ seq: string }[]>`
      insert into acts (id, engagement, recorded_at, season_at, actor, actor_role, type, target, refs, body, derived,
                        sealed, batch_id, prev_hash, hash)
      values (${unsigned.id}, ${engagement}, ${unsigned.recorded_at}::timestamptz, ${unsigned.season_at}::timestamptz,
              ${r.actor}, ${r.actor_role}, ${r.type}, ${r.target}, ${r.refs}::text[], ${tx.json(unsigned.body as JSONValue)},
              ${tx.json(unsigned.derived as JSONValue)}, ${sealed ? tx.json(sealed as unknown as JSONValue) : null}::jsonb,
              ${r.batch_id}::uuid, ${prev}, ${hash})
      returning seq`
    out.push({ ...unsigned, seq: Number(seq), hash })
    prev = hash
  }
  return out
}

/** Recompute the chain of one engagement's acts (all of them, oldest first). */
export function verifyChain(acts: Act[]): { ok: true } | { ok: false; seq: number } {
  let prev = GENESIS_HASH
  for (const a of acts) {
    if (a.prev_hash !== prev || actHash(a) !== a.hash) return { ok: false, seq: a.seq }
    prev = a.hash
  }
  return { ok: true }
}

/** Every clear value sealed in an engagement, so later act text that repeats one is masked too. */
export async function listSealed(db: Db, engagement: string): Promise<SealedSecret[]> {
  const rows = await db<{ sealed: Sealed }[]>`select sealed from acts where engagement = ${engagement} and sealed is not null order by seq`
  return rows.flatMap((r) => r.sealed.secrets)
}

/** A clear value the server tokenized when an act was written (e.g. a corrected SSN). */
export async function findSealed(db: Db, engagement: string, eq: string): Promise<SealedSecret | undefined> {
  const [row] = await db<{ sealed: Sealed }[]>`
    select sealed from acts
    where engagement = ${engagement} and sealed->'secrets' @> ${db.json([{ eq }])}
    order by seq desc limit 1`
  return row?.sealed.secrets.find((s) => s.eq === eq)
}
