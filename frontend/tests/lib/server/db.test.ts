// Integration tests against the local Postgres (DATABASE_URL or the docker default). Each run writes to its own
// fresh engagements; the table is append-only, so those rows stay. Raw rows (not valid act bodies) go to
// engagements that are never projected.
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Act, ActInput } from '@/lib/model/acts'
import { deriveFor } from '@/lib/model/derive'
import { parseToken, sameValue } from '@/lib/model/mask-token'
import { project } from '@/lib/model/project'
import { viewerOf } from '@/lib/model/viewer'
import { GENESIS_HASH, insertActs, listActs, type NewAct, verifyChain } from '@/lib/server/acts-repo'
import { ensureSchema, sql, withEngagementLock } from '@/lib/server/db'
import { pinHash } from '@/lib/server/identity'
import { postActs, sealInput } from '@/lib/server/post-acts'
import { reveal } from '@/lib/server/reveal'
import { type ServerPacket, serverPacket } from '@/lib/server/state'

const fresh = () => `copy-${randomBytes(4).toString('hex')}`
const eng = fresh()
let sp: ServerPacket
beforeAll(async () => {
  await ensureSchema()
  sp = await serverPacket()
})
afterAll(() => sql.end())

const row = (body: Record<string, unknown>, e = eng): NewAct => ({
  engagement: e, recorded_at: new Date().toISOString(), season_at: '2026-06-23T06:05:00Z', actor: 'st-01',
  actor_role: 'preparer', type: 'note', target: 'F1040.11', refs: ['F1040.11', 'ev-0012'], body, derived: {}, batch_id: null,
})
const last = async (e = eng): Promise<Act> => (await listActs(e)).at(-1)!

describe('acts table', () => {
  it('chains every insert, verifies after a round trip through Postgres, and never returns sealed', async () => {
    const e = fresh()
    await withEngagementLock(e, (tx) =>
      insertActs(tx, [
        row({ text: 'naïve — “quoted” ✓', n: 0.1 + 0.2, nested: { b: [1, null, 'x'], a: true } }, e),
        { ...row({ text: 'two' }, e), sealed: { secrets: [{ eq: 'abc', kind: 'ssn', value: '666-00-0000' }] } },
      ]),
    )
    await withEngagementLock(e, (tx) => insertActs(tx, [row({ text: 'three' }, e)]))
    const acts = await listActs(e)
    expect(acts).toHaveLength(3)
    expect(acts[0].prev_hash).toBe(GENESIS_HASH)
    expect(acts[1].prev_hash).toBe(acts[0].hash)
    expect(verifyChain(acts)).toEqual({ ok: true })
    expect(verifyChain(acts.map((a, i) => (i === 1 ? { ...a, body: { text: 'edited' } } : a)))).toEqual({ ok: false, seq: acts[1].seq })
    expect(JSON.stringify(acts)).not.toContain('666-00-0000')
    expect(Object.keys(acts[1])).not.toContain('sealed')
  })

  it('records which schema.sql it applied, so a warm database gets no DDL (and no ACCESS EXCLUSIVE lock)', async () => {
    const [{ v }] = await sql<{ v: string }[]>`select obj_description('acts'::regclass, 'pg_class') as v`
    expect(v).toMatch(/^schema:[0-9a-f]{16}$/)
  })

  it('rejects UPDATE, DELETE and TRUNCATE (each attempt rolled back even if the trigger were missing)', async () => {
    const e = fresh()
    await withEngagementLock(e, (tx) => insertActs(tx, [row({ text: 'seed' }, e)]))
    const attempts = [
      (tx: typeof sql) => tx`update acts set target = 'tampered' where engagement = ${e}`,
      (tx: typeof sql) => tx`delete from acts where engagement = ${e}`,
      (tx: typeof sql) => tx`truncate acts`,
    ]
    for (const attempt of attempts) {
      await expect(
        sql.begin(async (tx) => {
          await attempt(tx as unknown as typeof sql)
          throw new Error('trigger did not fire')
        }),
      ).rejects.toThrow(/append-only/)
    }
    expect((await last(e)).target).toBe('F1040.11')
  })
})

