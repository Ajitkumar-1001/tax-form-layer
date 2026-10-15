// Claims: everything that must be true for the return to be right. Derived from the packet, never stored.
// A claim keeps its packet id, so acts, findings and URLs all point at the same thing.
import type { Jurisdiction, Packet } from './packet-types'
import { type AreaKey, areaOfDoc, areaOfLine, knownAt } from './ids'

export type Val = number | string | boolean | null

export type ClaimKind =
  | 'line'        // a number or entry on a form (v3 line key)
  | 'doc'         // a document that must be accounted for (D01..D74)
  | 'comm'        // a client answer, message or call (qa-, msg-, call-)
  | 'fact'        // a household fact (household:<id>#<field>)
  | 'step'        // a firm required step (step:1..12)
  | 'whatif'      // an engine alternative that needs a decision (whatif:<id>)
  | 'diag'        // an engine diagnostic that needs a disposition (diag:<code>)
  | 'prior_item'  // a prior-preparer note or open item (py:/prior_preparer_workpaper/...)

export interface Claim {
  id: string
  kind: ClaimKind
  area: AreaKey
  label: string
  /** Current packet value: v3 line value, household fact value, etc. Masked tokens for sensitive facts. */
  value?: Val
  /** Lines only: value per engine version and the 2024 return. */
  versions?: { v1?: Val; v2?: Val; v3?: Val; py?: Val }
  jurisdiction?: Jurisdiction
  form?: string
  rule?: string
  note?: string
  /** Packet refs this claim rests on (line sources, or the doc/comm itself). */
  sources: string[]
  /** Lines only: the line keys this line is computed from. */
  inputs: string[]
  /** Lines only: the line keys computed from this one (reverse of inputs). */
  usedBy: string[]
  knownAt: string
  sensitive?: boolean
}

const PY_FALLBACK = '2026-01-21T00:00:00Z'

