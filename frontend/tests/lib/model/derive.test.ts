import { describe, expect, it } from 'vitest'
import { OK, adjust, effective, log } from './test-helpers'

describe('deriveFor: tax effects and partner routing', () => {
  it('SchC.1 -12,400 needs the partner: fed -4,402 / ca -384', () => {
    const l = log()
    expect(l.post('st-01', adjust('SchC.1', 151300))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ from: 163700, effect: { fed: -4402, ca: -384, basis: 'rate' }, needs_partner: true, amendment: 0 })
    expect(l.state.claims['SchC.1'].flags).toContain('needs_partner')
    expect(l.state.totals.federal.delta).toBe(-4402)
  })

  it('F1040.26 -1,000 is exactly 1,000, which is not over', () => {
    const l = log()
    expect(l.post('st-01', adjust('F1040.26', 12000))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ from: 13000, effect: { fed: 1000, ca: 0, basis: 'direct' }, needs_partner: false })
  })

  it('a basis adjust moves from the basis as read and uses the CA-period sourcing', () => {
    const l = log()
    expect(l.post('st-01', { type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to: 19100, reason: 'D11 supplemental basis for the RSU lot', evidence: ['D11'] } })).toEqual(OK)
    expect(l.last().derived).toMatchObject({ from: 0, effect: { fed: -6647, ca: -1222 }, needs_partner: true })
    expect(effective(l.state, 'F8949.B.N1')).toBe(19240) // basis adjusts keep the line value
    expect(l.state.claims['F8949.B.N1'].adjust).toMatchObject({ field: 'basis', from: 0, to: 19100 })
    expect(l.state.claims['F8949.B.total'].flags).toContain('stale')
  })

  it('warns when summed linear estimates cross an engine threshold', () => {
    const l = log()
    l.post('st-01', adjust('SchA.5b', 6508, { reason: 'Seller share of property tax credited at closing' }))
    expect(l.state.totals.warnings).toEqual(['Linear estimate crosses the SALT cap (40,000): the engine must recompute.'])
    l.post('st-01', adjust('SchC.1', 100000))
    expect(l.state.totals.warnings).toEqual(expect.arrayContaining([
      'Linear estimate crosses the child tax credit phase-out (400,000): the engine must recompute.',
      'Linear estimate crosses the AMT 28% bracket (239,100): the engine must recompute.',
    ]))
  })

  it('citing a what-if uses the exact engine result', () => {
    const l = log()
    expect(l.post('st-01', adjust('SchE.14A', 2300, { what_if: 'hvac_improvement' }))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ effect: { fed: 3633, ca: 896, basis: 'what_if' }, needs_partner: true })
  })

  it('the partner threshold is judged on the running total, so small steps cannot avoid it (lead decision)', () => {
    const l = log()
    expect(l.post('st-01', adjust('SchC.1', 161200))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ from: 163700, effect: { fed: -887 }, needs_partner: false })
    expect(l.post('st-01', adjust('SchC.1', 158700))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ from: 161200, effect: { fed: -887 }, needs_partner: true })
    expect(l.state.claims['SchC.1'].flags).toContain('needs_partner')
    expect(l.state.gates.request_approval.reasons.map((r) => r.text)).toContain('1 item over 1,000 lacks a valid partner sign-off.')
  })

  it('later cites of a what-if on its other lines carry zero, so the engine result counts once (lead decision)', () => {
    const l = log()
    expect(l.post('st-01', adjust('SchE.14A', 2300, { what_if: 'hvac_improvement' }))).toEqual(OK)
    expect(l.post('st-01', adjust('SchE.18A', 14041, { what_if: 'hvac_improvement' }))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ from: 13891, effect: { fed: 0, ca: 0, basis: 'what_if' }, needs_partner: false })
    expect([l.state.totals.federal.delta, l.state.totals.california.delta]).toEqual([3633, 896])
    expect(l.post('st-01', { type: 'revert', target: 'act:1', body: { reason: 'Not an improvement' } })).toEqual({
      ok: false, reason: 'Revert act:2 first: it also cites what-if hvac_improvement, whose engine result act:1 carries.',
    })
    expect(l.post('st-01', { type: 'revert', target: 'act:2', body: { reason: 'Not an improvement' } })).toEqual(OK)
    expect(l.post('st-01', { type: 'revert', target: 'act:1', body: { reason: 'Not an improvement' } })).toEqual(OK)
    expect(l.state.totals.federal.delta).toBe(0)
    expect(l.post('st-01', adjust('SchE.18A', 14041, { what_if: 'hvac_improvement' }))).toEqual(OK)
    expect(l.last().derived).toMatchObject({ effect: { fed: 3633, ca: 896, basis: 'what_if' } }) // the first live cite again
  })

  it('a verify stores the hash of the evidence it saw', () => {
    const l = log()
    expect(l.post('st-01', { type: 'verify', target: 'SchC.1', body: { method: 'agreed_to_source_document', level: 'preparer', seen_value: 163700, evidence: [] } })).toEqual(OK)
    expect(l.last().derived).toEqual({ support_hash: expect.stringMatching(/^[0-9a-f]+$/) })
  })
})
