// Part-year state sourcing rebuilt from dated evidence: wages from pay records, capital gain from sale dates.
import { computeEffect } from '../effects'
import type { ReturnLine } from '../packet-types'
import { distinctW2s, fmt, num, stakeOf, withKnown } from './recompute'
import type { Check, CheckContext } from './types'

const STATE = 'CA' // the state return this engine prepares (jurisdiction 'california')
const DAY = 86_400_000

const isoOf = (mdy: string) => `${mdy.slice(6, 10)}-${mdy.slice(0, 2)}-${mdy.slice(3, 5)}`
const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/** The state's residency window, clamped to the tax year, when it covers only part of that year. */
function partYear(ctx: CheckContext): { from: string; to: string } | null {
  const year = ctx.packet.household.tax_year
  const [start, end] = [`${year}-01-01`, `${year}-12-31`]
  const r = ctx.packet.household.residency.find((x) => x.state === STATE && x.from <= end && x.to >= start)
  if (!r || (r.from <= start && r.to >= end)) return null
  return { from: r.from > start ? r.from : start, to: r.to < end ? r.to : end }
}

const lastVersion = (ctx: CheckContext) => ctx.packet.return_versions[ctx.packet.return_versions.length - 1].version

interface WagePart {
  employer: string
  amount: number | null // null: spans the move with no pay record dated near it
  how: string
  evidence: string[]
  claims: string[]
}

const partYearWages: Check = {
  id: 'CHK-44',
  name: 'Part-year state wages come from dated pay records',
  family: 'state_sourcing',
  run(ctx) {
    const res = partYear(ctx)
    const line = Object.values(ctx.lines).find((l) => l.rule === 'R-CA-WAGES-SOURCE')
    // Only a move out of the state is rebuilt: year-to-date pay at the move is then the in-state part.
    if (!res || res.from !== `${ctx.packet.household.tax_year}-01-01` || !line || typeof line.value !== 'number') return []
    const paystubs = Object.values(ctx.docs).filter((d) => d.document_type === 'paystub')

    const parts: WagePart[] = []
    for (const w of distinctW2s(ctx)) {
      const box16 = num(w.box.box16?.value)
      if (w.box.box15_state?.value !== STATE || box16 === null) continue
      const text = w.doc.pages.map((p) => p.printed_content).join(' ')
      const began = /employment began (\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1]
      const ended = /employment ended (\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1]
      const base = { employer: w.doc.issuer, evidence: [w.box.box16.id], claims: [] }
      if (began && isoOf(began) > res.to) {
        parts.push({ ...base, amount: 0, how: `employment began ${began}, after the move` })
      } else if (ended && isoOf(ended) <= res.to) {
        parts.push({ ...base, amount: box16, how: `box 16, employment ended ${ended}` })
      } else {
        // Employment spans the move (or prints no dates): state wages are the year-to-date state wages on a pay record dated at the move.
        const ytd = paystubs
          .filter((d) => d.issuer === w.doc.issuer)
          .flatMap((d) => ctx.evByDoc[d.id] ?? [])
          .map((e) => ({ e, through: /through (\d{2}\/\d{2}\/\d{4})/i.exec(e.label)?.[1] }))
          .find(({ e, through }) => through && /California|\bCA\b/.test(e.label) && /wage/i.test(e.label) && num(e.value) !== null && Math.abs(daysApart(res.to, isoOf(through))) <= 16)
        parts.push(ytd
          ? { ...base, amount: num(ytd.e.value), how: `pay record ${ytd.e.document_id}, state wages through ${ytd.through}`, evidence: [w.box.box16.id, ytd.e.id], claims: [ytd.e.document_id, w.doc.id] }
          : { ...base, amount: null, how: `${began ? `employment began ${began}, before the ${res.to} move` : ended ? `employment ended ${ended}, after the ${res.to} move` : 'no employment dates printed'}; no pay record dated at the move` })
      }
    }
    if (!parts.length) return []

    const evidence = [...parts.flatMap((p) => p.evidence), 'household']
    const claims = [line.key, ...new Set(parts.flatMap((p) => p.claims))]
    const breakdown = parts.map((p) => `${p.employer} ${p.amount === null ? '?' : fmt(p.amount)} (${p.how})`).join(' + ')
    const id = `chk:CHK-44:${line.key}`
    const unknown = parts.filter((p) => p.amount === null)
    if (unknown.length) {
      return [withKnown(ctx, {
        id, check: 'CHK-44', family: 'state_sourcing', severity: 'warning', signal: 'heuristic', claims, evidence,
        title: `California wages for ${unknown.map((p) => p.employer).join(', ')} cannot be split at the ${res.to} move from the documents on file`,
        why: `${line.key} uses ${fmt(line.value)}. ${breakdown}. Ask for a pay record dated at the move.`,
      })]
    }
    const expected = parts.reduce((a, p) => a + (p.amount ?? 0), 0)
    if (Math.abs(expected - line.value) <= 1) return []
    const e = computeEffect(ctx.packet, line, 'value', line.value, expected)
    const over = line.value - expected
    return [withKnown(ctx, {
      id, check: 'CHK-44', family: 'state_sourcing', severity: 'high', signal: 'computed', claims, evidence,
      title: `California wages are ${over > 0 ? 'overstated' : 'understated'} by ${fmt(Math.abs(over))}: full-year box 16 is used for work after the ${res.to} move`,
      why: `Rebuilt from dated pay records: ${breakdown} = ${fmt(expected)}. ${line.key} uses ${fmt(line.value)}, the W-2 box 16 amounts in full.`,
      expected, actual: line.value, stake: stakeOf(e),
      fix: { act: 'adjust', target: line.key, field: 'value', to: expected, label: `Set California wages to ${fmt(expected)}` },
    })]
  },
}

