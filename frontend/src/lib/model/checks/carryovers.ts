// Carryover tie-outs: prior-year basis chains, what rolls into next year, and the prior preparer's loose ends.
import type { PacketDocument } from '../packet-types'
import { fmt, num, sourceValues, stepRef, withKnown } from './recompute'
import type { Check, Finding } from './types'

const human = (k: string) => k.replaceAll('_', ' ')
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A link is weak when a basis figure is blank or its source is the client's say-so rather than a return or K-1. */
function weakness(link: Record<string, unknown>): string | null {
  const source = typeof link.source === 'string' ? link.source : ''
  const blank = Object.keys(link).filter((k) => /basis/.test(k) && link[k] === null)
  if (blank.length) return `${blank.map(human).join(', ')} blank (${source || 'no source'})`
  if (!source) return 'no source'
  if (/client|worksheet|assum|estimat|missing|never/i.test(source)) {
    const figure = Object.entries(link).find(([k, v]) => /basis/.test(k) && typeof v === 'number')
    return `${figure ? `${human(figure[0])} ${fmt(figure[1] as number)} ` : ''}from ${source}`
  }
  return null
}

const basisChains: Check = {
  id: 'CHK-30',
  name: 'Basis by year is documented link by link',
  family: 'carryover_tieout',
  run(ctx) {
    const out: Finding[] = []
    const k1s = Object.values(ctx.docs).filter((d) => /^K-1-\d/.test(d.document_type))
    for (const [chain, links] of Object.entries(ctx.packet.prior_years.basis_records)) {
      const weak = links.flatMap((l, i) => {
        const why = weakness(l)
        return why ? [{ ref: `py:/basis_records/${chain}/${i}`, year: String(l.year ?? l.event ?? i), why }] : []
      })
      if (!weak.length) continue
      const cited = links.flatMap((_, i) => ctx.citedBy[`py:/basis_records/${chain}/${i}`] ?? [])
      const names = chain.split('_').filter((t) => t.length >= 6)
      const docs = k1s.filter((d) => names.some((t) => d.issuer.toLowerCase().includes(t)))
      const primary = [...new Set([...cited, ...docs.map((d) => d.id)])]
      const name = docs[0]?.issuer ?? capital(human(chain))
      const target = primary[0] ?? stepRef(ctx, /carryover/i)
      out.push(withKnown(ctx, {
        id: `chk:CHK-30:${chain}`, check: 'CHK-30', family: 'carryover_tieout', severity: 'warning', signal: 'computed',
        title: `${name}: basis by year has ${weak.length} undocumented link${weak.length > 1 ? 's' : ''} (${weak.map((w) => w.year).join(', ')})`,
        why: `${weak.map((w) => `${w.year}: ${w.why}`).join('; ')}. Each year from the starting figure to now needs a return, K-1 or Form 7203; anything resting on it (gain on distributions, loss limits) is unverified.`,
        claims: primary.length ? primary : [target],
        evidence: weak.map((w) => w.ref),
        fix: { act: 'decide', target, label: 'Record the basis judgment and its authority' },
      }))
    }
    return out
  },
}

