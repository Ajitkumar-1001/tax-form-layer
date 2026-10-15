// Payments vs agency records (CHK-19): estimated and extension payments on the return are tied, payment
// by payment, to the IRS account transcript (code 670) and the FTB ledger by designated tax year.
// A client's recollection never stands in for an agency record.
import { computeEffect, needsPartner } from '../effects'
import type { Jurisdiction, ReturnLine } from '../packet-types'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

export type PaymentStatus = 'matched' | 'agency_only' | 'return_only' | 'other_year'

export interface PaymentRow {
  date: string | null
  amount: number
  status: PaymentStatus
  /** Agency ledger entry (agency:/...) when there is one. */
  ref: string | null
  note?: string
}

/** The firm's own record of an extension payment: what_if.extension and the timeline event that filed it. */
export interface FirmRecord {
  amount: number
  ref: string
  knownSince: string
}

export interface PaymentTieOut {
  line: string
  label: string
  jurisdiction: Jurisdiction
  onReturn: number
  agency: number
  /** onReturn - agency */
  diff: number
  ledger: string
  payments: PaymentRow[]
  evidence: string[]
  /** When the row can show: the earlier of the agency side and the firm's record. */
  knownSince: string
  /** When the agency side (ledger, payments, diff) is in the file; grey it before then. */
  agencyKnownSince: string
  /** Extension lines only: the firm's record, which is in the file before a transcript shows the payment. */
  firmRecord?: FirmRecord
}

interface LedgerEntry { date: string; amount: number; ref: string; note?: string }
interface Ledger { name: string; entries: LedgerEntry[]; other: LedgerEntry[]; asOf: string }

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const sameEntries = (a: LedgerEntry[], b: LedgerEntry[]) =>
  a.length === b.length && a.every((x, i) => x.date === b[i].date && x.amount === b[i].amount)

/** IRS 670 payments matching `pick`, read from the earliest transcript snapshot that already shows the latest picture. */
function irsLedger(ctx: CheckContext, pick: (description: string) => boolean): Ledger | null {
  const snaps = ctx.packet.tax_agency_records.irs_account_transcript_2025
    .map((s, i) => ({
      asOf: s.as_of,
      entries: s.transactions.flatMap((t, j) =>
        t.code === '670' && typeof t.amount === 'number' && pick(t.description)
          ? [{ date: t.date, amount: t.amount, ref: `agency:/irs_account_transcript_2025/${i}/transactions/${j}` }]
          : [],
      ),
    }))
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
  if (!snaps.length) return null
  const latest = snaps[snaps.length - 1]
  const first = snaps.find((s) => sameEntries(s.entries, latest.entries)) ?? latest
  return { name: `IRS account transcript as of ${first.asOf}`, entries: first.entries, other: [], asOf: first.asOf }
}

const ftbRows = (key: string, list: { date: string; amount: number; note?: string }[] | undefined): LedgerEntry[] =>
  (list ?? []).map((p, j) => ({ date: p.date, amount: p.amount, ref: `agency:/ftb_account/${key}/${j}`, note: p.note }))

/** FTB payments designated to the tax year for which `inRange(date)` holds; payments held for 2024 are `other`. */
function ftbLedger(ctx: CheckContext, inRange: (date: string) => boolean): Ledger {
  const ftb = ctx.packet.tax_agency_records.ftb_account
  return {
    name: `FTB account as of ${ftb.as_of}`,
    entries: ftbRows('tax_year_2025_payments', ftb.tax_year_2025_payments).filter((e) => inRange(e.date)),
    other: ftbRows('tax_year_2024_payments_after_filing', ftb.tax_year_2024_payments_after_filing),
    asOf: ftb.as_of,
  }
}

/** The amount the extension worksheet says was paid (paid_with_form_4868 / paid_with_ftb_3519) and the filing event. */
function extensionRecord(ctx: CheckContext, side: 'federal' | 'california'): FirmRecord | undefined {
  const paid = Object.entries(ctx.packet.what_if.extension[side]).flatMap(([k, v]) => (k.startsWith('paid_with_') && typeof v === 'number' ? [v] : []))
  const event = ctx.packet.timeline.find((t) => t.event === 'extension_filed_with_payment')
  return paid.length && event ? { amount: paid[0], ref: `timeline:${event.id}`, knownSince: event.at } : undefined
}

/** The payments the return claims: the line note lists them ("2025-04-15 3,000.00; ..."); otherwise one lump. */
function returnPayments(line: ReturnLine): { date: string | null; amount: number }[] {
  const value = Number(line.value)
  const listed = [...(line.note ?? '').matchAll(/(\d{4}-\d{2}-\d{2}) ([\d,]+(?:\.\d+)?)/g)].map((m) => ({ date: m[1], amount: Number(m[2].replace(/,/g, '')) }))
  const total = listed.reduce((s, p) => s + p.amount, 0)
  if (listed.length && Math.abs(total - value) < 0.5) return listed
  return value ? [{ date: null, amount: value }] : []
}

const ledgerRoot = (l: Ledger) => l.entries[0]?.ref.replace(/\/\d+$/, '') ?? ''

