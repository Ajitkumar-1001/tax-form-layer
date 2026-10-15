// Broker 1099-B / 1099-DA: the printed summary proceeds must equal the lots that were extracted.
import { computeEffect } from '../effects'
import type { ReturnLine } from '../packet-types'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const BROKER_TYPES = /^1099-(composite|B|DA)$/
const MONEY = String.raw`\$?(\d[\d,]*\.\d{2})`
const SUMMARY_SENTENCE = /\bsummary:\s*([^]*?)\.(?:\s|$)/i
const TOTAL_PROCEEDS = new RegExp(String.raw`(?<!detail )\btotal (?:gross )?proceeds\s+${MONEY}`, 'i')
const PROCEEDS = new RegExp(String.raw`\bproceeds\s+${MONEY}`, 'gi')
const LOT_ROW = new RegExp(String.raw`\b([A-Z]{1,3}\d{1,4})\s(.*?)\bproceeds\s+${MONEY}(.*)`)
const LOT_FIELD = /^([A-Z]{1,3}\d{1,4})_proceeds$/

const money = (s: string) => Number(s.replace(/,/g, ''))
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface PrintedLot {
  lot: string
  page: number
  proceeds: number
  basis: number | null
  sold: string | null
  term: 'short' | 'long' | null
  covered: boolean | null
}

export interface BrokerTieOut {
  doc: string
  issuer: string
  documentType: string
  superseded: boolean
  /** Printed summary proceeds (null when the document prints no summary). */
  summary: number | null
  summaryRef: string | null
  printed: { count: number; proceeds: number }
  extracted: { count: number; proceeds: number }
  /** summary − extracted lots. */
  gap: number | null
  /** Printed lot rows with no extracted proceeds. */
  unread: PrintedLot[]
  status: 'tied' | 'gap' | 'no_summary'
}

function printedSummary(pages: { page: number; printed_content: string }[]): { amount: number; page: number } | null {
  for (const p of pages) {
    const s = SUMMARY_SENTENCE.exec(p.printed_content)
    const amounts = s ? [...s[1].matchAll(PROCEEDS)].map((m) => money(m[1])) : []
    if (amounts.length) return { amount: amounts.reduce((a, b) => a + b, 0), page: p.page }
  }
  for (const p of pages) {
    const t = TOTAL_PROCEEDS.exec(p.printed_content)
    if (t) return { amount: money(t[1]), page: p.page }
  }
  return null
}

function printedLots(pages: { page: number; printed_content: string }[]): PrintedLot[] {
  const out: PrintedLot[] = []
  for (const p of pages) {
    for (const row of p.printed_content.replace(SUMMARY_SENTENCE, '').split(';')) {
      const m = LOT_ROW.exec(row)
      if (!m) continue
      const rest = m[4]
      const basis = new RegExp(String.raw`\bbasis\s+${MONEY}`).exec(rest)
      const term = /\b(short|long)-term\b/.exec(row)
      out.push({
        lot: m[1],
        page: p.page,
        proceeds: money(m[3]),
        basis: basis ? money(basis[1]) : null,
        sold: /\bsold\s+(\d{4}-\d{2}-\d{2})/.exec(row)?.[1] ?? null,
        term: term ? (term[1] as 'short' | 'long') : null,
        covered: /\bnoncovered\b/.test(row) ? false : /\bcovered\b/.test(row) ? true : null,
      })
    }
  }
  return out
}

/** Every broker document's summary-to-lots tie-out, passing ones included (Records UI). */
export function brokerTieOuts(ctx: CheckContext): BrokerTieOut[] {
  const latest = ctx.packet.return_versions[ctx.packet.return_versions.length - 1]
  return ctx.packet.documents
    .filter((d) => BROKER_TYPES.test(d.document_type))
    .map((d) => {
      const lots = new Map<string, number>()
      for (const e of ctx.evByDoc[d.id] ?? []) {
        const m = LOT_FIELD.exec(e.field)
        if (m && typeof e.value === 'number') lots.set(m[1], e.value)
      }
      const extracted = [...lots.values()].reduce((a, b) => a + b, 0)
      const printed = printedLots(d.pages)
      const summary = printedSummary(d.pages)
      const gap = summary ? Math.round((summary.amount - extracted) * 100) / 100 : null
      return {
        doc: d.id,
        issuer: d.issuer,
        documentType: d.document_type,
        superseded: latest.documents_superseded.includes(d.id),
        summary: summary?.amount ?? null,
        summaryRef: summary ? `doc:${d.id}#page${summary.page}` : null,
        printed: { count: printed.length, proceeds: Math.round(printed.reduce((a, l) => a + l.proceeds, 0) * 100) / 100 },
        extracted: { count: lots.size, proceeds: Math.round(extracted * 100) / 100 },
        gap,
        unread: printed.filter((l) => !lots.has(l.lot)),
        status: gap === null ? 'no_summary' : Math.abs(gap) < 0.01 ? 'tied' : 'gap',
      }
    })
}