const carryoverInventory: Check = {
  id: 'CHK-31',
  name: 'Carryovers out are complete and tie to the return',
  family: 'carryover_tieout',
  run(ctx) {
    const out: Finding[] = []
    const last = ctx.packet.return_versions[ctx.packet.return_versions.length - 1]
    const fed = last.carryovers_out.federal
    const has = (re: RegExp) => Object.keys(fed).find((k) => re.test(k))
    const lines = Object.values(ctx.lines)

    // Items in this return that change next year's return and so need a carryover row.
    for (const line of lines.filter((l) => l.rule === 'R-AMT-ISO' && (num(l.value) ?? 0) > 0)) {
      if (has(/(^|_)iso(_|$)|incentive|amt.?basis/i)) continue
      const evs = sourceValues(ctx, line)
      const pick = (re: RegExp) => num(evs.find((e) => re.test(e.label))?.value)
      const shares = pick(/shares/i)
      const price = pick(/exercise price/i)
      const fmv = pick(/fmv|fair market/i)
      const basis = shares !== null && price !== null && fmv !== null ? ` (regular ${fmt(shares * price)}, AMT ${fmt(shares * fmv)})` : ''
      out.push(withKnown(ctx, {
        id: 'chk:CHK-31:iso_basis', check: 'CHK-31', family: 'carryover_tieout', severity: 'warning', signal: 'computed',
        title: `Incentive stock option shares held at year end have no carryover for their two bases${basis}`,
        why: `${line.key} adds ${fmt(num(line.value) ?? 0)} for ${shares === null ? '' : `${fmt(shares)} `}shares exercised and held. Their regular and AMT bases differ, and carryovers_out has no row for either, so a later sale would be reported without the AMT basis.`,
        claims: [line.key, ...new Set(evs.map((e) => e.document_id))],
        evidence: evs.map((e) => e.id),
        fix: { act: 'note', target: line.key, label: `Add a carryover row for the ISO basis${basis}` },
      }))
    }
    for (const line of lines.filter((l) => l.rule === 'R-POINTS-AMORTIZE' && (num(l.value) ?? 0) > 0)) {
      if (has(/point/i)) continue
      const evs = sourceValues(ctx, line).filter((e) => /point/i.test(e.label))
      const points = evs.reduce((a, e) => a + (e.value as number), 0)
      const term = /(\d+) of (\d+) months/.exec(line.label)?.[2]
      const printed = term && evs.some((e) => ctx.docs[e.document_id]?.pages.some((p) => p.printed_content.includes(`${term} months`)))
      const left = points - (num(line.value) ?? 0)
      out.push(withKnown(ctx, {
        id: 'chk:CHK-31:refinance_points', check: 'CHK-31', family: 'carryover_tieout', severity: 'warning', signal: 'computed',
        title: `Unamortized refinance points (${fmt(left)}) have no carryover`,
        why: `Points ${fmt(points)} less ${fmt(num(line.value) ?? 0)} deducted this year on ${line.key}. carryovers_out has no row, so next year's amortization has nothing to start from.` +
          (term && !printed ? ` The ${term}-month term comes from the engine, not from a document.` : ''),
        claims: [line.key, ...new Set(evs.map((e) => e.document_id))],
        evidence: evs.map((e) => e.id),
        fix: { act: 'note', target: line.key, label: `Add a carryover row for ${fmt(left)} of unamortized points` },
      }))
    }

    // Rows that exist must re-derive from the return they came from.
    const ties: { subject: string; key: string | undefined; label: string; want: number; claim: string; evidence: string[] }[] = []
    const sep = lines.find((l) => l.rule === 'R-SEP-LIMIT')
    if (sep && typeof sep.value === 'number') {
      const evs = sourceValues(ctx, sep)
      const excess = evs.reduce((a, e) => a + (e.value as number), 0) - sep.value
      if (excess > 0) ties.push({ subject: 'sep_excess', key: has(/sep/i), label: 'Nondeductible SEP contribution', want: excess, claim: sep.key, evidence: evs.map((e) => e.id) })
    }
    const amt = lines.find((l) => l.form === 'F6251' && /^alternative minimum tax$/i.test(l.label))
    if (amt && (num(amt.value) ?? 0) > 0) {
      ties.push({ subject: 'minimum_tax_credit', key: has(/minimum_tax_credit|amt_credit/i), label: 'Minimum tax credit', want: num(amt.value) ?? 0, claim: amt.key, evidence: [last.version] })
    }
    const caDiffs = last.carryovers_out.california.depreciation_basis_differences
    const caRows = caDiffs && typeof caDiffs === 'object' ? (caDiffs as Record<string, unknown>) : {}
    for (const a of last.assets) {
      const diff = Math.round((a.federal.accumulated_end - a.california.accumulated_end) * 100) / 100
      if (Math.abs(diff) < 0.5) continue
      const got = num(caRows[a.asset_id])
      if (got !== null && Math.abs(got - diff) <= 1) continue
      out.push(withKnown(ctx, {
        id: `chk:CHK-31:ca_basis:${a.asset_id}`, check: 'CHK-31', family: 'carryover_tieout', severity: 'warning', signal: 'computed',
        title: got === null ? `California basis difference for ${a.asset_id} (${fmt(diff)}) has no carryover row` : `California basis difference for ${a.asset_id} carries ${fmt(got)}; the assets show ${fmt(diff)}`,
        why: `Federal accumulated depreciation ${fmt(a.federal.accumulated_end)} less California ${fmt(a.california.accumulated_end)}.`,
        claims: [stepRef(ctx, /carryover/i)], evidence: [`asset:${a.asset_id}`, last.version],
      }))
    }
    for (const t of ties) {
      const got = t.key ? num(fed[t.key]) : null
      if (got !== null && Math.abs(got - t.want) <= 1) continue
      out.push(withKnown(ctx, {
        id: `chk:CHK-31:${t.subject}`, check: 'CHK-31', family: 'carryover_tieout', severity: 'warning', signal: 'computed',
        title: got === null ? `${t.label} (${fmt(t.want)}) has no carryover row` : `${t.label} carries ${fmt(got)}; the return gives ${fmt(t.want)}`,
        why: `Re-derived from ${t.claim} on ${last.version}.`,
        claims: [t.claim], evidence: t.evidence,
      }))
    }
    return out
  },
}