describe('POST /api/reveal', () => {
  const theo = () => sp.masked.household.people.find((p) => p.id === 'theo')!.ssn

  it('refuses st-04 and logs the refusal', async () => {
    const r = await reveal('st-04', { engagement: eng, token: theo(), context: 'household:theo#ssn' })
    expect(r.status).toBe(403)
    expect(r.body.reason).toMatch(/no sensitive-data clearance/)
    expect(await last()).toMatchObject({
      type: 'view_sensitive', actor: 'st-04', target: 'household:theo#ssn',
      body: { eq: parseToken(theo())!.eq, kind: 'ssn', denied: true },
    })
  })

  it('returns the clear value to cleared staff after logging the view', async () => {
    const r = await reveal('st-01', { engagement: eng, token: theo(), context: 'household:theo#ssn' })
    expect(r).toEqual({ status: 200, body: { value: '666-74-3309' } })
    expect(await last()).toMatchObject({ type: 'view_sensitive', actor: 'st-01', body: { denied: false } })
  })

  it('refuses an unknown tag without pretending a view happened', async () => {
    const r = await reveal('st-01', { engagement: eng, token: '«ssn·0000·eq:nope000000»', context: 'household:theo#ssn' })
    expect(r.status).toBe(404)
  })

  it('never logs a made-up tag, even for staff without clearance (the tag could carry a typed SSN)', async () => {
    const e = fresh()
    const r = await reveal('st-04', { engagement: e, token: '«ssn·3456·eq:666-12-3456»', context: 'household:theo#ssn' })
    expect(r.status).toBe(404)
    expect(await listActs(e)).toHaveLength(0)
  })
})

