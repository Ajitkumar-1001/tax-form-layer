// Records that reconcile a source document (or the prior preparer) to our lines: books to tax, K-1s, prior preparer.
import type { Model } from '@/lib/model/build'
import type { State } from '@/lib/model/state'
import { type Builder, type Column, type Group, type Row, diff, effective, formGroups, link, links, money, num, openCount, round2, text } from './table'

const isSubtotal = (field: string) => /^(total_|net_)/.test(field)

/** D14 P&L → Schedule C: one row per Sch C line fed by the books (pooled items summed), then book items that land nowhere. */
export const booksToTax: Builder = (model, state) => {
  const evs = (model.evByDoc.D14 ?? []).filter((e) => typeof e.value === 'number')
  const byLine = new Map<string, string[]>()
  for (const e of evs) for (const k of model.citedBy[e.id] ?? []) if (model.claims[k]?.form === 'SchC') byLine.set(k, [...(byLine.get(k) ?? []), e.id])
  const cited = new Set([...byLine.values()].flat())
  const lineRows = [...byLine.entries()].map(([key, ids]): Row => {
    const book = round2(ids.reduce((s, id) => s + (num(model.ev[id].value) ?? 0), 0))
    const tax = num(effective(model, state, key))
    const d = diff(tax, book)
    const decided = Boolean(state.claims[key]?.decision || state.claims[key]?.adjust)
    return {
      key,
      exception: Boolean(d) || openCount(state, key) > 0,
      cells: [links(ids, ids.map((id) => model.ev[id].field).join(' + ')), money(book), link(key, `${key} ${model.claims[key].label}`), money(tax), money(d, d && !decided ? 'bad' : undefined), text(decided ? 'explained' : d ? 'needs adjust or decide' : null, decided ? 'good' : 'warn')],
    }
  })
  const orphanRows = evs.filter((e) => !cited.has(e.id)).map((e): Row => ({
    key: e.id,
    exception: !isSubtotal(e.field),
    cells: [link(e.id, e.field), money(num(e.value)), text(isSubtotal(e.field) ? 'subtotal' : 'not on Schedule C', 'muted'), money(null), money(isSubtotal(e.field) ? null : -(num(e.value) ?? 0), 'warn'), text(isSubtotal(e.field) ? null : 'where did it go?', 'warn')],
  }))
  const taxOnly = model.claimList
    .filter((c) => c.form === 'SchC' && typeof c.value === 'number' && !byLine.has(c.id) && c.sources.length > 0)
    .map((c): Row => ({
      key: c.id,
      exception: true,
      cells: [text('not in the books', 'muted'), money(null), link(c.id, `${c.id} ${c.label}`), money(num(effective(model, state, c.id))), money(num(effective(model, state, c.id))), text('tax-only item', 'muted')],
    }))
  const net = model.claims['SchC.31']
  const bookNet = evs.find((e) => e.field === 'net_income')
  return {
    columns: [{ label: 'P&L item (D14)' }, { label: 'Books', money: true }, { label: 'Schedule C line' }, { label: 'Return', money: true }, { label: 'Difference', money: true }, { label: 'Explained' }],
    groups: [
      { key: 'lines', title: 'Books → Schedule C', ref: 'D14', rows: lineRows },
      { key: 'orphans', title: 'Book items not on Schedule C', rows: orphanRows },
      { key: 'tax-only', title: 'Schedule C items not in the books', rows: taxOnly },
    ],
    notes: [{
      text: `Book net income ${num(bookNet?.value)?.toLocaleString('en-US') ?? '—'} vs Schedule C net profit ${num(net?.value)?.toLocaleString('en-US') ?? '—'}. Each difference needs an adjust or a decision; an unexplained gross-receipts difference is a CHK-07 finding.`,
      tone: 'muted',
      refs: [...(bookNet ? [bookNet.id] : []), 'SchC.31', ...model.findings.filter((f) => f.check === 'CHK-07').map((f) => f.id)],
    }],
  }
}

const K1_DOCS = ['D37', 'D39', 'D40']

