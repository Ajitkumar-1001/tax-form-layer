// Records over multi-year data: depreciation by asset, carryovers in → out, and basis chains.
import type { Model } from '@/lib/model/build'
import type { State } from '@/lib/model/state'
import { type Banner, type Builder, type Column, type Group, type Row, diff, link, links, money, num, openCount, round2, text } from './table'

const v3Of = (model: Model) => model.packet.return_versions[model.packet.return_versions.length - 1]
const sumYears = (r: Record<string, number> | undefined) => round2(Object.values(r ?? {}).reduce((s, n) => s + (num(n) ?? 0), 0))

export const depreciation: Builder = (model, state) => {
  const v3 = v3Of(model)
  const caDiff = (v3.carryovers_out.california.depreciation_basis_differences ?? {}) as Record<string, number>
  const py = new Map(model.packet.prior_years.asset_records.map((a) => [a.asset_id, a]))
  const rows = v3.assets.map((a): Row => {
    const prior = py.get(a.asset_id)
    const pyFed = prior ? sumYears(prior.federal) : null
    const priorGap = pyFed === null ? null : round2(a.federal.prior_accumulated - pyFed)
    const caLine = `FTB3885A.${a.asset_id}`
    const reasons = [
      ...(a.disposed ? [`disposed ${a.disposed}`] : []),
      ...(a.federal.depreciation_2025 !== a.california.depreciation_2025 ? ['CA differs'] : []),
      ...(a.amt.difference_from_regular ? ['AMT difference'] : []),
      ...(priorGap ? [`prior accumulated differs from 2024 schedule by ${priorGap.toLocaleString('en-US')}`] : []),
      ...(openCount(state, caLine) ? ['open findings'] : []),
    ]
    const recapture = a.disposition ? `unrecaptured §1250 ${a.disposition.unrecaptured_1250_depreciation.toLocaleString('en-US')} · §1250 ordinary ${a.disposition.section_1250_ordinary_recapture.toLocaleString('en-US')}` : null
    return {
      key: a.asset_id,
      exception: reasons.length > 0,
      cells: [
        link(`asset:${a.asset_id}`, a.asset_id),
        text(a.description),
        text(a.placed_in_service),
        text(`${a.method} · ${a.life_years}y`),
        money(a.cost),
        money(a.federal.depreciation_2025),
        money(a.federal.accumulated_end),
        model.claims[caLine] ? { ...money(a.california.depreciation_2025), ref: caLine } : money(a.california.depreciation_2025),
        money(a.california.accumulated_end),
        money(a.amt.depreciation_2025),
        money(caDiff[a.asset_id] ?? null),
        text(recapture ?? (reasons.join(', ') || null), reasons.length ? 'warn' : undefined),
      ],
    }
  })
  const priorCols: Column[] = [{ label: 'Asset' }, { label: 'Federal by year' }, { label: 'California by year' }, { label: 'Federal total', money: true }, { label: 'v3 prior accumulated', money: true }, { label: 'Source' }]
  const priorRows = model.packet.prior_years.asset_records.map((a): Row => {
    const now = v3.assets.find((x) => x.asset_id === a.asset_id)
    const years = (r: Record<string, number>) => Object.entries(r).map(([y, n]) => `${y} ${n.toLocaleString('en-US')}`).join(' · ') || '—'
    const gap = now ? diff(now.federal.prior_accumulated, sumYears(a.federal)) : null
    return {
      key: `py:${a.asset_id}`,
      exception: Boolean(gap),
      cells: [link(`asset:${a.asset_id}`, a.asset_id), text(years(a.federal)), text(years(a.california)), money(sumYears(a.federal)), money(now?.federal.prior_accumulated ?? null, gap ? 'bad' : undefined), text(a.sources.join(', '), 'muted')],
    }
  })
  const f4797 = model.claimList.filter((c) => c.form === 'F4797').map((c): Row => ({
    key: c.id,
    exception: openCount(state, c.id) > 0,
    cells: [link(c.id), text(c.label), text(null), text(null), typeof c.value === 'number' ? money(state.claims[c.id]?.effective ?? c.value) : text(c.value ?? null), text(null)],
  }))
  return {
    columns: [{ label: 'Asset' }, { label: 'Description' }, { label: 'In service' }, { label: 'Method · life' }, { label: 'Cost', money: true }, { label: 'Fed 2025', money: true }, { label: 'Fed accum.', money: true }, { label: 'CA 2025', money: true }, { label: 'CA accum.', money: true }, { label: 'AMT 2025', money: true }, { label: 'CA basis diff.', money: true }, { label: 'Disposal / notes' }],
    groups: [
      { key: 'assets', title: `Assets on v3 (${v3.assets.length})`, rows },
      { key: 'prior', title: 'Prior years (py:/asset_records)', ref: 'py:/asset_records', columns: priorCols, rows: priorRows },
      { key: 'f4797', title: 'Disposals and recapture (Form 4797)', columns: [{ label: 'Line' }, { label: 'Description' }, { label: '' }, { label: '' }, { label: 'Value', money: true }, { label: '' }], rows: f4797 },
    ],
    notes: [],
  }
}