describe('POST /api/acts', () => {
  const adjust = (target: string, to: string | number, reason = 'Corrected to the source document'): ActInput => ({
    type: 'adjust', target, body: { field: 'value', to, reason, evidence: ['ev-0012'] },
  })
  const stored = async (e: string) => sql<{ seq: string; body: Record<string, unknown>; sealed: { secrets: { value: string }[] } | null }[]>`
    select seq, body, sealed from acts where engagement = ${e} order by seq`

  it('400s on an invalid body', async () => {
    expect((await postActs('st-01', { engagement: eng, acts: [], base_seq: 0 })).status).toBe(400)
    expect((await postActs('st-01', { engagement: 'other', acts: [adjust('F1040.1a', 1)], base_seq: 0 })).status).toBe(400)
  })

  it('tokenizes a new sensitive value, masks it where the same act repeats it, seals it, and reveals it from the seal', async () => {
    const reason = 'New IP PIN 135790 per the 2026 CP01A letter'
    const r = await postActs('st-01', { engagement: eng, acts: [adjust('household:ngozi#ip_pin', '135790', reason)], base_seq: 0 })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toMatch(/135790|sealed/)
    const [act] = r.body.acts as Act[]
    expect(JSON.stringify(await listActs(eng))).not.toContain('135790')
    const token = act.body.to as string
    expect(parseToken(token)).toMatchObject({ kind: 'ip_pin', last4: '' })
    expect(act.body.reason).toMatch(/^New IP PIN «ip_pin··eq:[^»]+» per the 2026 CP01A letter$/)
    expect(sameValue(parseToken(act.body.reason as string)!.raw, token)).toBe(true)
    const [{ sealed }] = await sql`select sealed from acts where seq = ${act.seq}`
    expect(sealed.secrets).toEqual([expect.objectContaining({ kind: 'ip_pin', value: '135790' })])
    const shown = await reveal('st-02', { engagement: eng, token, context: 'household:ngozi#ip_pin' })
    expect(shown).toEqual({ status: 200, body: { value: '135790' } })
  })

  it('masks a value sealed by an earlier act when later text repeats it, without sealing it twice', async () => {
    const note: ActInput = { type: 'note', target: 'household:ngozi#ip_pin', body: { kind: 'memo', text: 'Ngozi read 135790 to me by phone', blocking: false } }
    const r = await postActs('st-01', { engagement: eng, acts: [note], base_seq: 0 })
    expect(r.status).toBe(200)
    const [act] = r.body.acts as Act[]
    expect(act.body.text).toMatch(/^Ngozi read «ip_pin··eq:[^»]+» to me by phone$/)
    expect((await stored(eng)).at(-1)!.sealed).toBeNull()
  })

  it('masks a new bank account wherever the same act repeats it', async () => {
    const e = fresh()
    const reason = 'New account 000111222 at routing 123456789'
    const r = await postActs('st-01', { engagement: e, acts: [adjust('household#bank_account', '123456789 / 000111222', reason)], base_seq: 0 })
    expect(r.status).toBe(200)
    const [row] = await stored(e)
    expect(JSON.stringify(row.body)).not.toMatch(/123456789|000111222/)
    expect(row.body.to).toMatch(/^«routing·6789·eq:[^»]+» \/ «account·1222·eq:[^»]+»$/)
    expect(row.sealed!.secrets.map((x) => x.value).sort()).toEqual(['000111222', '123456789'])
  })

  it('tokenizes a value that only contains a token instead of storing it as given', async () => {
    const e = fresh()
    const to = '«ssn·0000·eq:AAAAAAAAAA» 135790'
    const r = await postActs('st-01', { engagement: e, acts: [adjust('household:ngozi#ip_pin', to)], base_seq: 0 })
    expect(r.status).toBe(200)
    const [row] = await stored(e)
    expect(parseToken(row.body.to as string)?.raw).toBe(row.body.to)
    expect(JSON.stringify(row.body)).not.toContain('135790')
    expect(row.sealed!.secrets.map((x) => x.value)).toEqual([to])
  })

  it('stores a value made only of tokens as given', () => {
    const theo = sp.masked.prior_years.return_2024.dependents[1].ssn
    expect(sealInput(sp, adjust('household:theo#ssn', theo), 'st-01')).toMatchObject({ body: { to: theo }, sealed: undefined })
    const bank = sp.model.claims['household#bank_account'].value as string
    expect(sealInput(sp, adjust('household#bank_account', bank), 'st-01')).toMatchObject({ body: { to: bank }, sealed: undefined })
  })

  it('stores a token as given only if the server issued it (known tag, that value\'s last 4)', () => {
    const theo = parseToken(sp.masked.household.people.find((p) => p.id === 'theo')!.ssn)!
    for (const to of [`«ssn·0000·eq:${theo.eq}»`, '«ssn·3309·eq:AAAAAAAAAA»', '«ssn·3456·eq:666-12-3456»']) {
      const s = sealInput(sp, adjust('household:theo#ssn', to), 'st-01')
      expect(s.sealed?.secrets.map((x) => x.value), to).toEqual([to])
      expect(parseToken(s.body.to as string)?.raw).toBe(s.body.to)
      expect(JSON.stringify(s.body)).not.toContain('666-12-3456')
    }
  })

  it('masks the act\'s own short account number where its text repeats it, but not a non-value like "pending"', () => {
    const bank = sealInput(sp, adjust('household#bank_account', '123456789 / 44175', 'New account 44175'), 'st-01')
    expect(bank.body.reason).toMatch(/^New account «account·4175·eq:[^»]+»$/)
    const pin = sealInput(sp, adjust('household:ngozi#ip_pin', 'pending', 'pending the CP01A letter'), 'st-01')
    expect(pin.body.reason).toBe('pending the CP01A letter')
  })

  it('masks a reveal context with values sealed in the engagement', async () => {
    const e = fresh()
    const w = await postActs('st-01', { engagement: e, acts: [adjust('household:ngozi#ip_pin', '246813')], base_seq: 0 })
    const token = (w.body.acts as Act[])[0].body.to as string
    const r = await reveal('st-01', { engagement: e, token, context: 'household:ngozi#ip_pin 246813' })
    expect(r).toEqual({ status: 200, body: { value: '246813' } })
    const view = await last(e)
    expect(view.type).toBe('view_sensitive')
    expect(JSON.stringify(view)).not.toContain('246813')
    expect(view.target).toMatch(/^household:ngozi#ip_pin «ip_pin··eq:[^»]+»$/)
  })

  it('judges the stored token, so re-entering the current SSN in clear is refused as no change', async () => {
    const r = await postActs('st-01', { engagement: fresh(), acts: [adjust('household:theo#ssn', '666-74-3309')], base_seq: 0 })
    expect(r.status).toBe(403)
    expect(r.body.reason).toMatch(/already "«ssn·3309·eq:/)
    expect(r.body.reason).not.toContain('666-74-3309')
  })

  it('stores a corrected SSN as the same token as the packet value it matches', () => {
    const s = sealInput(sp, adjust('household:theo#ssn', '666-74-3390'), 'st-01')
    expect(sameValue(s.body.to, sp.masked.prior_years.return_2024.dependents[1].ssn)).toBe(true)
    expect(s.sealed).toBeUndefined() // already revealable from the packet
  })

  it('masks SSNs typed into free text', () => {
    const note = sealInput(sp, { type: 'note', target: 'household:theo#ssn', body: { kind: 'memo', text: 'Card says 666-12-3456', blocking: false } }, 'st-01')
    expect(note.body.text).toMatch(/^Card says «ssn·3456·eq:/)
    expect(note.sealed?.secrets[0]).toMatchObject({ kind: 'ssn', value: '666-12-3456' })
  })

  it('stores only a keyed hash of a client approval PIN, never the PIN', async () => {
    const e = fresh()
    // Seeded directly: a real request needs the whole review done first. The client's act goes through postActs.
    const before = project(sp.model, [], viewerOf(sp.masked, 'st-03'), e)
    const request: ActInput = { type: 'request_approval', target: 'return', body: {} }
    const [req] = await withEngagementLock(e, (tx) => insertActs(tx, [{
      engagement: e, recorded_at: new Date().toISOString(), season_at: before.clock, actor: 'st-03', actor_role: 'partner',
      type: 'request_approval', target: 'return', refs: ['return'], body: {}, derived: deriveFor(sp.model, before, request), batch_id: null,
    }]))
    const approve: ActInput = { type: 'client_approve', target: `act:${req.seq}`, body: { pin: '24680' } }
    const r = await postActs('cu-01', { engagement: e, acts: [approve], base_seq: req.seq })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toContain('24680')
    const rows = await sql`select * from acts where engagement = ${e} order by seq`
    expect(rows[1]).toMatchObject({ type: 'client_approve', actor: 'cu-01', body: { pin_hash: pinHash('cu-01', '24680') }, sealed: null })
    expect(JSON.stringify(rows)).not.toContain('24680')
  })

  it('409s when a value-changing act on the same target landed after base_seq', async () => {
    const e = fresh()
    const line = sp.model.claimList.find((c) => c.kind === 'line' && typeof c.value === 'number')!.id
    const first = await postActs('st-01', { engagement: e, acts: [adjust(line, 10)], base_seq: 0 })
    expect(first.status).toBe(200)
    const stale = await postActs('st-01', { engagement: e, acts: [adjust(line, 20)], base_seq: 0 })
    expect(stale.status).toBe(409)
    expect(stale.body.act).toMatchObject({ target: line, actor: 'st-01' })
    const head = (first.body.acts as Act[])[0].seq
    expect((await postActs('st-01', { engagement: e, acts: [adjust(line, 20)], base_seq: head })).status).toBe(200)
    expect(verifyChain(await listActs(e))).toEqual({ ok: true })
  })
})