export const k1: Builder = (model, state) => {
  const evCols: Column[] = [{ label: 'Box' }, { label: 'K-1 amount', money: true }, { label: 'Lands on' }, { label: 'Line value', money: true }, { label: 'Difference', money: true }]
  const docGroups = K1_DOCS.filter((d) => model.docs[d]).map((d): Group => ({
    key: d,
    title: model.docs[d].title,
    ref: d,
    columns: evCols,
    rows: (model.evByDoc[d] ?? []).map((e): Row => {
      const lines = model.citedBy[e.id] ?? []
      const one = lines.length === 1 ? num(effective(model, state, lines[0])) : null
      const d1 = lines.length === 1 ? diff(one, e.value) : null
      return {
        key: e.id,
        exception: lines.length === 0 || Boolean(d1) || lines.some((k) => openCount(state, k) > 0),
        cells: [link(e.id, `${e.field} · ${e.label}`), typeof e.value === 'number' ? money(e.value) : text(e.value), lines.length ? links(lines) : text('not on the return', 'warn'), money(one), money(d1, d1 ? 'warn' : undefined)],
      }
    }),
  }))
  const lineGroups = formGroups(model, state, ['F7203']).concat({
    key: 'SchE-II',
    title: 'Schedule E part II',
    rows: formGroups(model, state, ['SchE'])[0].rows.filter((r) => /^SchE\.(28|32|41)/.test(r.key)),
  })
  return {
    columns: [{ label: 'Line' }, { label: 'Description' }, { label: 'v3', money: true }, { label: 'Effective', money: true }, { label: 'Open' }, { label: 'Flags' }],
    groups: [...docGroups, ...lineGroups],
    notes: [{ text: 'D40 is the 2023 K-1 that fills the missing year of the S corporation basis chain.', tone: 'muted', refs: ['D40', 'py:/basis_records/scorp_lindqvist_family_woodworks'] }],
    allByDefault: true,
  }
}

const KEY_PY = ['F1040.1a', 'F1040.2b', 'F1040.3b', 'F1040.7', 'F1040.8', 'F1040.9', 'F1040.10', 'F1040.11', 'F1040.12', 'F1040.15', 'F1040.16', 'F1040.24', 'F1040.26', 'F1040.33']

function adjustRows(model: Model, state: State, nameOf: (id: string) => string): Row[] {
  return [...state.adjusts].reverse().map((a): Row => ({
    key: `act:${a.seq}`,
    exception: !a.reverted,
    cells: [
      link(`act:${a.seq}`, `#${a.seq}`),
      text(nameOf(a.actor)),
      link(a.target, `${a.target} ${model.claims[a.target]?.label ?? ''}`.trim()),
      text(`${a.from ?? '—'} → ${a.to ?? '—'}${a.field !== 'value' ? ` (${a.field})` : ''}`),
      text(a.reason),
      text(`fed ${a.effect.fed.toLocaleString('en-US')} · CA ${a.effect.ca.toLocaleString('en-US')}${a.reverted ? ' · reverted' : ''}`, a.reverted ? 'muted' : undefined),
    ],
  }))
}

export const priorPreparer: Builder = (model, state) => {
  const ppw = model.packet.prior_years.prior_preparer_workpaper
  const people = new Map([...model.packet.firm.staff, ...model.packet.firm.client_users].map((p) => [p.id, p.name]))
  const nameOf = (id: string) => people.get(id) ?? id
  const items = model.claimList.filter((c) => c.kind === 'prior_item')
  const itemRows = items.map((c): Row => {
    const s = state.claims[c.id]
    const done = s?.disposition ? `${s.disposition.disposition.replaceAll('_', ' ')}: ${s.disposition.reason} (${nameOf(s.disposition.actor)})` : s?.decision ? `decided: ${s.decision.choice}` : null
    return {
      key: c.id,
      exception: !done,
      cells: [link(c.id, c.id.includes('/open_items') ? 'open item' : 'note'), text(c.label), text(done ?? 'no disposition', done ? 'good' : 'bad')],
    }
  })
  const pyRows = KEY_PY.filter((k) => model.claims[k]).map((k): Row => {
    const py = model.claims[k].versions?.py ?? null
    const eff = effective(model, state, k)
    return { key: k, exception: Boolean(state.claims[k]?.adjust), cells: [link(k), text(model.claims[k].label), money(py), money(eff), money(diff(eff, py))] }
  })
  return {
    columns: [{ label: 'Item' }, { label: 'Prior preparer wrote' }, { label: 'Our disposition' }],
    groups: [
      { key: 'items', title: 'D07 notes and open items', ref: 'D07', rows: itemRows },
      { key: 'lines', title: '2024 (prior preparer) vs 2025 (ours)', columns: [{ label: 'Line' }, { label: 'Description' }, { label: '2024', money: true }, { label: '2025 effective', money: true }, { label: 'Δ', money: true }], rows: pyRows },
      { key: 'adjusts', title: `Our adjustments (${state.adjusts.length})`, columns: [{ label: 'Act' }, { label: 'By' }, { label: 'Target' }, { label: 'Change' }, { label: 'Reason' }, { label: 'Effect' }], rows: adjustRows(model, state, nameOf) },
    ],
    notes: [{ text: `Prior preparer summary: ${ppw.summary_memo}`, tone: 'muted', refs: ['D07', 'py:/prior_preparer_workpaper/summary_memo'] }],
    allByDefault: true,
  }
}
