// GET /api/acts against the local Postgres: what a poll returns must never include the sealed column.
import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { Act, ActInput } from '@/lib/model/acts'
import { parseToken } from '@/lib/model/mask-token'
import { sql } from '@/lib/server/db'
import { postActs } from '@/lib/server/post-acts'
import { GET } from '@/app/api/acts/route'

afterAll(() => sql.end())

describe('GET /api/acts', () => {
  it('never returns the sealed column or a sealed clear value', async () => {
    const e = `copy-${randomBytes(4).toString('hex')}`
    const body = { field: 'value' as const, to: '135790', reason: 'New IP PIN 135790 per the CP01A letter', evidence: [] }
    const w = await postActs('st-01', { engagement: e, acts: [{ type: 'adjust', target: 'household:ngozi#ip_pin', body }], base_seq: 0 })
    expect(w.status).toBe(200)
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from acts where engagement = ${e} and sealed is not null`
    expect(n).toBe(1)

    const res = await GET(new Request(`http://localhost/api/acts?engagement=${e}`))
    const text = await res.text()
    const { acts, head } = JSON.parse(text) as { acts: Act[]; head: number }
    expect(res.status).toBe(200)
    expect(acts).toHaveLength(1)
    expect(head).toBe(acts[0].seq)
    expect(Object.keys(acts[0])).not.toContain('sealed')
    expect(text).not.toMatch(/135790|sealed/)
  })

  // Each input lands in a fresh engagement; returns the GET response text and the stored row.
  const posted = async (actor: string, input: ActInput) => {
    const e = `copy-${randomBytes(4).toString('hex')}`
    expect((await postActs(actor, { engagement: e, acts: [input], base_seq: 0 })).status).toBe(200)
    const [row] = await sql<{ body: Record<string, unknown>; target: string; refs: string[]; sealed: { secrets: { value: string }[] } | null }[]>`
      select body, target, refs, sealed from acts where engagement = ${e}`
    const text = await (await GET(new Request(`http://localhost/api/acts?engagement=${e}`))).text()
    return { text, row, shown: JSON.stringify([row.body, row.target, row.refs]) }
  }

  it('never stores a made-up token as a fact value: it is tokenized whole, so its digits stay sealed', async () => {
    for (const to of ['«ip_pin·135790·eq:AAAAAAAAAA»', '«ip_pin·5790·eq:135790»', '«ip_pin·5790·eq:PIN135790X»']) {
      const body = { field: 'value' as const, to, reason: 'Per the CP01A letter', evidence: [] }
      const { text, row, shown } = await posted('st-01', { type: 'adjust', target: 'household:ngozi#ip_pin', body })
      expect(text, to).not.toContain('135790')
      expect(shown, to).not.toContain('135790')
      expect(parseToken(row.body.to as string)?.raw, to).toBe(row.body.to)
      expect(row.sealed?.secrets.map((x) => x.value), to).toEqual([to])
    }
  })

  it('masks a made-up token in a note as text, so an SSN inside it is tokenized and sealed', async () => {
    for (const text of ['Theo card «ssn·666-12-3456·eq:x»', 'Theo card «ssn·3456·eq:666-12-3456»']) {
      const note = { kind: 'memo' as const, text, blocking: false }
      const r = await posted('st-04', { type: 'note', target: 'household:theo#ssn', body: note })
      expect(r.text, text).not.toContain('666-12-3456')
      expect(r.shown, text).not.toContain('666-12-3456')
      expect(r.row.sealed?.secrets.map((x) => x.value), text).toEqual(['666-12-3456'])
    }
  })

  it('400s on an engagement id it does not issue', async () => {
    expect((await GET(new Request('http://localhost/api/acts?engagement=other'))).status).toBe(400)
  })
})