const SOLD = /sold (\d{4}-\d{2}-\d{2})/

const stateCapitalGain: Check = {
  id: 'CHK-45',
  name: 'State capital gain rebuilt from sale dates',
  family: 'state_sourcing',
  run(ctx) {
    const res = partYear(ctx)
    const line = Object.values(ctx.lines).find((l) => l.rule === 'R-CA-CAPGAIN-SOURCE')
    if (!res || !line || typeof line.value !== 'number') return []
    const year = ctx.packet.household.tax_year
    const ratioDays = daysApart(res.from, res.to) + 1
    const yearDays = daysApart(`${year}-01-01`, `${year}-12-31`) + 1
    const ratio = ratioDays / yearDays
    const value = (l: ReturnLine) => num(l.value) ?? 0

    // Lots are dated by their sale date; Form 4797 sales by the 4797 sale date; the rest of Schedule D
    // (pass-through gains, distributions, carryovers) by resident days.
    const lots = Object.values(ctx.lines).filter((l) => l.form === 'F8949' && !l.key.endsWith('.total'))
    const sale4797 = Object.values(ctx.lines).find((l) => l.form === 'F4797' && /sold/i.test(l.label) && typeof l.value === 'string')
    const sold4797 = typeof sale4797?.value === 'string' ? /(\d{4}-\d{2}-\d{2})\s*$/.exec(sale4797.value)?.[1] : undefined
    const schD = Object.values(ctx.lines).filter((l) => l.form === 'SchD')
    const from4797 = schD.filter((l) => l.inputs.some((k) => k.startsWith('F4797.')))
    const byDay = schD.filter((l) => !l.inputs.length && l.sources.length)

    const dated: { line: ReturnLine; sold: string }[] = [
      ...lots.flatMap((l) => {
        const sold = SOLD.exec(l.label)?.[1]
        return sold ? [{ line: l, sold }] : []
      }),
      ...(sold4797 ? from4797.map((l) => ({ line: l, sold: sold4797 })) : []),
    ]
    const undated = [...lots.filter((l) => !SOLD.test(l.label)), ...(sold4797 ? [] : from4797)]
    const inState = dated.filter((d) => d.sold >= res.from && d.sold <= res.to)
    const datedSum = inState.reduce((a, d) => a + value(d.line), 0)
    const byDaySum = byDay.reduce((a, l) => a + value(l), 0)
    const rebuilt = datedSum + byDaySum * ratio
    const residual = line.value - rebuilt
    if (Math.abs(residual) <= 1) return []

    // A residual equal to a post-move item prorated by days means the engine sourced that item by days.
    const explainers = dated.filter((d) => d.sold > res.to && Math.abs(value(d.line) * ratio - residual) <= 1)
    const zeroBasis = inState.filter((d) => /basis 0(\.00)?\b/.test(d.line.label)).map((d) => d.line.key)
    const expected = Math.round(rebuilt)
    const e = computeEffect(ctx.packet, line, 'value', line.value, expected)
    const named = explainers.map((d) => `${d.line.key} (${fmt(value(d.line))}, sold ${d.sold}) × ${ratioDays}/${yearDays} = ${fmt(value(d.line) * ratio)}`)
    return [withKnown(ctx, {
      id: `chk:CHK-45:${line.key}`, check: 'CHK-45', family: 'state_sourcing', severity: 'warning', signal: 'heuristic',
      title: explainers.length
        ? `California capital gain includes ${explainers.map((d) => d.line.key).join(', ')}, dated after the ${res.to} move, prorated by days`
        : `California capital gain is ${fmt(residual)} away from a rebuild from sale dates`,
      why:
        `Rebuilt: ${inState.length} sales dated ${res.from} to ${res.to} = ${fmt(datedSum)}, plus by-day items (${byDay.map((l) => l.key).join(', ')}) ` +
        `${fmt(byDaySum)} × ${ratioDays}/${yearDays} = ${fmt(byDaySum * ratio)}, total ${fmt(rebuilt)}. ${line.key} is ${fmt(line.value)}, ${fmt(residual)} more. ` +
        (named.length ? `The gap matches ${named.join('; ')}: a gain dated after the move needs a recorded sourcing decision before it counts. ` : 'No single post-move item explains the gap. ') +
        (undated.length ? `Undated items left out: ${undated.map((l) => l.key).join(', ')}. ` : '') +
        (zeroBasis.length ? `Zero-basis sales in the California period (their corrections change this base): ${zeroBasis.join(', ')}.` : ''),
      claims: [line.key, ...explainers.map((d) => d.line.key)],
      evidence: ['household', lastVersion(ctx)],
      expected, actual: line.value, stake: stakeOf(e),
      fix: { act: 'decide', target: line.key, label: `Record the sourcing method for ${explainers.map((d) => d.line.key).join(', ') || line.key}` },
    })]
  },
}

export const checks: Check[] = [partYearWages, stateCapitalGain]