/** Forms whose lines feed each carryover, so an adjust there makes the carryover stale. */
const CARRY_FORMS: [RegExp, string[]][] = [
  [/capital_loss/, ['SchD', 'F8949']],
  [/passive/, ['F8582', 'SchE', 'F4797']],
  [/minimum_tax|amt/, ['F6251']],
  [/charitable/, ['SchA', 'F8283']],
  [/section_179/, ['F4562-C', 'F4562-E']],
  [/ira/, ['F8606']],
  [/scorp/, ['F7203']],
  [/ridgeline/, ['SchE']],
  [/sep/, ['Sch1']],
  [/depreciation/, ['FTB3885A', 'F4562-C', 'F4562-E']],
]
const ALIAS: Record<string, string> = { amt_credit: 'minimum_tax_credit_from_2025_amt' }
/** California carries one combined figure out for capital loss and for passive, so its 2024 parts fold into one row each. */
const CA_ALIAS: Record<string, string> = {
  ...ALIAS,
  capital_loss_short: 'capital_loss',
  capital_loss_long: 'capital_loss',
  passive_1450_fremont: 'passive',
  passive_1200_barton_hills: 'passive',
}

/** True when a live adjust (or a stale flag) sits on a line of a form feeding this carryover. */
export function carryStale(model: Model, state: State, key: string): boolean {
  const forms = CARRY_FORMS.find(([re]) => re.test(key))?.[1] ?? []
  if (!forms.length) return false
  const formOf = (id: string) => model.claims[id]?.form ?? ''
  return state.adjusts.some((a) => !a.reverted && forms.includes(formOf(a.target))) ||
    Object.values(state.claims).some((c) => c.flags.includes('stale') && forms.includes(formOf(c.id)))
}

function carryRows(model: Model, state: State, into: Record<string, unknown>, out: Record<string, unknown>, prefix: string, alias: Record<string, string>): Row[] {
  const inKeys = Object.keys(into).filter((k) => typeof into[k] === 'number')
  const outKeys = Object.keys(out).filter((k) => typeof out[k] === 'number')
  const keys = [...new Set([...inKeys.map((k) => alias[k] ?? k), ...outKeys])]
  const words = (k: string) => k.replaceAll('_', ' ')
  return keys.map((k): Row => {
    const ins = inKeys.filter((x) => (alias[x] ?? x) === k)
    const i = ins.length ? round2(ins.reduce((s, x) => s + (num(into[x]) ?? 0), 0)) : null
    const o = num(out[k])
    const stale = carryStale(model, state, k)
    // More can't be used than came in; a carryover that grew during 2025 shows 0 used, never a negative.
    const used = i === null ? null : round2(Math.max(0, i - (o ?? 0)))
    const refs = ins.map((x) => `py:/carryovers_into_2025/${prefix ? 'california/' : ''}${x}`)
    const note = ins.length > 1 ? `2024: ${ins.map((x) => `${words(x)} ${(num(into[x]) ?? 0).toLocaleString('en-US')}`).join(' + ')}`
      : i !== null && o !== null && o > i ? `${round2(o - i).toLocaleString('en-US')} arose in 2025`
        : i !== null && o === null ? 'not carried out' : o !== null && i === null ? 'new in 2025' : null
    return {
      key: `${prefix}${k}`,
      exception: stale || (i !== null && o === null) || Boolean(i && o === 0 && used),
      cells: [
        refs.length > 1 ? links(refs, words(k)) : refs.length ? link(refs[0], words(k)) : text(words(k)),
        money(i),
        money(used),
        money(o),
        text(note, 'muted'),
        text(stale ? 'stale: an input was adjusted' : null, 'warn'),
      ],
    }
  })
}

