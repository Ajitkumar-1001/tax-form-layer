import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '../build'
import type { Packet } from '../packet-types'
import { checks } from './client-answers'
import type { CheckContext } from './types'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const run = (ctx: CheckContext, id: string) => checks.find((c) => c.id === id)!.run(ctx)

describe('client answers vs documents', () => {
  const m = buildModel(packet)

  it('CHK-21 finds the answers the documents contradict', () => {
    const fs = run(m, 'CHK-21')
    expect(fs.map((f) => f.id)).toEqual(['chk:CHK-21:qa-14', 'chk:CHK-21:qa-15', 'chk:CHK-21:qa-31'])
    expect(fs[0].title).toContain('282 sales')
    expect(fs[0].evidence).toEqual(['qa-14', 'D28', 'D31', 'D74'])
    expect(fs[1].title).toContain('12 dispositions')
    expect(fs[2].evidence).toEqual(['qa-31', 'py:/return_2024/lines/F8606.14', 'ev-0991'])
    expect(fs.every((f) => f.fix?.disposition === 'contradicted_by')).toBe(true)
    // The dispose form pre-fills body.ref: the contradicting document that entered the file first.
    expect(fs.map((f) => f.fix?.ref)).toEqual(['D28', 'D34', 'py:/return_2024/lines/F8606.14'])
    expect(fs.map((f) => f.knownSince)).toEqual(['2026-02-15T13:00:00Z', '2026-02-17T05:31:00Z', '2026-01-21T00:00:00Z'])
  })

  it('CHK-21 reads a bare "No" exactly and a worded answer as a heuristic', () => {
    const fs = run(m, 'CHK-21')
    expect(fs.map((f) => f.signal)).toEqual(['computed', 'heuristic', 'heuristic'])
    expect(fs[1].why).toContain('can misfire')
  })

  it('CHK-21 does not read "none" inside an answer as a denial', () => {
    const p = structuredClone(packet)
    p.client.questionnaire.find((q) => q.id === 'qa-14')!.answer = 'Yes, through Northlake; none at a loss.'
    expect(run(buildModel(p), 'CHK-21').map((f) => f.id)).toEqual(['chk:CHK-21:qa-15', 'chk:CHK-21:qa-31'])
  })

  it('CHK-23 flags SE health insurance against the spouse-coverage answer', () => {
    const fs = run(m, 'CHK-23')
    expect(fs).toHaveLength(1)
    expect(fs[0]).toMatchObject({ id: 'chk:CHK-23:Sch1.17', claims: ['Sch1.17', 'qa-25'], expected: 0, actual: 14400, severity: 'high' })
    expect(fs[0].evidence).toEqual(expect.arrayContaining(['ev-0025', 'ev-0044', 'py:/return_2024/notes/Sch1.17']))
  })

  it('CHK-24 lists client-only and unsourced lines, warning only over 1,000', () => {
    const fs = run(m, 'CHK-24')
    expect(fs.map((f) => f.id.slice('chk:CHK-24:'.length)).sort()).toEqual(
      ['F540NR.39', 'F540NR.73', 'F8812.4', 'Sch3.10', 'SchC.J', 'SchE.1A', 'SchE.1B', 'SchE.9A'],
    )
    expect(fs.filter((f) => f.severity === 'warning').map((f) => f.id)).toEqual(['chk:CHK-24:SchE.9A', 'chk:CHK-24:Sch3.10'])
    expect(fs.find((f) => f.id === 'chk:CHK-24:SchE.9A')!.claims).toEqual(['SchE.9A', 'qa-36'])
  })

  it('CHK-24 skips engine defaults, parameters and zeros, but not an unsourced payment', () => {
    const ids = run(m, 'CHK-24').map((f) => f.id)
    // R-DEFAULT-NO, niit_threshold 250,000, and two zero lines: the engine put them there, nobody claimed them.
    for (const k of ['SchB.8', 'F8960.14', 'SchD.18', 'F4797.26g']) expect(ids).not.toContain(`chk:CHK-24:${k}`)
    expect(ids).toContain('chk:CHK-24:F540NR.73')
  })

  it('CHK-25 finds client information no version applied', () => {
    const fs = run(m, 'CHK-25')
    expect(fs.map((f) => f.id)).toEqual(['chk:CHK-25:msg-07', 'chk:CHK-25:msg-08', 'chk:CHK-25:msg-10', 'chk:CHK-25:call-01', 'chk:CHK-25:qa-45'])
    expect(fs.map((f) => f.knownSince)).toEqual(['2026-06-30T18:02:00Z', '2026-07-01T16:40:00Z', '2026-07-13T18:55:00Z', '2026-03-26T17:00:00Z', '2026-01-20T04:00:00Z'])
    // Whether a message matters is read from its wording: a heuristic, and it says so.
    expect(fs.every((f) => f.signal === 'heuristic' && /misfire/.test(f.why))).toBe(true)
  })
})
