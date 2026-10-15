// Tax effect of a change, per the packet README: delta x return_versions[v3].tax_effect_rates[category].
// Rates are signed per dollar of the category quantity (income +, deductions -), so each line needs
// the sign that maps its own value onto that quantity. Credits and payments move tax/balance 1:1.
import type { Packet, ReturnLine, TaxEffectCategory } from './packet-types'

export type EffectCategory = TaxEffectCategory | 'direct' | 'none'
export type AdjustField = 'value' | 'basis' | 'label'

export interface EffectSpec {
  category: EffectCategory
  /** CA leg category when it differs (fully California-source items use ca_source_income). */
  caCategory?: EffectCategory
  /** +1 if the field moves the category quantity in the same direction, -1 if opposite, 0 if no effect. */
  sign: 1 | -1 | 0
  hint?: string
}

const CA_MOVE_DATE = '2025-07-14' // last CA-resident day (household.residency)
const ST_BOXES = new Set(['A', 'B', 'C', 'G', 'H', 'I'])

export function effectSpec(line: ReturnLine, field: AdjustField = 'value'): EffectSpec {
  if (field === 'label' || typeof line.value === 'string') return { category: 'none', sign: 0 }
  const [form, ...rest] = line.key.split('.')
  const ln = rest.join('.')
  const num = parseFloat(ln)

  switch (form) {
    case 'F8949': {
      const box = rest[0]
      const category: EffectCategory = ST_BOXES.has(box) ? 'stcg' : 'ltcg'
      // A sale while CA-resident is fully CA-source; a sale after the move is not CA income at all.
      const sold = /sold (\d{4}-\d{2}-\d{2})/.exec(line.label)?.[1]
      const caCategory: EffectCategory | undefined = sold ? (sold <= CA_MOVE_DATE ? 'ca_source_income' : 'none') : undefined
      return { category, caCategory, sign: field === 'basis' ? -1 : 1 }
    }
    case 'SchD':
      return { category: num <= 7 ? 'stcg' : 'ltcg', sign: 1 }
    case 'SchB':
      return { category: 'interest', sign: 1 }
    case 'F1040':
      if (/^1[a-z]$/.test(ln)) return { category: 'wages', sign: 1 }
      if (['2b', '3a', '3b'].includes(ln)) return { category: 'interest', sign: 1 }
      if (['25a', '25b', '25d', '26'].includes(ln)) return { category: 'direct', sign: -1, hint: 'Payment: balance due moves 1:1' }
      if (ln === '19') return { category: 'direct', sign: -1, hint: 'Credit: tax moves 1:1' }
      return { category: 'none', sign: 0, hint: 'Total line: adjust the line that feeds it' }
    case 'SchC':
      if (ln === '44a' || ln === '44b' || ln === '44c') return { category: 'none', sign: 0, hint: 'Miles: adjust SchC.9 (car expense) for the effect' }
      if (num <= 7 || ln === '29' || ln === '31') return { category: 'schc_profit', sign: 1 }
      return { category: 'schc_profit', sign: -1 }
    case 'Sch1':
      if (['13', '15', '16', '17'].includes(ln)) return { category: 'adjustment', sign: 1 }
      return { category: 'none', sign: 0, hint: 'Total line: adjust the line that feeds it' }
    case 'Sch3':
      if (['10', '11'].includes(ln)) return { category: 'direct', sign: -1, hint: 'Payment: balance due moves 1:1' }
      if (ln === '1') return { category: 'direct', sign: -1, hint: 'Credit: tax moves 1:1' }
      return { category: 'none', sign: 0 }
    case 'SchA':
      if (ln.startsWith('5')) return { category: 'salt', sign: 1 }
      return { category: 'itemized', sign: 1 }
    case 'F8283':
      return { category: 'itemized', sign: 1 }
    case 'SchE': {
      const prop = ln.slice(-1)
      const caCategory = prop === 'A' ? 'ca_source_income' : undefined // 1450 Fremont Way, Sacramento
      if (/^3[AB]$/.test(ln)) return { category: 'ordinary_income', caCategory, sign: 1 }
      if (/^(9|1\d)[AB]$/.test(ln)) return { category: 'ordinary_income', caCategory, sign: -1 }
      return { category: 'none', sign: 0, hint: 'Passive-limited total: adjust the property line' }
    }
    case 'SchCA540NR':
      return ln.endsWith('.E') ? { category: 'ca_source_income', sign: 1 } : { category: 'none', sign: 0 }
    case 'F540NR':
      if (['71', '72', '73'].includes(ln)) return { category: 'direct', sign: -1, hint: 'Payment: balance moves 1:1' }
      return { category: 'none', sign: 0 }
    case 'ScheduleS':
    case 'F8812':
      return { category: 'direct', sign: -1, hint: 'Credit: tax moves 1:1' }
    default:
      return { category: 'none', sign: 0 }
  }
}

export interface Effect {
  fed: number
  ca: number
  basis: 'rate' | 'direct' | 'what_if' | 'none'
  category: EffectCategory
  caCategory?: EffectCategory
}

const CA_PAYMENT_OR_CREDIT = /^(F540NR|ScheduleS)\./

/** Effect on tax (or balance due, for payments) of moving `field` from `from` to `to`. Rounded to dollars. */
export function computeEffect(p: Packet, line: ReturnLine, field: AdjustField, from: number, to: number): Effect {
  const spec = effectSpec(line, field)
  const delta = (to - from) * spec.sign
  if (spec.category === 'none' || spec.sign === 0) return { fed: 0, ca: 0, basis: 'none', category: 'none' }
  if (spec.category === 'direct') {
    const isCA = CA_PAYMENT_OR_CREDIT.test(line.key)
    return { fed: isCA ? 0 : Math.round(delta), ca: isCA ? Math.round(delta) : 0, basis: 'direct', category: 'direct' }
  }
  const rates = p.return_versions[p.return_versions.length - 1].tax_effect_rates
  const caCat = spec.caCategory ?? spec.category
  return {
    fed: Math.round(delta * rates[spec.category].federal_per_dollar),
    ca: caCat === 'none' || caCat === 'direct' ? 0 : Math.round(delta * rates[caCat].california_per_dollar),
    basis: 'rate',
    category: spec.category,
    caCategory: spec.caCategory,
  }
}

/** Exact engine result for a packet what_if alternative (used instead of the rate when an act cites one). */
export function whatIfEffect(p: Packet, id: string): Effect | null {
  const alt = p.what_if.alternatives.find((a) => a.id === id)
  if (!alt) return null
  return {
    fed: Math.round(alt.federal.total_tax_change + (alt.federal.penalty_change ?? 0)),
    ca: Math.round(alt.california.total_tax_change),
    basis: 'what_if',
    category: 'none',
  }
}

/** Firm rule: "Any adjustment with a tax effect over 1,000 (federal or state) requires partner sign-off." */
export const PARTNER_THRESHOLD = 1000
export const needsPartner = (e: Pick<Effect, 'fed' | 'ca'>) => Math.max(Math.abs(e.fed), Math.abs(e.ca)) > PARTNER_THRESHOLD
