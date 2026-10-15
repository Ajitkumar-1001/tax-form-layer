// Specialised records that tie the return to outside evidence: sales (broker 1099-B → lots) and payments (agency ledgers).
import type { Model } from '@/lib/model/build'
import { paymentTieOuts, type PaymentStatus } from '@/lib/model/checks/agency'
import { brokerTieOuts, type BrokerTieOut } from '@/lib/model/checks/sum-vs-detail'
import type { State } from '@/lib/model/state'
import { type Banner, type Builder, effective, type Group, type Row, lineRow, link, links, money, num, openCount, text } from './table'

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export interface Lot {
  key: string
  box: string
  doc: string | null
  sold: string | null
  basisRead: boolean
  basisZero: boolean
  wash: boolean
  caPeriod: boolean
  reasons: string[]
}

/** The California residency end date (last day as a resident), from household.residency. */
export function moveDate(model: Model): string | null {
  return model.packet.household.residency.find((r) => r.state === 'CA')?.to ?? null
}

/** Parse every Form 8949 lot: broker document, box, sale date and the exception reasons. The sale date only sets the
 * Period column: California sourcing is checked as a finding (CHK-45), so it is not a per-lot exception. */
export function lotsOf(model: Model, state: State): Lot[] {
  const brokers = new Set(brokerTieOuts(model).map((t) => t.doc))
  const move = moveDate(model)
  return model.claimList
    .filter((c) => c.form === 'F8949' && !c.id.endsWith('.total'))
    .map((c) => {
      const docs = [...new Set(c.sources.flatMap((s) => (model.ev[s] ? [model.ev[s].document_id] : [])))]
      const doc = docs.find((d) => brokers.has(d)) ?? docs[0] ?? null
      const sold = /sold (\d{4}-\d{2}-\d{2})/.exec(c.label)?.[1] ?? null
      const basisRead = c.sources.some((s) => model.ev[s] && /_basis$/.test(model.ev[s].field) && model.ev[s].value !== null)
      const basisZero = /basis 0\.00\b/.test(c.label)
      const wash = /adjustment W\b/.test(c.label)
      const caPeriod = Boolean(sold && move && sold <= move)
      const reasons = [
        ...(docs.length && !basisRead ? ['no basis read'] : []),
        ...(basisZero ? ['basis 0'] : []),
        ...(wash ? ['wash sale'] : []),
        ...(openCount(state, c.id) ? [`${openCount(state, c.id)} finding${openCount(state, c.id) === 1 ? '' : 's'}`] : []),
      ]
      return { key: c.id, box: c.id.split('.')[1], doc, sold, basisRead, basisZero, wash, caPeriod, reasons }
    })
}

/** Group header for a broker: its CHK-04 tie-out (summary vs extracted lots), red when there is a gap. */
export function tieOutBanner(t: BrokerTieOut): Banner {
  const pages = [...new Set(t.unread.map((l) => `doc:${t.doc}#page${l.page}`))]
  const summary = t.summary === null ? 'no printed summary' : `summary proceeds ${fmt(t.summary)}`
  const unread = t.unread.length ? ` · ${t.unread.length} printed lot${t.unread.length === 1 ? '' : 's'} never read (${t.unread.map((l) => `${l.lot} p.${l.page}`).join(', ')})` : ''
  return {
    text: `${summary} · ${t.extracted.count} extracted lots ${fmt(t.extracted.proceeds)}${t.gap !== null ? ` · gap ${fmt(t.gap)}` : ''}${unread}${t.superseded ? ' · superseded, not used' : ''}`,
    tone: t.superseded ? 'muted' : t.status === 'gap' ? 'bad' : t.status === 'tied' ? 'good' : 'muted',
    refs: [...(t.summaryRef ? [t.summaryRef] : []), ...pages, ...(t.status === 'gap' && !t.superseded ? [`chk:CHK-04:${t.doc}`] : [])],
  }
}