export function deriveClaims(p: Packet): Record<string, Claim> {
  const out: Record<string, Claim> = {}
  const add = (c: Claim) => (out[c.id] = c)
  const versions = p.return_versions
  const v3 = versions[versions.length - 1]
  const byVersion = versions.map((v) => new Map(v.lines.map((l) => [l.key, l.value])))
  const pyLines = p.prior_years.return_2024.lines

  // Lines (v3 is the current return)
  for (const l of v3.lines) {
    add({
      id: l.key,
      kind: 'line',
      area: areaOfLine(l.key, l.form),
      label: l.label,
      value: l.value,
      versions: {
        v1: byVersion[0].get(l.key),
        v2: byVersion[1].get(l.key),
        v3: l.value,
        py: pyLines[l.key] as Val | undefined,
      },
      jurisdiction: l.jurisdiction,
      form: l.form,
      rule: l.rule,
      note: l.note,
      sources: l.sources,
      inputs: l.inputs,
      usedBy: [],
      knownAt: v3.computed_at,
    })
  }
  for (const c of Object.values(out)) for (const i of c.inputs) out[i]?.usedBy.push(c.id)

  // Documents
  for (const d of p.documents) {
    add({ id: d.id, kind: 'doc', area: areaOfDoc(d.id), label: d.title, sources: [d.id], inputs: [], usedBy: [], knownAt: d.received_at })
  }

  // Client communications
  for (const q of p.client.questionnaire) {
    add({ id: q.id, kind: 'comm', area: 'intake_and_engagement', label: q.question, value: q.answer, sources: [q.id], inputs: [], usedBy: [], knownAt: q.answered_at })
  }
  for (const m of p.client.messages) {
    add({ id: m.id, kind: 'comm', area: 'intake_and_engagement', label: `Message from ${m.from}`, value: m.text, sources: [m.id], inputs: [], usedBy: [], knownAt: m.sent_at })
  }
  for (const c of p.client.call_notes) {
    add({ id: c.id, kind: 'comm', area: 'intake_and_engagement', label: `Client call ${c.date.slice(0, 10)}`, value: c.notes.join(' / '), sources: [c.id], inputs: [], usedBy: [], knownAt: c.date })
  }

  // Household facts (sensitive ones are already masked tokens in a masked packet)
  const hk = knownAt(p, 'household')
  for (const person of p.household.people) {
    const fields: [string, Val, boolean][] = [
      ['name', person.name, false],
      ['ssn', person.ssn, true],
      ['dob', person.dob, false],
    ]
    if (person.ip_pin) fields.push(['ip_pin', person.ip_pin, true])
    if (person.relationship) fields.push(['relationship', person.relationship, false])
    if (person.months_lived_with_you !== undefined) fields.push(['months_lived_with_you', person.months_lived_with_you, false])
    if (person.full_time_student !== undefined) fields.push(['full_time_student', person.full_time_student, false])
    for (const [f, v, sensitive] of fields) {
      add({ id: `household:${person.id}#${f}`, kind: 'fact', area: 'intake_and_engagement', label: `${person.name}: ${f.replaceAll('_', ' ')}`, value: v, sources: [`household:${person.id}`], inputs: [], usedBy: [], knownAt: hk, sensitive })
    }
  }
  const bank = p.household.bank_account_for_refund_or_payment
  add({ id: 'household#bank_account', kind: 'fact', area: 'payments_and_filing', label: `Refund / debit account (${bank.bank}, ${bank.type})`, value: `${bank.routing} / ${bank.account}`, sources: ['household'], inputs: [], usedBy: [], knownAt: hk, sensitive: true })
  add({ id: 'household#residency', kind: 'fact', area: 'california', label: 'Residency periods', value: p.household.residency.map((r) => `${r.state} ${r.from}→${r.to}`).join('; '), sources: ['household'], inputs: [], usedBy: [], knownAt: hk })
  add({ id: 'household#filing_status', kind: 'fact', area: 'intake_and_engagement', label: 'Filing status', value: p.household.filing_status, sources: ['household'], inputs: [], usedBy: [], knownAt: hk })
  add({ id: 'household#prior_year_agi', kind: 'fact', area: 'intake_and_engagement', label: 'Prior-year AGI for e-signature', value: p.household.prior_year_agi_for_esignature, sources: ['household'], inputs: [], usedBy: [], knownAt: hk })

  // Firm required steps
  p.firm.starter_standards.required_steps.forEach((s, i) => {
    add({ id: `step:${i + 1}`, kind: 'step', area: i < 3 ? 'intake_and_engagement' : 'payments_and_filing', label: s, sources: [], inputs: [], usedBy: [], knownAt: v3.computed_at })
  })

  // Engine alternatives and diagnostics need a recorded decision / disposition
  for (const a of p.what_if.alternatives) {
    const touches = a.changed_lines.map((c) => c.key)
    const area = touches.length ? (out[touches[0]]?.area ?? 'payments_and_filing') : 'payments_and_filing'
    add({ id: `whatif:${a.id}`, kind: 'whatif', area, label: a.description, sources: touches.filter((k) => out[k]), inputs: [], usedBy: [], knownAt: versions.find((v) => v.version === a.base_version)?.computed_at ?? v3.computed_at })
  }
  const seenDiag = new Set<string>()
  for (const v of [...versions].reverse()) {
    for (const d of v.diagnostics) {
      if (seenDiag.has(d.code)) continue
      seenDiag.add(d.code)
      const area = d.refs.map((r) => out[r]?.area).find(Boolean) ?? 'payments_and_filing'
      add({ id: `diag:${d.code}`, kind: 'diag', area, label: d.message, value: v === v3 ? d.severity : `vanished after ${v.version}`, sources: d.refs, inputs: [], usedBy: [], knownAt: v.computed_at })
    }
  }

  // Prior-preparer notes and open items
  const ppw = p.prior_years.prior_preparer_workpaper
  ppw.notes.forEach((n, i) => add({ id: `py:/prior_preparer_workpaper/notes/${i}`, kind: 'prior_item', area: 'intake_and_engagement', label: n, sources: ['D07'], inputs: [], usedBy: [], knownAt: PY_FALLBACK }))
  ppw.open_items_left_by_prior_preparer.forEach((n, i) => add({ id: `py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${i}`, kind: 'prior_item', area: 'intake_and_engagement', label: n, sources: ['D07'], inputs: [], usedBy: [], knownAt: PY_FALLBACK }))

  return out
}
