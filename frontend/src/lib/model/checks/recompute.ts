// Line recomputes that need no engine: currency conversion, the retirement contribution limit,
// and the excess social security credit (the full underpayment penalty stays a prompt).
import { computeEffect } from '../effects'
import { sameValue } from '../mask-token'
import type { ExtractedValue, PacketDocument, ReturnLine } from '../packet-types'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const SS_TAX_RATE = 0.062 // employee social security rate; the wage base comes from the packet

export const fmt = (n: number) => (n + 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) // + 0 turns -0 into 0
/** Money at stake, with the -0 that rounding a zero rate produces turned into 0. */
export const stakeOf = (e: { fed: number; ca: number }) => ({ fed: e.fed + 0, ca: e.ca + 0 })
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const withKnown = (ctx: CheckContext, f: Omit<Finding, 'knownSince'>): Finding => ({ ...f, knownSince: latestKnown(ctx, f.evidence) })

/**
 * Claim id of the firm's required step whose label matches (steps are numbered from 1). Throws when none
 * matches, so runChecks shows the check as unable to run instead of attaching findings to nothing.
 */
export function stepRef(ctx: CheckContext, re: RegExp): string {
  const i = ctx.packet.firm.starter_standards.required_steps.findIndex((s) => re.test(s))
  if (i < 0) throw new Error(`No firm required step matches ${re}`)
  return `step:${i + 1}`
}

export function param(ctx: CheckContext, name: string): number | null {
  return num(ctx.packet.engine_reference.parameters[name])
}

/** Numeric extracted values a line cites. */
export function sourceValues(ctx: CheckContext, line: ReturnLine): ExtractedValue[] {
  return line.sources.map((s) => ctx.ev[s]).filter((e): e is ExtractedValue => !!e && num(e.value) !== null)
}

export interface W2 {
  doc: PacketDocument
  box: Record<string, ExtractedValue> // by extracted field name (box1, box4, box16, employer_ein, ...)
}

/** Form W-2s with re-uploads removed (same person, employer EIN and box 1); the first received wins. */
export function distinctW2s(ctx: CheckContext): W2[] {
  const out: W2[] = []
  const docs = Object.values(ctx.docs)
    .filter((d) => d.document_type === 'W-2')
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
  for (const doc of docs) {
    const box = Object.fromEntries((ctx.evByDoc[doc.id] ?? []).map((e) => [e.field, e]))
    const dup = out.some(
      (w) =>
        w.doc.belongs_to === doc.belongs_to &&
        sameValue(w.box.employer_ein?.value, box.employer_ein?.value) &&
        w.box.box1?.value === box.box1?.value,
    )
    if (!dup) out.push({ doc, box })
  }
  return out
}

function fxRate(ctx: CheckContext, cur: string, key: string): number | null {
  const fx = ctx.packet.engine_reference.parameters.fx
  if (!fx || typeof fx !== 'object') return null
  const table = (fx as Record<string, unknown>)[cur]
  return table && typeof table === 'object' ? num((table as Record<string, unknown>)[key]) : null
}

const currency: Check = {
  id: 'CHK-36',
  name: 'Currency conversion uses the rate of the income year',
  family: 'line_recompute',
  run(ctx) {
    const out: Finding[] = []
    for (const line of Object.values(ctx.lines)) {
      const ref = line.sources.find((s) => s.startsWith('ref:fx.'))
      const m = ref ? /^ref:fx\.([A-Za-z]+)\.(.+)$/.exec(ref) : null
      const evs = sourceValues(ctx, line)
      if (!ref || !m || typeof line.value !== 'number' || !evs.length) continue
      const [, cur, used] = m
      const local = evs.reduce((a, e) => a + (e.value as number), 0)
      const year = ctx.docs[evs[0].document_id]?.tax_year
      // Income converts at the year's average rate; balances (maximum, year-end) at the year-end rate.
      const want = `${year}_${evs.some((e) => /balance|max|highest/i.test(`${e.field} ${e.label}`)) ? 'year_end' : 'average'}`
      const rate = fxRate(ctx, cur, want)
      const evidence = [...evs.map((e) => e.id), ref]
      const base = { id: `chk:CHK-36:${line.key}`, check: 'CHK-36', family: 'line_recompute' as const, claims: [line.key, evs[0].document_id], evidence }
      if (rate === null) {
        if (used !== want) {
          out.push(withKnown(ctx, {
            ...base, severity: 'warning', signal: 'heuristic',
            title: `${line.key} converts ${year} ${cur} at the ${used.replace('_', ' ')} rate; no ${want.replace('_', ' ')} rate is on file`,
            why: `${cur} ${fmt(local)} from ${evs[0].document_id} (tax year ${year}). Income converts at the average rate of the year it was earned.`,
          }))
        }
        continue
      }
      const expected = Math.round(local / rate)
      if (Math.abs(expected - line.value) <= 1) continue
      const e = computeEffect(ctx.packet, line, 'value', line.value, expected)
      out.push(withKnown(ctx, {
        ...base, severity: 'warning', signal: 'computed',
        title: `${line.key} converts ${year} ${cur} at the ${used.replace('_', ' ')} rate instead of the ${want.replace('_', ' ')} (${rate})`,
        why: `${cur} ${fmt(local)} ÷ ${rate} = ${fmt(expected)}; the return shows ${fmt(line.value)}. Income converts at the average rate of the year it was earned, balances at that year's year-end rate.`,
        expected, actual: line.value, stake: stakeOf(e),
        fix: { act: 'adjust', target: line.key, field: 'value', to: expected, label: `Set to ${fmt(expected)} (${cur} ${fmt(local)} at ${rate})` },
      }))
    }
    return out
  },
}