function tieOut(ctx: CheckContext, key: string, ledger: Ledger | null, firmRecord?: FirmRecord): PaymentTieOut | null {
  const line = ctx.lines[key]
  if (!line || !ledger || typeof line.value !== 'number') return null
  const open = [...ledger.entries]
  const payments: PaymentRow[] = []
  for (const p of returnPayments(line)) {
    const i = open.findIndex((e) => e.amount === p.amount && (p.date === null || e.date === p.date))
    if (i >= 0) {
      payments.push({ ...p, status: 'matched', ref: open[i].ref })
      open.splice(i, 1)
      continue
    }
    const o = ledger.other.find((e) => e.date === p.date && e.amount === p.amount)
    payments.push(o ? { ...p, status: 'other_year', ref: o.ref, note: o.note } : { ...p, status: 'return_only', ref: null })
  }
  for (const e of open) payments.push({ date: e.date, amount: e.amount, status: 'agency_only', ref: e.ref })
  payments.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  const agency = ledger.entries.reduce((s, e) => s + e.amount, 0)
  const year = String(ctx.packet.household.tax_year)
  // Cited confirmations designated to another tax year (e.g. a `pay5_year` field reading 2024), with their siblings.
  const otherYearEvs = line.sources.flatMap((s) => {
    const e = ctx.ev[s]
    const m = e && /^(.*)_year$/.exec(e.field)
    if (!m || String(e.value) === year) return []
    return line.sources.filter((x) => ctx.ev[x]?.field.startsWith(`${m[1]}_`))
  })
  const evidence = [
    ...new Set([
      ...payments.filter((p) => p.status !== 'matched' && p.ref).map((p) => p.ref as string),
      ...(payments.some((p) => p.status === 'matched') ? [ledgerRoot(ledger)] : []),
      ...otherYearEvs,
      ...line.sources.filter((s) => /^(qa|msg|call)-/.test(s)),
    ]),
  ]
  // An empty ledger slice is still a fact as of the ledger date.
  const agencyKnownSince = [latestKnown(ctx, [...evidence, ...ledger.entries.map((e) => e.ref)]), ledger.asOf].sort()[1]
  return {
    line: key, label: line.label, jurisdiction: line.jurisdiction, onReturn: line.value, agency,
    diff: Math.round((line.value - agency) * 100) / 100, ledger: ledger.name, payments, evidence,
    knownSince: firmRecord && firmRecord.knownSince < agencyKnownSince ? firmRecord.knownSince : agencyKnownSince,
    agencyKnownSince,
    firmRecord,
  }
}

// Form lines are standard positions on the 2025 forms, not packet ids.
const LINES = {
  fedEstimates: 'F1040.26',
  fedExtension: 'Sch3.10',
  caEstimates: 'F540NR.72',
  caExtension: 'F540NR.73',
}

/** Rows for the Payments vs agency record view (one per payment line on the return). */
export function paymentTieOuts(ctx: CheckContext): PaymentTieOut[] {
  // Q4 estimates are due in January; anything later for the year is an extension payment.
  const cutoff = `${ctx.packet.household.tax_year + 1}-01-31`
  const isExtension = (d: string) => /4868|extension/i.test(d)
  return [
    tieOut(ctx, LINES.fedEstimates, irsLedger(ctx, (d) => !isExtension(d))),
    tieOut(ctx, LINES.fedExtension, irsLedger(ctx, isExtension), extensionRecord(ctx, 'federal')),
    tieOut(ctx, LINES.caEstimates, ftbLedger(ctx, (d) => d <= cutoff)),
    tieOut(ctx, LINES.caExtension, ftbLedger(ctx, (d) => d > cutoff), extensionRecord(ctx, 'california')),
  ].filter((r): r is PaymentTieOut => r !== null)
}

function explain(t: PaymentTieOut): string {
  const parts = t.payments.flatMap((p) => {
    const when = p.date ?? 'undated'
    if (p.status === 'return_only') return [`the return's ${when} ${fmt(p.amount)} matches no agency payment`]
    if (p.status === 'agency_only') return [`the agency shows ${when} ${fmt(p.amount)}, which the return does not list`]
    if (p.status === 'other_year') return [`${when} ${fmt(p.amount)} is held by the agency for another tax year${p.note ? ` ("${p.note}")` : ''}`]
    return []
  })
  return `${t.ledger}: ${parts.join('; ')}.`
}

const chk19: Check = {
  id: 'CHK-19',
  name: 'Estimated and extension payments vs agency records',
  family: 'agency_tieout',
  run(ctx) {
    const out: Finding[] = []
    for (const t of paymentTieOuts(ctx)) {
      if (Math.abs(t.diff) < 0.5) continue
      const line = ctx.lines[t.line]
      const e = computeEffect(ctx.packet, line, 'value', t.onReturn, t.agency)
      const stake = { fed: e.fed, ca: e.ca }
      const comms = line.sources.filter((s) => /^(qa|msg|call)-/.test(s))
      out.push({
        id: `chk:CHK-19:${t.line}`,
        check: 'CHK-19',
        family: 'agency_tieout',
        title: `${t.label}: ${fmt(t.onReturn)} on the return, ${fmt(t.agency)} on the ${t.jurisdiction === 'federal' ? 'IRS transcript' : 'FTB account'}`,
        why: explain(t) + (comms.length ? ` The line cites the client's answer ${comms.join(', ')}, which cannot stand in for the agency record.` : ''),
        severity: needsPartner(stake) ? 'high' : 'warning',
        signal: 'computed',
        claims: [t.line, ...comms],
        evidence: t.evidence,
        expected: t.agency,
        actual: t.onReturn,
        stake,
        knownSince: t.agencyKnownSince,
        fix: { act: 'adjust', target: t.line, field: 'value', to: t.agency, label: `Set to the agency total ${fmt(t.agency)}` },
      })
    }
    return out
  },
}

export const checks: Check[] = [chk19]
