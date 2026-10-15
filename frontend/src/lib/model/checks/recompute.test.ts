import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { maskPacket } from '@/lib/server/mask'
import { buildModel } from '../build'
import type { Packet } from '../packet-types'
import { checks as carryovers } from './carryovers'
import { checks as processChecks } from './process'
import { checks, distinctW2s, fmt, stepRef } from './recompute'
import { checks as stateSourcing } from './state-sourcing'
import type { Finding } from './types'

const packet = JSON.parse(readFileSync(path.join(__dirname, '../../../../data/okafor_lindqvist_2025_packet.json'), 'utf8')) as Packet
const m = buildModel(packet)
const run = (id: string) => checks.find((c) => c.id === id)!.run(m)

describe('CHK-36 currency conversion', () => {
  const found = run('CHK-36')
  it('only the Swedish interest is off: 18,450 SEK / 9.86 = 1,871, not 1,747', () => {
    expect(found).toHaveLength(1)
    const f = found[0]
    expect(f.id).toBe('chk:CHK-36:SchB.1.6')
    expect([f.expected, f.actual]).toEqual([1871, 1747])
    expect(f.stake).toEqual({ fed: 43, ca: 9 })
    expect(f.fix).toMatchObject({ act: 'adjust', target: 'SchB.1.6', field: 'value', to: 1871 })
  })
})

describe('CHK-37 retirement limit', () => {
  it('SEP 18,000 over the 15,214 limit leaves a 2,786 excess needing a decision', () => {
    const found = run('CHK-37')
    expect(found.map((f) => f.id)).toEqual(['chk:CHK-37:Sch1.16'])
    expect(found[0].title).toBe('Retirement contribution 18,000 exceeds the deductible limit 15,214 by 2,786; no decision is recorded')
    expect(found[0].signal).toBe('computed')
    expect(found[0].fix?.act).toBe('decide')
    expect(found[0].claims).toEqual(['Sch1.16', 'D26'])
  })
  it('names the SEP treatments (withdraw or carry forward, section 4972), not the IRA 6% rule', () => {
    const [f] = run('CHK-37')
    expect(f.why).toContain('carried forward')
    expect(f.why).toContain('section 4972, Form 5330')
    expect(f.why).not.toMatch(/6%|5329/)
    expect(f.fix?.label).toBe('Decide the 2,786 excess: withdraw it by the extended due date, or carry it forward')
  })
})

describe('helpers', () => {
  it('regression: stepRef throws when no firm step matches instead of returning a claim that does not exist', () => {
    expect(stepRef(m, /carryover/i)).toBe('step:6')
    expect(() => stepRef(m, /no such step/i)).toThrow('No firm required step matches /no such step/i')
  })
  it('a check whose step is missing shows up as unable to run, not as findings attached to nothing', () => {
    const steps = packet.firm.starter_standards.required_steps.filter((x) => !/client approval/i.test(x))
    const noStep = buildModel({ ...packet, firm: { ...packet.firm, starter_standards: { ...packet.firm.starter_standards, required_steps: steps } } })
    expect(noStep.findingsById['chk:CHK-53:crashed']?.why).toContain('No firm required step matches')
  })
  it('fmt never prints a negative zero', () => {
    expect(fmt(-0)).toBe('0')
  })
})

describe('CHK-38 excess social security and penalty', () => {
  const found = run('CHK-38')
  it('drops the re-uploaded W-2', () => {
    expect(distinctW2s(m).map((w) => w.doc.id)).toEqual(['D08', 'D09'])
  })
  it('excess social security recomputes to 3,342 and matches Sch3.11 (info)', () => {
    const f = found.find((x) => x.id === 'chk:CHK-38:Sch3.11')!
    expect(f.severity).toBe('info')
    expect([f.expected, f.actual]).toEqual([3342, 3342])
    expect(f.evidence).toEqual(['ev-0019', 'ev-0038'])
  })
  it('the full penalty recompute is a prompt, and the amount owed leaves the penalty out', () => {
    const f = found.find((x) => x.id === 'chk:CHK-38:penalty')!
    expect(f.signal).toBe('prompt')
    expect(f.why).toContain('81,962 − 77,742 + 164 = 4,384')
    expect(f.fix).toMatchObject({ act: 'decide', target: 'F1040.38' })
  })
})

describe('masked packet (what the browser runs)', () => {
  const masked = buildModel(maskPacket(packet).masked)
  const shape = (f: Finding) => ({ id: f.id, severity: f.severity, claims: f.claims, expected: f.expected, actual: f.actual, stake: f.stake, knownSince: f.knownSince })
  it('the server masker really replaced the SSNs and the bank account', () => {
    expect(masked.packet.household.people[0].ssn).toMatch(/^«ssn·/)
    expect(masked.packet.household.bank_account_for_refund_or_payment.routing).toMatch(/^«routing·/)
  })
  it('every check in this group finds the same things on a masked packet', () => {
    for (const c of [...carryovers, ...checks, ...stateSourcing, ...processChecks]) {
      expect(c.run(masked).map(shape)).toEqual(c.run(m).map(shape))
    }
  })
})

it('every finding keeps an existing claim and survives runChecks', () => {
  for (const c of checks) {
    for (const f of c.run(m)) {
      expect(f.claims.length).toBeGreaterThan(0)
      expect(f.claims.every((id) => m.claims[id])).toBe(true)
      expect(m.findingsById[f.id]?.claims).toEqual(f.claims)
    }
  }
})