const PRIOR = 'py:/prior_preparer_workpaper'

const priorPreparerItems: Check = {
  id: 'CHK-32',
  name: 'Prior-preparer notes and open items are dispositioned',
  family: 'carryover_tieout',
  run(ctx) {
    const ppw = ctx.packet.prior_years.prior_preparer_workpaper
    const year = ctx.packet.household.tax_year
    const docs = Object.values(ctx.docs)
    const sqft = ctx.packet.extracted_values.filter(
      (e) => (/sq_?ft/i.test(e.field) || /square feet/i.test(e.label)) && typeof e.value === 'number' && ctx.docs[e.document_id]?.tax_year === year,
    )
    const items = [
      ...ppw.notes.map((text, i) => ({ subject: `notes/${i}`, kind: 'note', n: i + 1, text })),
      ...ppw.open_items_left_by_prior_preparer.map((text, i) => ({ subject: `open_items/${i}`, kind: 'open item', n: i + 1, text })),
    ]
    return items.map(({ subject, kind, n, text }) => {
      const claim = `${PRIOR}/${subject.startsWith('notes') ? 'notes' : 'open_items_left_by_prior_preparer'}/${subject.split('/')[1]}`
      // "2023 Form 3520": a form (and its year, when given) that some document in the file should be.
      const forms = [...text.matchAll(/(?:\b(\d{4}) )?Form (\d{3,4}[A-Z]*)\b/g)].map((m) => ({ year: m[1] ? Number(m[1]) : null, form: m[2] }))
      const isForm = (d: PacketDocument, f: { year: number | null; form: string }) =>
        (d.document_type === f.form || new RegExp(`Form ${f.form}(?![\\w-])`).test(d.title)) && (f.year === null || d.tax_year === f.year)
      const found = docs.filter((d) => forms.some((f) => isForm(d, f)))
      const missing = forms.filter((f) => !docs.some((d) => isForm(d, f))).map((f) => f.form)
      const area = /(\d[\d,]*)\s*sq\.?\s*ft/i.exec(text)?.[1]
      // Compare with the space the note names (its place name), when a measurement names it too.
      const named = sqft.filter((e) => e.label.split(/\s+/).some((w) => /^[A-Z][a-z]{3,}/.test(w) && text.includes(w)))
      const same = named.length ? named : sqft
      const measured = area && same.length && !same.some((e) => e.value === Number(area.replaceAll(',', ''))) ? same : []
      const sayso = /per client|client'?s|by client|assumed/i.test(text)
      const base = { id: `chk:CHK-32:${subject}`, check: 'CHK-32', family: 'carryover_tieout' as const, signal: 'computed' as const, claims: [claim] }
      if (missing.length) {
        return withKnown(ctx, {
          ...base, severity: 'warning',
          title: `Prior preparer's ${kind} ${n} names Form ${missing.join(', ')}, which is nowhere in the file`,
          why: `"${text}" No document, client answer or disposition resolves it. Ask the client in writing and record the answer.`,
          evidence: [claim],
          fix: { act: 'dispose', target: claim, disposition: 'client_notified', label: 'Record the written notice to the client' },
        })
      }
      if (measured.length) {
        return withKnown(ctx, {
          ...base, severity: 'warning', claims: [claim, ...new Set(measured.map((e) => e.document_id))],
          title: `Prior year used ${area} sq ft; ${[...new Set(measured.map((e) => e.document_id))].join(', ')} measures ${measured.map((e) => fmt(e.value as number)).join(' / ')}`,
          why: `"${text}" A current document contradicts the prior-year figure, so the prior return may need amending or disclosure.`,
          evidence: [claim, ...measured.map((e) => e.id)],
          fix: { act: 'dispose', target: claim, disposition: 'client_notified', label: 'Tell the client: amend or disclose the prior-year figure' },
        })
      }
      return withKnown(ctx, {
        ...base, severity: 'info',
        title: `Prior preparer's ${kind} ${n} needs a disposition${sayso ? ' (rests on the client\'s word)' : ''}`,
        why: `"${text}"${found.length ? ` Possibly resolved by ${found.map((d) => d.id).join(', ')}.` : ''}`,
        evidence: [claim],
        fix: { act: 'dispose', target: claim, disposition: 'informational', label: 'Record how this item is resolved' },
      })
    })
  },
}

export const checks: Check[] = [basisChains, carryoverInventory, priorPreparerItems]