const retirementLimit: Check = {
  id: 'CHK-37',
  name: 'Retirement contribution within its limit, excess decided',
  family: 'line_recompute',
  run(ctx) {
    const out: Finding[] = []
    const value = (k: string) => num(ctx.lines[k]?.value) ?? 0
    for (const line of Object.values(ctx.lines)) {
      const evs = sourceValues(ctx, line)
      if (line.rule !== 'R-SEP-LIMIT' || typeof line.value !== 'number' || !evs.length) continue
      const contribution = evs.reduce((a, e) => a + (e.value as number), 0)
      const profit = line.inputs.filter((k) => k.startsWith('SchC.')).reduce((a, k) => a + value(k), 0)
      const halfSe = line.inputs.filter((k) => k.startsWith('SchSE.')).reduce((a, k) => a + value(k), 0)
      const limit = Math.round(0.2 * (profit - halfSe))
      const deductible = Math.min(contribution, limit)
      const docs = [...new Set(evs.map((e) => e.document_id))]
      const evidence = evs.map((e) => e.id)
      if (Math.abs(deductible - line.value) > 1) {
        const e = computeEffect(ctx.packet, line, 'value', line.value, deductible)
        out.push(withKnown(ctx, {
          id: `chk:CHK-37:${line.key}:limit`, check: 'CHK-37', family: 'line_recompute', severity: 'warning', signal: 'computed',
          title: `${line.key} deducts ${fmt(line.value)}; the recomputed deductible amount is ${fmt(deductible)}`,
          why: `Limit 20% × (net profit ${fmt(profit)} − half SE tax ${fmt(halfSe)}) = ${fmt(limit)}; contribution ${fmt(contribution)}.`,
          claims: [line.key, ...docs], evidence, expected: deductible, actual: line.value, stake: stakeOf(e),
          fix: { act: 'adjust', target: line.key, field: 'value', to: deductible, label: `Set to ${fmt(deductible)}` },
        }))
      }
      const excess = Math.round(contribution - limit)
      if (excess <= 0) continue
      const carried = Object.entries(ctx.packet.return_versions.at(-1)?.carryovers_out.federal ?? {}).find(([k]) => /sep/i.test(k))
      out.push(withKnown(ctx, {
        id: `chk:CHK-37:${line.key}`, check: 'CHK-37', family: 'line_recompute', severity: 'warning', signal: 'computed',
        title: `Retirement contribution ${fmt(contribution)} exceeds the deductible limit ${fmt(limit)} by ${fmt(excess)}; no decision is recorded`,
        why:
          `Limit 20% × (net profit ${fmt(profit)} − half SE tax ${fmt(halfSe)}) = ${fmt(limit)}. The excess is not deductible this year: ` +
          `it is either withdrawn by the return's due date including extensions, or kept and carried forward to a later year's limit. ` +
          `A kept excess can owe a 10% excise tax on nondeductible contributions (section 4972, Form 5330); confirm the treatment before deciding. ` +
          (carried ? `carryovers_out records ${fmt(Number(carried[1]))} as not deductible. ` : 'carryovers_out has no row for it. ') +
          'The limit moves with any correction to Schedule C net profit.',
        claims: [line.key, ...docs], evidence,
        fix: { act: 'decide', target: line.key, label: `Decide the ${fmt(excess)} excess: withdraw it by the extended due date, or carry it forward` },
      }))
    }
    return out
  },
}

