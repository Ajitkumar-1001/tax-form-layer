// Records read from the return's own lines: summary, tax computation, swings, areas, state split and form presets.
import type { Model } from '@/lib/model/build'
import { swingRows } from '@/lib/model/checks/swings'
import type { State } from '@/lib/model/state'
import {
  type Banner, type Builder, type Group, type Row, ROW_COLUMNS, diff, effective, flagText, formGroups, link, lineRow, links, money, num,
  openCount, single, text,
} from './table'

const SUMMARY_LINES = [
  'F1040.1z', 'F1040.2b', 'F1040.3b', 'F1040.4b', 'F1040.7', 'F1040.8', 'F1040.9', 'F1040.10', 'F1040.11', 'F1040.12', 'F1040.13',
  'F1040.15', 'F1040.16', 'F1040.17', 'F1040.19', 'F1040.22', 'F1040.23', 'F1040.24', 'F1040.25d', 'F1040.26', 'F1040.31', 'F1040.33',
  'F1040.37', 'F1040.38',
  'F540NR.13', 'F540NR.17', 'F540NR.19', 'F540NR.32', 'F540NR.35', 'F540NR.40', 'F540NR.64', 'F540NR.71', 'F540NR.72', 'F540NR.73', 'F540NR.78',
  'F540NR.97',
]

/** Banners for the projected totals: always labelled estimate, plus every threshold warning. */
export function totalsNotes(state: State): Banner[] {
  const t = state.totals
  const fmt = (n: number) => n.toLocaleString('en-US')
  const side = (label: string, s: typeof t.federal) =>
    `${label} balance due ${fmt(s.v3.balance_due)} on v3${s.delta ? `, ${s.delta > 0 ? '+' : '−'}${fmt(Math.abs(s.delta))} from live adjustments = ${fmt(s.balance_estimate)} (estimate)` : ''}`
  return [
    { text: `${side('Federal', t.federal)}. ${side('California', t.california)}. Totals are linear estimates until the engine recomputes.`, tone: 'muted', refs: [] },
    ...t.warnings.map((w): Banner => ({ text: w, tone: 'warn', refs: [] })),
  ]
}

export const summary: Builder = (model, state) => {
  const swings = new Map(swingRows(model).map((r) => [r.key, r]))
  const rows = SUMMARY_LINES.filter((k) => model.claims[k]).map((key): Row => {
    const c = model.claims[key]
    const py = c.versions?.py ?? null
    const eff = effective(model, state, key)
    const sw = swings.get(key)
    const adjusted = state.claims[key]?.adjust !== undefined
    return {
      key,
      exception: Boolean(sw?.over_threshold) || adjusted || openCount(state, key) > 0,
      cells: [
        link(key),
        text(c.label),
        money(py),
        money(c.value ?? null),
        money(eff, adjusted ? 'warn' : undefined),
        money(diff(eff, py)),
        sw?.over_threshold ? { v: sw.is_root ? 'swing (root)' : 'swing', tone: 'warn', ref: sw.is_root ? `chk:CHK-26:${key}` : undefined } : text(null),
      ],
    }
  })
  return single(
    [{ label: 'Line' }, { label: 'Description' }, { label: '2024', money: true }, { label: 'v3', money: true }, { label: 'Effective', money: true }, { label: 'Δ vs 2024', money: true }, { label: 'Swing' }],
    rows,
    totalsNotes(state),
  )
}

const TREE_FORMS = new Set(['F1040', 'Sch2', 'F6251', 'F8960', 'F8959'])

/** F1040.24 down to line 11, expanding inputs on the tax-computation forms; repeats are shown once and not re-expanded. */
export const taxComputation: Builder = (model, state) => {
  const rows: Row[] = []
  const seen = new Set<string>()
  const walk = (key: string, depth: number) => {
    const c = model.claims[key]
    if (!c) return
    const row = lineRow(model, state, key, depth)
    const repeat = seen.has(key)
    if (repeat) row.cells[1] = text(`${c.label} (shown above)`, 'muted')
    rows.push(repeat ? { ...row, key: `${key}#${rows.length}` } : row)
    seen.add(key)
    if (repeat || key === 'F1040.11' || !c.form || !TREE_FORMS.has(c.form)) return
    for (const i of c.inputs) walk(i, depth + 1)
  }
  walk('F1040.24', 0)
  return { ...single(ROW_COLUMNS, rows, totalsNotes(state)), allByDefault: true }
}