/** Tax effect of adding the unread lots: a stand-in Form 8949 row per lot (box picks the term; sale date picks the CA leg). */
function unreadStake(ctx: CheckContext, lots: PrintedLot[]): { fed: number; ca: number } | undefined {
  let fed = 0
  let ca = 0
  for (const l of lots) {
    if (l.basis === null || l.term === null) continue
    const box = l.term === 'short' ? (l.covered === false ? 'B' : 'A') : l.covered === false ? 'E' : 'D'
    const row: ReturnLine = {
      key: `F8949.${box}.${l.lot}`, jurisdiction: 'federal', form: 'F8949', line: `${box}.${l.lot}`,
      label: `${l.lot}${l.sold ? ` sold ${l.sold}` : ''}`, value: 0, rule: '', inputs: [], sources: [],
    }
    const e = computeEffect(ctx.packet, row, 'value', 0, l.proceeds - l.basis)
    fed += e.fed
    ca += e.ca
  }
  return fed || ca ? { fed, ca } : undefined
}

const chk04: Check = {
  id: 'CHK-04',
  name: 'Broker summary proceeds equal the extracted lot detail',
  family: 'sum_vs_detail',
  run(ctx) {
    const latest = ctx.packet.return_versions[ctx.packet.return_versions.length - 1]
    const out: Finding[] = []
    for (const t of brokerTieOuts(ctx)) {
      const summary = t.summary
      if (t.status !== 'gap' || t.superseded || summary === null || t.gap === null) continue
      const docEvs = new Set((ctx.evByDoc[t.doc] ?? []).map((e) => e.id))
      const diags = latest.diagnostics.filter((d) => d.refs.some((r) => docEvs.has(r))).map((d) => `diag:${d.code}`)
      const pages = [...new Set(t.unread.map((l) => `doc:${t.doc}#page${l.page}`))]
      const summaryEv = (ctx.evByDoc[t.doc] ?? []).find((e) => typeof e.value === 'number' && /summary/i.test(e.field) && Math.abs(e.value - summary) < 0.01)
      const evidence = [summaryEv?.id ?? t.summaryRef ?? t.doc, ...pages]
      const unreadText = t.unread.length
        ? ` Printed lots never extracted: ${t.unread.map((l) => `${l.lot} on page ${l.page} (proceeds ${fmt(l.proceeds)}${l.basis !== null ? `, basis ${fmt(l.basis)}` : ''})`).join('; ')}.`
        : ' Every printed lot row was extracted, so the difference is inside the extracted amounts.'
      out.push({
        id: `chk:CHK-04:${t.doc}`,
        check: 'CHK-04',
        family: 'sum_vs_detail',
        title: `${t.issuer} summary proceeds ${fmt(summary)} vs extracted lots ${fmt(t.extracted.proceeds)} (gap ${fmt(t.gap)})`,
        why:
          `The broker's printed summary should equal the sum of the lots the return uses: ${t.extracted.count} extracted lots against ${t.printed.count} printed lot rows (${fmt(t.printed.proceeds)}).` +
          unreadText,
        severity: 'warning',
        signal: 'computed',
        claims: [t.doc, ...diags],
        evidence,
        expected: summary,
        actual: t.extracted.proceeds,
        stake: unreadStake(ctx, t.unread),
        knownSince: latestKnown(ctx, [t.doc]),
      })
    }
    return out
  },
}

export const checks: Check[] = [chk04]
