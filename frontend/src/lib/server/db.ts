// Postgres client (porsager `postgres`), schema bootstrap and the per-engagement write lock.
import 'server-only'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'

export type Tx = postgres.TransactionSql
export type Db = postgres.Sql | Tx

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:54329/workpaper'

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  // prepare:false keeps it working behind transaction-mode poolers (Neon, Supabase, pgbouncer).
  return postgres(url, { prepare: false, ssl: local ? false : 'require', max: 5, onnotice: () => {} })
}

// Survives dev hot reloads and is shared by every route bundle in the process.
const g = globalThis as typeof globalThis & { __wpSql?: postgres.Sql; __wpSchema?: Promise<void> }
export const sql: postgres.Sql = (g.__wpSql ??= connect())

const schemaVersion = async (db: Db): Promise<string | null> =>
  (await db<{ v: string | null }[]>`select obj_description(to_regclass('acts'), 'pg_class') as v`)[0]?.v ?? null

/**
 * Apply src/db/schema.sql once per process, and only when it changed since it was last applied (its hash is kept
 * as the table comment). Re-running the DDL on a live table takes strong locks (DROP TRIGGER is ACCESS EXCLUSIVE)
 * and deadlocks with writers in other processes, so a warm database is left alone.
 */
export function ensureSchema(): Promise<void> {
  g.__wpSchema ??= readFile(path.join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf8')
    .then(async (ddl) => {
      const version = `schema:${createHash('sha256').update(ddl).digest('hex').slice(0, 16)}`
      if ((await schemaVersion(sql)) === version) return
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('wp:schema'))`
        if ((await schemaVersion(tx)) === version) return // another process applied it while we waited
        await tx.unsafe(ddl)
        await tx.unsafe(`comment on table acts is '${version}'`) // hex only; COMMENT takes no parameters
      })
    })
    .then(
      () => undefined,
      (e: unknown) => {
        g.__wpSchema = undefined
        throw e
      },
    )
  return g.__wpSchema
}

/** One transaction holding pg_advisory_xact_lock(hashtext(engagement)): writes to an engagement are serial. */
export async function withEngagementLock<T>(engagement: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await ensureSchema()
  const out = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${engagement}))`
    return fn(tx)
  })
  return out as T
}