export const swings: Builder = (model, state) => {
  const order = (r: { is_root: boolean; over_threshold: boolean }) => (r.is_root ? 0 : r.over_threshold ? 1 : 2)
  const rows = swingRows(model)
    .sort((a, b) => order(a) - order(b) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
    .map((r): Row => ({
      key: r.key,
      exception: r.over_threshold,
      cells: [
        link(r.key),
        text(r.label),
        money(num(r.py) ?? null),
        money(num(r.v3)),
        money(r.delta),
        text(r.pct === null ? (r.over_threshold ? 'new' : null) : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%`),
        r.is_root ? { v: 'root', tone: 'warn', ref: `chk:CHK-26:${r.key}` } : text(r.over_threshold ? 'inherits a swing below' : null, 'muted'),
        text(state.claims[r.key]?.decision ? 'explained' : null, 'good'),
      ],
    }))
  const { flag_if_change_over_percent: pct, and_over_amount: amt } = model.packet.firm.starter_standards.variance_review
  return single(
    [{ label: 'Line' }, { label: 'Description' }, { label: '2024', money: true }, { label: 'v3', money: true }, { label: 'Δ', money: true }, { label: '%' }, { label: 'Root' }, { label: 'Decision' }],
    rows,
    [{ text: `Firm standard: explain changes over ${pct}% and over ${amt.toLocaleString('en-US')}. Roots are swings none of whose inputs also swing; totals above them inherit.`, tone: 'muted', refs: [] }],
  )
}

export const areas: Builder = (_model, state) => ({
  columns: [{ label: 'Definition of done' }, { label: 'Status' }, { label: 'Where' }],
  notes: [],
  groups: state.areas.map((a): Group => {
    const signed = (['preparer', 'reviewer', 'partner'] as const).map((l) => {
      const s = a.signoffs[l]
      return `${l} ${s ? (s.valid ? `signed by ${s.actor}` : `reopened (${s.actor})`) : 'not signed'}`
    })
    return {
      key: a.key,
      title: a.label,
      ref: `area:${a.key}`,
      banner: {
        text: `${a.claims} claims · ${a.open} open · ${a.findingsOpen} open findings · assignee ${a.assignee} · ${a.hours}h${a.budget ? ` of ${a.budget}h` : ''} · ${signed.join(' · ')}`,
        tone: a.open || a.findingsOpen ? 'warn' : 'good',
        refs: [],
      },
      rows: a.done.map((d, i): Row => ({
        key: `${a.key}:${i}`,
        exception: !d.ok,
        cells: [text(d.label), text(d.ok ? 'done' : 'not done', d.ok ? 'good' : 'bad'), d.ref ? link(d.ref) : text(null)],
      })),
    }
  }),
})

const SPLIT_COLUMNS = ['A', 'B', 'C', 'D', 'E'] as const

/** Schedule CA (540NR): one row per line with columns A–E, the sourcing rule of column E and any recorded method decision. */
export const stateSplit: Builder = (model, state) => {
  const keys = model.claimList.filter((c) => c.form === 'SchCA540NR').map((c) => c.id)
  const lines = [...new Set(keys.map((k) => k.split('.')[1]))]
  const rules = model.packet.engine_reference.rules
  const rows = lines.map((line): Row => {
    const cols = SPLIT_COLUMNS.map((col) => `SchCA540NR.${line}.${col}`)
    const present = cols.filter((k) => model.claims[k])
    const source = model.claims[`SchCA540NR.${line}.E`]
    const decision = source && state.claims[source.id]?.decision
    const label = (model.claims[present[0]]?.label ?? keys.find((k) => k.split('.')[1] === line) ?? line).replace(/ - [^-]+$/, '')
    const extra = keys.filter((k) => k.split('.')[1] === line && !cols.includes(k))
    return {
      key: line,
      exception: present.some((k) => openCount(state, k) > 0 || flagText(state, k) !== ''),
      cells: [
        text(line),
        extra.length ? links(extra, model.claims[extra[0]].label) : text(label),
        ...cols.map((k) => (model.claims[k] ? { ...money(effective(model, state, k)), ref: k, tone: openCount(state, k) ? ('bad' as const) : undefined } : text(null))),
        text(source ? (rules[source.rule ?? ''] ?? source.rule ?? null) : null, 'muted'),
        decision && source ? links([source.id], decision.choice) : text(decision?.choice ?? null),
      ],
    }
  })
  const days = model.packet.household.residency.map((r) => `${r.state} ${r.from} → ${r.to}`).join('; ')
  return single(
    [{ label: 'Line' }, { label: 'Description' }, { label: 'A federal', money: true }, { label: 'B subtract', money: true }, { label: 'C add', money: true }, { label: 'D CA law', money: true }, { label: 'E CA source', money: true }, { label: 'Method (col. E)' }, { label: 'Sourcing decision' }],
    rows,
    [{ text: `Residency: ${days}. Moved 2025-07-15, so day-based shares use 195 of 365 days.`, tone: 'muted', refs: ['household#residency'] }],
  )
}

const forms = (list: string[], notes: (model: Model, state: State) => Banner[] = () => []): Builder => (model, state) => ({
  columns: ROW_COLUMNS,
  groups: formGroups(model, state, list).filter((g) => g.rows.length),
  notes: notes(model, state),
})

export const rentals = forms(['SchE', 'F8582', 'F4562-E', 'F4797'], (model) => {
  const c = model.packet.prior_years.carryovers_into_2025
  return [{
    text: `Passive losses carried in: 1450 Fremont ${String(c.passive_1450_fremont)}, 1200 Barton Hills ${String(c.passive_1200_barton_hills)}. The Barton Hills condo was sold 2025-10-15 (Form 4797), which frees its suspended losses.`,
    tone: 'muted',
    refs: ['py:/carryovers_into_2025', 'asset:AUS-BLDG'],
  }]
})

export const retirementForeign = forms(['F8606', 'F8889', 'SchB', 'F8938'], (model) => {
  const fx = (model.packet.fx_rates as Record<string, Record<string, number>>).SEK_per_USD ?? {}
  const year = model.packet.household.tax_year
  const findings = model.findings.filter((f) => f.check === 'CHK-36').map((f) => f.id)
  return [{
    text: `FX: income of ${year} converts at the ${year} rate (${fx[`${year}_average`] ?? '?'} SEK per USD average, ${fx[`${year}_year_end`] ?? '?'} at year end), not ${year - 1} (${fx[`${year - 1}_average`] ?? '?'}).`,
    tone: findings.length ? 'warn' : 'muted',
    refs: findings,
  }]
})

/** SALT paid vs the cap (SchA.5d against SchA.5e and engine parameter salt_cap). */
export function saltMeter(model: Model, state: State): Banner {
  const paid = num(effective(model, state, 'SchA.5d')) ?? 0
  const allowed = num(effective(model, state, 'SchA.5e')) ?? 0
  const cap = num(model.packet.engine_reference.parameters.salt_cap) ?? allowed
  const over = Math.max(0, paid - cap)
  return {
    text: `SALT paid ${paid.toLocaleString('en-US')} · cap ${cap.toLocaleString('en-US')} · deducted ${allowed.toLocaleString('en-US')}${over ? ` · ${over.toLocaleString('en-US')} over the cap (lost)` : ''}`,
    tone: over ? 'warn' : 'good',
    refs: ['SchA.5d', 'SchA.5e'],
    meter: { value: paid, max: cap },
  }
}

export const deductions = forms(['SchA', 'F8283', 'F2441', 'F8812'], (model, state) => [
  saltMeter(model, state),
  ...state.totals.warnings.map((w): Banner => ({ text: w, tone: 'warn', refs: [] })),
])
