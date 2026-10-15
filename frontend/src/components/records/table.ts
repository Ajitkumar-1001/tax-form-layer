// The table model every record renders through <ClaimTable>. Builders are pure: (model, state) → RecordTable.
import type { Model } from '@/lib/model/build'
import type { Val } from '@/lib/model/claims'
import type { State } from '@/lib/model/state'

export type Tone = 'bad' | 'warn' | 'good' | 'muted'

export interface Cell {
  v: Val
  /** Links the cell to /r/<ref>. */
  ref?: string
  /** Several refs, shown as links after the value. */
  refs?: string[]
  money?: boolean
  tone?: Tone
  title?: string
}

export interface Column {
  label: string
  money?: boolean
}

export interface Row {
  key: string
  cells: Cell[]
  /** Exception rows show by default; the rest behind "Show all". */
  exception: boolean
  /** Tree indent (tax computation). */
  depth?: number
}

export interface Banner {
  text: string
  tone: Tone
  refs: string[]
  /** Rendered as a <meter> (e.g. SALT paid against the cap). */
  meter?: { value: number; max: number }
}

export interface Group {
  key: string
  title: string
  ref?: string
  /** Overrides the table's columns for this group. */
  columns?: Column[]
  banner?: Banner
  rows: Row[]
}

export interface RecordTable {
  columns: Column[]
  groups: Group[]
  notes: Banner[]
  /** Trees and short tables show every row; otherwise exceptions only until "Show all". */
  allByDefault?: boolean
}

export type Builder = (model: Model, state: State) => RecordTable

export const text = (v: Val, tone?: Tone, title?: string): Cell => ({ v, tone, title })
export const money = (v: Val, tone?: Tone): Cell => ({ v: typeof v === 'number' ? v : v ?? null, money: true, tone })
export const link = (ref: string, v: Val = ref): Cell => ({ v, ref })
export const links = (refs: string[], v: Val = null): Cell => ({ v, refs })

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const round2 = (n: number): number => Math.round(n * 100) / 100

/** a − b when both are numbers. */
export function diff(a: unknown, b: unknown): number | null {
  const x = num(a)
  const y = num(b)
  return x === null || y === null ? null : round2(x - y)
}

/** Effective value of a claim (after live adjusts), else the packet value. */
export const effective = (model: Model, state: State, id: string): Val => state.claims[id]?.effective ?? model.claims[id]?.value ?? null

export const openCount = (state: State, id: string): number => state.claims[id]?.openFindings.length ?? 0

/** Flags a claim carries, as a short comma list ('' when none). */
export const flagText = (state: State, id: string): string => (state.claims[id]?.flags ?? []).map((f) => f.replaceAll('_', ' ')).join(', ')

/** A single one-group table. */
export const single = (columns: Column[], rows: Row[], notes: Banner[] = []): RecordTable => ({ columns, groups: [{ key: 'all', title: '', rows }], notes })

export const ROW_COLUMNS: Column[] = [{ label: 'Line' }, { label: 'Description' }, { label: 'v3', money: true }, { label: 'Effective', money: true }, { label: 'Open' }, { label: 'Flags' }]

/** Standard line row: line · label · v3 · effective · open findings · flags. Exception = open findings, adjusted or flagged. */
export function lineRow(model: Model, state: State, key: string, depth?: number): Row {
  const c = model.claims[key]
  const s = state.claims[key]
  const v3 = c?.value ?? null
  const eff = effective(model, state, key)
  const changed = s?.adjust !== undefined && !s.adjust.reverted
  return {
    key,
    depth,
    exception: openCount(state, key) > 0 || changed || (s?.flags.length ?? 0) > 0,
    cells: [
      link(key),
      text(c?.label ?? '(not on v3)'),
      typeof v3 === 'number' ? money(v3) : text(v3),
      typeof eff === 'number' ? money(eff, changed ? 'warn' : undefined) : text(eff, changed ? 'warn' : undefined),
      text(openCount(state, key) || null, openCount(state, key) ? 'bad' : undefined),
      text(flagText(state, key) || null, 'warn'),
    ],
  }
}

/** v3 line keys of the given forms, in packet order. */
export const linesOf = (model: Model, forms: string[]): string[] =>
  model.claimList.filter((c) => c.kind === 'line' && c.form && forms.includes(c.form)).map((c) => c.id)

/** One group per form, standard line rows. */
export function formGroups(model: Model, state: State, forms: string[]): Group[] {
  return forms.map((form) => ({ key: form, title: form, rows: linesOf(model, [form]).map((k) => lineRow(model, state, k)) }))
}
