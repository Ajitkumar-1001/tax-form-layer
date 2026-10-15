// Prior-year swings (CHK-26): each 2024 line that is also on the current return, against the firm's
// variance standard. Findings go to roots only (a swinging line none of whose inputs, at any depth, also
// swing); totals that merely inherit a swing stay in swingRows for the Records view.
import type { Val } from '../claims'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

export interface SwingRow {
  key: string
  label: string
  /** 2024 return value (prior_years.return_2024.lines). */
  py: number | string
  /** Current (v3) value. */
  v3: Val
  delta: number | null
  /** Percent change; null when 2024 was 0 or either side is not a number. */
  pct: number | null
  over_threshold: boolean
  is_root: boolean
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function swingRows(ctx: CheckContext): SwingRow[] {
  const { flag_if_change_over_percent: pctLimit, and_over_amount: amtLimit } = ctx.packet.firm.starter_standards.variance_review
  const rows = Object.entries(ctx.packet.prior_years.return_2024.lines)
    .filter(([key]) => ctx.lines[key])
    .map(([key, py]) => {
      const v3 = ctx.lines[key].value
      const delta = isNum(py) && isNum(v3) ? Math.round((v3 - py) * 100) / 100 : null
      const pct = delta === null || py === 0 ? null : (delta / Math.abs(py as number)) * 100
      // From 0, any amount over the threshold is an unbounded percentage change.
      const over = delta !== null && Math.abs(delta) > amtLimit && (pct === null || Math.abs(pct) > pctLimit)
      return { key, label: ctx.lines[key].label, py, v3, delta, pct, over_threshold: over, is_root: false }
    })
  const swinging = new Set(rows.filter((r) => r.over_threshold).map((r) => r.key))
  const memo = new Map<string, boolean>()
  const swingsBelow = (key: string): boolean => {
    const known = memo.get(key)
    if (known !== undefined) return known
    memo.set(key, false) // cycle guard
    const r = (ctx.lines[key]?.inputs ?? []).some((i) => swinging.has(i) || swingsBelow(i))
    memo.set(key, r)
    return r
  }
  return rows.map((r) => ({ ...r, is_root: r.over_threshold && !swingsBelow(r.key) }))
}

const chk26: Check = {
  id: 'CHK-26',
  name: 'Prior-year swings over the firm threshold',
  family: 'prior_year_swing',
  run(ctx) {
    const { flag_if_change_over_percent: pctLimit, and_over_amount: amtLimit } = ctx.packet.firm.starter_standards.variance_review
    return swingRows(ctx)
      .filter((r) => r.is_root)
      .map((r): Finding => {
        const line = ctx.lines[r.key]
        const change = r.pct === null ? 'new this year' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%`
        const evidence = [`py:/return_2024/lines/${r.key}`, ...line.sources]
        return {
          id: `chk:CHK-26:${r.key}`,
          check: 'CHK-26',
          family: 'prior_year_swing',
          title: `${line.label} (${r.key}) moved from ${fmt(r.py as number)} in 2024 to ${fmt(r.v3 as number)} (${change})`,
          why: `Firm standard: explain any change over ${pctLimit}% and over ${fmt(amtLimit)} from the prior year. No line it is computed from moved past the threshold, so the change starts here.`,
          severity: 'warning',
          signal: 'computed',
          claims: [r.key],
          evidence,
          actual: r.v3,
          knownSince: latestKnown(ctx, evidence),
          fix: { act: 'decide', target: r.key, label: 'Explain the change from 2024' },
        }
      })
  },
}

export const checks: Check[] = [chk26]