export const sales: Builder = (model, state) => {
  const lots = lotsOf(model, state)
  const tieOuts = brokerTieOuts(model)
  const lotRow = (l: Lot): Row => {
    const c = model.claims[l.key]
    return {
      key: l.key,
      exception: l.reasons.length > 0,
      cells: [
        text(l.box),
        link(l.key, l.key.split('.').slice(2).join('.')),
        text(c.label),
        text(l.sold),
        text(l.caPeriod ? 'CA resident' : l.sold ? 'after move' : null, 'muted'),
        money(num(state.claims[l.key]?.effective ?? c.value)),
        text(l.reasons.join(', ') || null, l.reasons.length ? 'warn' : undefined),
      ],
    }
  }
  const byBox = (a: Lot, b: Lot) => a.box.localeCompare(b.box) || a.key.localeCompare(b.key, 'en', { numeric: true })
  const groups: Group[] = tieOuts.map((t) => ({
    key: t.doc,
    title: `${t.issuer} · ${t.documentType}`,
    ref: t.doc,
    banner: tieOutBanner(t),
    rows: lots.filter((l) => l.doc === t.doc).sort(byBox).map(lotRow),
  }))
  const known = new Set(tieOuts.map((t) => t.doc))
  const others = lots.filter((l) => !l.doc || !known.has(l.doc)).sort(byBox)
  if (others.length) groups.push({ key: 'other', title: 'Lots with no broker statement', rows: others.map(lotRow) })
  const totals = model.claimList.filter((c) => c.form === 'F8949' && c.id.endsWith('.total')).map((c) => lineRow(model, state, c.id))
  groups.push({ key: 'totals', title: 'Box totals (all brokers)', rows: totals.map((r) => ({ ...r, exception: true, cells: [text(r.key.split('.')[1]), r.cells[0], r.cells[1], text(null), text(null), r.cells[3], findingsText(state, r.key)] })) })
  const move = moveDate(model)
  return {
    columns: [{ label: 'Box' }, { label: 'Lot' }, { label: 'Description' }, { label: 'Sold' }, { label: 'Period' }, { label: 'Gain', money: true }, { label: 'Exceptions' }],
    groups,
    notes: [{ text: `California resident through ${move ?? '?'}; lots sold on or before that date are California-source.`, tone: 'muted', refs: ['household#residency'] }],
  }
}

const findingsText = (state: State, key: string) => {
  const n = openCount(state, key)
  return text(n ? `${n} finding${n === 1 ? '' : 's'}` : null, 'warn')
}

const STATUS_TEXT: Record<PaymentStatus, string> = {
  matched: 'matched',
  agency_only: 'on agency record only',
  return_only: 'on return only',
  other_year: 'held for another year',
}

export const payments: Builder = (model, state) => {
  const groups: Group[] = paymentTieOuts(model).map((t) => {
    // Before the agency record is in the file, show only our side: no agency amount, match status or finding.
    const notYet = t.agencyKnownSince > state.clock
    const firm = t.firmRecord ? ` · firm record (extension worksheet) ${fmt(t.firmRecord.amount)}` : ''
    const agency = notYet ? ' · agency record not yet in file at the season clock' : ` · ${t.ledger} ${fmt(t.agency)} · difference ${fmt(t.diff)}`
    const gap = !notYet && Math.abs(t.diff) >= 0.5
    return {
      key: t.line,
      title: `${t.label} (${t.jurisdiction === 'federal' ? 'IRS' : 'FTB'})`,
      ref: t.line,
      banner: {
        text: `On the return ${fmt(t.onReturn)}${agency}${firm}`,
        tone: notYet ? 'muted' : gap ? 'bad' : 'good',
        refs: [...(gap ? [`chk:CHK-19:${t.line}`] : []), ...(t.firmRecord ? [t.firmRecord.ref] : []), ...(notYet ? [] : t.evidence)],
      },
      rows: t.payments.filter((p) => !notYet || p.status !== 'agency_only').map((p, i): Row => ({
        key: `${t.line}:${i}`,
        exception: !notYet && p.status !== 'matched',
        cells: [
          text(p.date ?? 'undated'),
          money(p.amount),
          notYet ? text('agency record not yet in file', 'muted') : text(STATUS_TEXT[p.status], p.status === 'matched' ? 'good' : 'bad'),
          p.ref && !notYet ? link(p.ref) : text(null),
          text(notYet ? null : (p.note ?? null), 'muted'),
        ],
      })),
    }
  })
  // Withholding is agreed to the W-2s (the transcript shows no withholding until the return posts).
  for (const key of ['F1040.25a', 'F540NR.71']) {
    const c = model.claims[key]
    if (!c) continue
    const evs = c.sources.filter((s) => model.ev[s])
    const total = evs.reduce((s, id) => s + (num(model.ev[id].value) ?? 0), 0)
    const onReturn = num(effective(model, state, key))
    const gap = onReturn === null ? 0 : Math.round((onReturn - total) * 100) / 100
    groups.push({
      key,
      title: `${c.label} (withholding, agreed to W-2s)`,
      ref: key,
      columns: [{ label: 'Payer' }, { label: 'Amount', money: true }, { label: 'Box' }, { label: 'Read' }, { label: 'Document' }],
      banner: { text: `On the return ${fmt(onReturn ?? 0)} · W-2 reads ${fmt(total)} · difference ${fmt(gap)}`, tone: Math.abs(gap) >= 0.5 ? 'bad' : 'good', refs: [] },
      rows: evs.map((id): Row => ({
        key: `${key}:${id}`,
        exception: openCount(state, key) > 0 || Math.abs(gap) >= 0.5,
        cells: [text(model.docs[model.ev[id].document_id]?.issuer ?? model.ev[id].document_id), money(num(model.ev[id].value)), text(model.ev[id].label), link(id), links([model.ev[id].document_id])],
      })),
    })
  }
  return { columns: [{ label: 'Date' }, { label: 'Amount', money: true }, { label: 'Status' }, { label: 'Record' }, { label: 'Note' }], groups, notes: [] }
}