const excessSocialSecurity: Check = {
  id: 'CHK-38',
  name: 'Excess social security and the underpayment penalty',
  family: 'line_recompute',
  run(ctx) {
    const out: Finding[] = []
    const base = param(ctx, 'ss_wage_base')
    const line = Object.values(ctx.lines).find((l) => l.rule === 'R-EXCESS-SS')
    if (base !== null) {
      const max = Math.round(base * SS_TAX_RATE * 100) / 100
      const byPerson = new Map<string, W2[]>()
      for (const w of distinctW2s(ctx)) byPerson.set(w.doc.belongs_to, [...(byPerson.get(w.doc.belongs_to) ?? []), w])
      let excess = 0
      const evidence: string[] = []
      const parts: string[] = []
      for (const [who, w2s] of byPerson) {
        const withheld = w2s.reduce((a, w) => a + (num(w.box.box4?.value) ?? 0), 0)
        if (w2s.length < 2 || withheld <= max) continue
        excess += withheld - max
        evidence.push(...w2s.flatMap((w) => (w.box.box4 ? [w.box.box4.id] : [])))
        const name = ctx.packet.household.people.find((p) => p.role === who)?.name ?? who
        parts.push(`${name}: box 4 ${w2s.map((w) => `${w.doc.issuer} ${fmt(num(w.box.box4?.value) ?? 0)}`).join(' + ')} = ${fmt(withheld)}, over the ${fmt(max)} maximum by ${fmt(withheld - max)}`)
      }
      const expected = Math.round(excess)
      const actual = num(line?.value) ?? 0
      if (expected > 0 || actual > 0) {
        const matches = Math.abs(expected - actual) <= 1
        const target = line?.key ?? 'F1040.31'
        const e = line && !matches ? computeEffect(ctx.packet, line, 'value', actual, expected) : null
        out.push(withKnown(ctx, {
          id: `chk:CHK-38:${target}`, check: 'CHK-38', family: 'line_recompute', severity: matches ? 'info' : 'warning', signal: 'computed',
          title: !line
            ? `Excess social security withheld of ${fmt(expected)} is not claimed`
            : matches
              ? `Excess social security withheld recomputes to ${fmt(expected)}, as claimed`
              : `Excess social security withheld recomputes to ${fmt(expected)}; the return claims ${fmt(actual)}`,
          why: `Wage base ${fmt(base)} × 6.2% = ${fmt(max)} per person. ${parts.join('; ') || 'No one had two or more employers over the maximum'}. Form 2210 treats this credit as federal withholding.`,
          claims: [target], evidence, ...(line ? { expected, actual } : {}),
          ...(e ? { stake: stakeOf(e), fix: { act: 'adjust' as const, target, field: 'value' as const, to: expected, label: `Set to ${fmt(expected)}` } } : {}),
        }))
      }
    }

    const penalty = ctx.lines['F1040.38']
    const amount = num(penalty?.value)
    if (penalty && amount !== null && amount > 0) {
      const tax = num(ctx.lines['F1040.24']?.value)
      const paid = num(ctx.lines['F1040.33']?.value)
      const owed = num(ctx.lines['F1040.37']?.value)
      const withPenalty = tax !== null && paid !== null ? tax - paid + amount : null
      const omitted = withPenalty !== null && owed !== null && Math.abs(owed - withPenalty) > 1
      const methodLine = ctx.lines[penalty.inputs.find((k) => k.startsWith('F2210.')) ?? '']
      out.push(withKnown(ctx, {
        id: 'chk:CHK-38:penalty', check: 'CHK-38', family: 'line_recompute', severity: 'warning', signal: 'prompt',
        title: `The ${fmt(amount)} underpayment penalty is the engine's figure; the workpaper does not recompute it`,
        why:
          'Recompute the Form 2210 schedule by hand: four equal installments, withholding (including excess social security) treated as paid evenly, ' +
          'estimated payments at the dates the IRS transcript posts them, then record a penalty decision with authority.' +
          (omitted ? ` Also, the amount owed (F1040.37 ${fmt(owed!)}) leaves the penalty out: ${fmt(tax!)} − ${fmt(paid!)} + ${fmt(amount)} = ${fmt(withPenalty!)}.` : ''),
        claims: [penalty.key, ...(methodLine ? [methodLine.key] : []), ...(omitted ? ['F1040.37'] : [])],
        evidence: methodLine?.sources ?? [],
        fix: { act: 'decide', target: penalty.key, label: 'Record the penalty decision with its authority' },
      }))
    }
    return out
  },
}

export const checks: Check[] = [currency, retirementLimit, excessSocialSecurity]
