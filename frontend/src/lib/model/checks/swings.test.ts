import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModel } from '../build'
import type { Packet } from '../packet-types'
import { checks, swingRows } from './swings'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet

describe('CHK-26 prior-year swings', () => {
  const m = buildModel(packet)
  const rows = swingRows(m)

  it('compares every 2024 line that is on the current return', () => {
    expect(rows).toHaveLength(87)
    expect(rows.filter((r) => r.delta !== null)).toHaveLength(85)
    expect(rows.filter((r) => r.over_threshold)).toHaveLength(51)
    const roots = rows.filter((r) => r.is_root)
    expect(roots).toHaveLength(19)
    expect(roots.filter((r) => !m.lines[r.key].inputs.length)).toHaveLength(14)
  })

  it('applies both thresholds, and treats a 2024 zero as unbounded', () => {
    const row = (k: string) => rows.find((r) => r.key === k)!
    expect(row('SchC.1')).toMatchObject({ py: 128400, v3: 163700, delta: 35300, over_threshold: true, is_root: true })
    expect(row('Sch1.17')).toMatchObject({ py: 0, v3: 14400, pct: null, over_threshold: true, is_root: false })
    expect(row('SchC.31').is_root).toBe(false)
  })

  it('raises findings on roots only', () => {
    const fs = checks[0].run(m)
    expect(fs).toHaveLength(19)
    expect(fs.map((f) => f.id)).toEqual(expect.arrayContaining(['chk:CHK-26:SchC.1', 'chk:CHK-26:SchE.14A', 'chk:CHK-26:SchC.44a', 'chk:CHK-26:F1040.26']))
    expect(fs.find((f) => f.id === 'chk:CHK-26:SchC.1')!.title).toContain('+27.5%')
    expect(fs.every((f) => f.severity === 'warning' && f.fix?.act === 'decide')).toBe(true)
  })
})