export const carryovers: Builder = (model, state) => {
  const v3 = v3Of(model)
  const into = model.packet.prior_years.carryovers_into_2025
  const caIn = (into.california ?? {}) as Record<string, unknown>
  const caOut = v3.carryovers_out.california
  const caDiffs = (caOut.depreciation_basis_differences ?? {}) as Record<string, number>
  const findings = model.findings.filter((f) => f.check === 'CHK-31').map((f) => f.id)
  return {
    columns: [{ label: 'Carryover' }, { label: 'In (2024)', money: true }, { label: 'Used', money: true }, { label: 'Out (v3)', money: true }, { label: 'Note' }, { label: 'Stale' }],
    groups: [
      { key: 'federal', title: 'Federal', rows: carryRows(model, state, into, v3.carryovers_out.federal, '', ALIAS) },
      { key: 'california', title: 'California', rows: carryRows(model, state, caIn, caOut, 'ca:', CA_ALIAS) },
      {
        key: 'ca-dep',
        title: 'California depreciation basis differences (out)',
        rows: Object.entries(caDiffs).map(([id, n]): Row => ({
          key: `ca-dep:${id}`,
          exception: carryStale(model, state, 'depreciation'),
          cells: [link(`asset:${id}`, id), text(null), text(null), money(n), text(null), text(carryStale(model, state, 'depreciation') ? 'stale: an input was adjusted' : null, 'warn')],
        })),
      },
    ],
    notes: [
      { text: `Carried in from ${String(into.sources ?? 'the 2024 return')}.`, tone: 'muted', refs: ['py:/carryovers_into_2025'] },
      ...(findings.length ? [{ text: 'Carryover findings', tone: 'warn' as const, refs: findings }] : []),
    ],
  }
}

const BASIS_OUT: Record<string, string> = {
  scorp_lindqvist_family_woodworks: 'scorp_stock_basis_end',
  partnership_ridgeline: 'ridgeline_capital_account_end',
  ira_nondeductible_basis_ngozi: 'ira_nondeductible_basis_ngozi',
}

/** A basis-record entry is weak when any amount is null or its source is a client worksheet or missing. */
export function basisFlags(entry: Record<string, unknown>): string[] {
  const nulls = Object.entries(entry).filter(([k, v]) => v === null && k !== 'source').map(([k]) => k.replaceAll('_', ' '))
  const src = String(entry.source ?? '')
  return [
    ...(nulls.length ? [`no ${nulls.join(', ')}`] : []),
    ...(/client worksheet/i.test(src) ? ['client worksheet only'] : []),
    ...(/missing|never computed/i.test(src) ? ['missing record'] : []),
  ]
}

export const basis: Builder = (model) => {
  const v3 = v3Of(model)
  const records = model.packet.prior_years.basis_records
  const findings = model.findings.filter((f) => f.check === 'CHK-30').map((f) => f.id)
  const groups: Group[] = Object.entries(records).map(([name, chain]) => {
    const rows = chain.map((e, i): Row => {
      const flags = basisFlags(e)
      const values = Object.entries(e).filter(([k]) => !['year', 'event', 'source'].includes(k)).map(([k, v]) => `${k.replaceAll('_', ' ')} ${v === null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : String(v)}`)
      return {
        key: `${name}:${i}`,
        exception: flags.length > 0,
        cells: [link(`py:/basis_records/${name}/${i}`, String(e.year ?? e.event ?? i)), text(values.join(' · ')), /^D\d{2}$/.test(String(e.source)) ? link(String(e.source)) : text(String(e.source ?? ''), 'muted'), text(flags.join(', ') || null, flags.length ? 'bad' : undefined)],
      }
    })
    const outKey = BASIS_OUT[name]
    if (outKey) {
      const out = num(v3.carryovers_out.federal[outKey])
      rows.push({ key: `${name}:out`, exception: true, cells: [text('2025 (v3 out)'), text(`${outKey.replaceAll('_', ' ')} ${out === null ? '—' : out.toLocaleString('en-US')}`), text('return v3 carryovers_out', 'muted'), text(null)] })
    }
    return { key: name, title: name.replaceAll('_', ' '), ref: `py:/basis_records/${name}`, rows }
  })
  const notes: Banner[] = findings.length ? [{ text: 'Basis findings (CHK-30)', tone: 'warn', refs: findings }] : []
  return { columns: [{ label: 'Year' }, { label: 'Amounts' }, { label: 'Source' }, { label: 'Flags' }], groups, notes, allByDefault: true }
}
