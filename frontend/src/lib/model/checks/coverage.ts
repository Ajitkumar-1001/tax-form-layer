// Completeness: every used document lands somewhere, every form carries its required entries, outside
// filings are identified, and every engine diagnostic and alternative gets a recorded disposition.
import { whatIfEffect } from '../effects'
import type { ExtractedValue, Packet, PacketDocument, ReturnVersion } from '../packet-types'
import { copiedOrReplaced } from './duplicates'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const fmt = (n: number) => n.toLocaleString('en-US')
const latestOf = (p: Packet): ReturnVersion => p.return_versions[p.return_versions.length - 1]
const docsOfType = (ctx: CheckContext, re: RegExp) => ctx.packet.documents.filter((d) => re.test(d.document_type))
const pageMatch = (d: PacketDocument, re: RegExp) => d.pages.some((p) => re.test(p.printed_content))

/** Documents whose content enters the return through prior-year data or that only support identity/engagement. */
const SUPPORT_ONLY = new Set(['engagement_letter', 'consent_7216', 'identity_document', 'prior_year_return', 'prior_workpaper'])

/** Documents the current version uses that no line cites, and whether each is support-only. */
export function unlanded(ctx: CheckContext): { doc: PacketDocument; support: boolean }[] {
  return latestOf(ctx.packet).documents_used.flatMap((id) => {
    const d = ctx.docs[id]
    return d && !(ctx.landedIn[id] ?? []).length ? [{ doc: d, support: SUPPORT_ONLY.has(d.document_type) }] : []
  })
}

const chk48: Check = {
  id: 'CHK-48',
  name: 'Every document used lands on a line, or says why not',
  family: 'coverage_completeness',
  run(ctx) {
    const latest = latestOf(ctx.packet)
    const copies = copiedOrReplaced(ctx)
    return unlanded(ctx).flatMap(({ doc: d, support }): Finding[] => {
      // The more specific finding stays: CHK-03 explains a document never extracted, CHK-18 a copy or replaced original.
      if (d.extraction.status === 'not_extracted' || copies.has(d.id)) return []
      const id = d.id
      const n = (ctx.evByDoc[id] ?? []).length
      return [{
        id: `chk:CHK-48:${id}`,
        check: 'CHK-48',
        family: 'coverage_completeness',
        title: `${id} is used in ${latest.version} but lands on no line`,
        why:
          `${d.title} is listed in ${latest.version} documents_used, yet no line cites it or any of its ${n} extracted value${n === 1 ? '' : 's'}. ` +
          (support
            ? 'It is a support or prior-year document; record that disposition.'
            : 'Either its content is missing from the return or the reason it does not land must be recorded.'),
        severity: support ? 'info' : 'warning',
        signal: 'computed',
        claims: [id],
        evidence: [id],
        knownSince: latestKnown(ctx, [id]),
        fix: support ? { act: 'dispose', target: id, disposition: 'informational', label: 'Mark as support only' } : undefined,
      }]
    })
  },
}

// ── Foreign accounts (shared by CHK-49 and CHK-50) ──────────────────────────────────────

const FBAR_THRESHOLD = 10_000

/** Highest foreign-account balance in USD at the year-end rate ("max_balance_sek" × fx_rates.SEK_per_USD). */
function foreignMaxUsd(ctx: CheckContext): { usd: number; ev: string; doc: string; rateRef: string } | null {
  let best: { usd: number; ev: string; doc: string; rateRef: string } | null = null
  for (const d of docsOfType(ctx, /^foreign_bank_statement$/)) {
    for (const e of ctx.evByDoc[d.id] ?? []) {
      const m = /^max\w*_([a-z]{3})$/.exec(e.field)
      if (!m || typeof e.value !== 'number') continue
      const cur = m[1].toUpperCase()
      const key = `${d.tax_year}_year_end`
      const table = ctx.packet.fx_rates[`${cur}_per_USD`] as Record<string, unknown> | undefined
      const rate = cur === 'USD' ? 1 : table?.[key]
      if (typeof rate !== 'number') continue
      const usd = Math.round(e.value / rate)
      if (!best || usd > best.usd) best = { usd, ev: e.id, doc: d.id, rateRef: `ref:fx.${cur}.${key}` }
    }
  }
  return best
}

// ── CHK-49: required entries per form (hand-seeded firm inventory) ────────────────────────

interface Forced {
  answer: string
  because: string
  evidence: string[]
}
interface RequiredEntry {
  key: string // the entry the form needs; present when a v3 line has this key or a label matching `match`
  label: string
  match: RegExp
  near?: string // the line to attach to (falls back to the form's first line); avoid lines other findings decide on
  applies?: (ctx: CheckContext) => boolean // default: the form is filed
  forced?: (ctx: CheckContext) => Forced | null
}

const hasLine = (prefix: string) => (ctx: CheckContext) => Object.keys(ctx.lines).some((k) => k.startsWith(prefix))
const docsForced = (ctx: CheckContext, re: RegExp, answer: string, because: string): Forced | null => {
  const ds = docsOfType(ctx, re).map((d) => d.id)
  return ds.length ? { answer, because: `${because} (${ds.join(', ')})`, evidence: ds } : null
}

const REQUIRED: RequiredEntry[] = [
  {
    key: 'F1040.digital_assets', label: 'Form 1040 digital-asset question', match: /digital asset/i, near: 'F1040.7',
    forced: (ctx) => docsForced(ctx, /^1099-DA$/, 'Yes', 'a broker reported digital-asset dispositions'),
  },
  {
    key: 'F1040.dependents', label: 'Form 1040 dependents table (name, SSN, relationship, credits)', match: /dependents? (table|list)/i, near: 'F1040.19',
    applies: (ctx) => ctx.packet.household.people.some((p) => p.role === 'dependent'),
  },
  {
    key: 'F1040.ip_pin', label: 'Identity Protection PIN', match: /identity protection pin|\bip pin\b/i, near: 'F1040.33',
    applies: (ctx) => ctx.packet.household.people.some((p) => p.ip_pin) || docsOfType(ctx, /ip_pin/).length > 0,
  },
  { key: 'F1040.designee', label: 'Third-party designee', match: /designee/i, near: 'F1040.33' },
  {
    key: 'SchB.7a.fincen', label: 'Schedule B line 7a: required to file FinCEN Form 114?', match: /fincen|fbar/i, near: 'SchB.7a',
    forced: (ctx) => {
      const fm = foreignMaxUsd(ctx)
      return fm && fm.usd > FBAR_THRESHOLD
        ? { answer: 'Yes', because: `the foreign account maximum is ${fmt(fm.usd)} USD`, evidence: [fm.ev, fm.rateRef] }
        : null
    },
  },
  {
    key: 'SchC.F', label: 'Schedule C line F: accounting method', match: /accounting method/i, near: 'SchC.I',
    forced: (ctx) => {
      const books = docsOfType(ctx, /^books_/).find((d) => pageMatch(d, /\b(cash|accrual) basis\b/i))
      const m = books?.pages.map((p) => /\b(cash|accrual) basis\b/i.exec(p.printed_content)).find(Boolean)
      return books && m ? { answer: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), because: `the books say "${m[0]}"`, evidence: [books.id] } : null
    },
  },
  { key: 'SchC.G', label: 'Schedule C line G: materially participated', match: /materially participate/i, near: 'SchC.I' },
  {
    key: 'SchC.H', label: 'Schedule C line H: started or acquired this year', match: /started or acquired/i, near: 'SchC.I',
    forced: (ctx) => {
      const py = Object.keys(ctx.packet.prior_years.return_2024.lines).find((k) => k.startsWith('SchC.'))
      return py ? { answer: 'No', because: 'the 2024 return already carried a Schedule C', evidence: [`py:/return_2024/lines/${py}`] } : null
    },
  },
  {
    key: 'SchC.45', label: 'Schedule C line 45: vehicle available for personal use', match: /personal use/i, near: 'SchC.43', applies: hasLine('SchC.44'),
    forced: (ctx) => {
      const other = ctx.lines['SchC.44c']
      return typeof other?.value === 'number' && other.value > 0
        ? { answer: 'Yes', because: `the log shows ${fmt(other.value)} other miles`, evidence: other.sources }
        : null
    },
  },
  { key: 'SchC.46', label: 'Schedule C line 46: another vehicle available for personal use', match: /another vehicle/i, near: 'SchC.43', applies: hasLine('SchC.44') },
  {
    key: 'SchC.47a', label: 'Schedule C line 47a: evidence to support the deduction', match: /evidence to support/i, near: 'SchC.43', applies: hasLine('SchC.44'),
    forced: (ctx) => docsForced(ctx, /^mileage_log$/, 'Yes', 'a mileage log is in the file'),
  },
  {
    key: 'SchC.47b', label: 'Schedule C line 47b: evidence is written', match: /written evidence|evidence written/i, near: 'SchC.43', applies: hasLine('SchC.44'),
    forced: (ctx) => docsForced(ctx, /^mileage_log$/, 'Yes', 'the mileage log is written'),
  },
  { key: 'SchD.qof', label: 'Schedule D qualified opportunity fund question', match: /opportunity fund/i, near: 'SchD.16' },
  { key: 'SchE.A', label: 'Schedule E line A: payments requiring Forms 1099', match: /payments? .*requir\w* .*1099/i, near: 'SchE.1A' },
  { key: 'SchE.B', label: 'Schedule E line B: required Forms 1099 filed', match: /fil\w* .*1099/i, near: 'SchE.1A' },
  {
    key: 'SchE.28e', label: 'Schedule E line 28 column (e): basis computation required', match: /basis computation/i, near: 'SchE.28A', applies: hasLine('SchE.28'),
    forced: (ctx) => {
      const f7203 = Object.keys(ctx.lines).find((k) => k.startsWith('F7203.'))
      return f7203 ? { answer: 'Checked', because: 'Form 7203 is filed', evidence: [f7203] } : null
    },
  },
  { key: 'SchA.8box', label: 'Schedule A line 8 box: loan not used to buy, build or improve the home', match: /didn.t use|not used to buy/i, near: 'SchA.8a', applies: hasLine('SchA.8') },
  { key: 'F2441.addresses', label: 'Form 2441 care provider addresses', match: /provider address/i, near: 'F2441.1a' },
  { key: 'F2441.household_employee', label: 'Form 2441 household-employee question', match: /household employee/i, near: 'F2441.1a' },
  { key: 'F8889.1', label: 'Form 8889 line 1: HDHP coverage (self-only or family)', match: /self-only|coverage type/i },
  {
    key: 'F540NR.residency', label: 'Form 540NR Part I residency dates', match: /residency (dates|period)/i,
    forced: (ctx) => ({
      answer: ctx.packet.household.residency.map((r) => `${r.state} ${r.status} ${r.from} to ${r.to}`).join('; '),
      because: 'that is what the household residency record says',
      evidence: ['household'],
    }),
  },
  { key: 'F540NR.use_tax', label: 'Form 540NR use tax', match: /use tax/i },
  { key: 'F540NR.health_coverage', label: 'Form 540NR health care coverage', match: /health (care )?coverage/i },
]

const chk49: Check = {
  id: 'CHK-49',
  name: 'Every form filed carries its required questions and entries',
  family: 'coverage_completeness',
  run(ctx) {
    const byForm = new Map<string, string[]>()
    for (const l of Object.values(ctx.lines)) byForm.set(l.form, [...(byForm.get(l.form) ?? []), l.key])
    const out: Finding[] = []
    for (const r of REQUIRED) {
      const form = r.key.slice(0, r.key.indexOf('.'))
      const formLines = byForm.get(form)
      if (!formLines || (r.applies && !r.applies(ctx))) continue
      const present = ctx.lines[r.key] ?? formLines.map((k) => ctx.lines[k]).find((l) => r.match.test(l.label))
      if (present && present.value !== '' && present.value !== null) continue
      const forced = r.forced?.(ctx) ?? null
      const anchor = r.near && ctx.lines[r.near] ? r.near : formLines[0]
      const evidence = forced?.evidence ?? []
      out.push({
        id: `chk:CHK-49:${r.key}`,
        check: 'CHK-49',
        family: 'coverage_completeness',
        title: `${r.label} is missing from the return`,
        why:
          `${form} is filed, and the firm inventory requires this entry; no line in the current version carries it.` +
          (forced ? ` The file forces the answer: ${forced.answer}, because ${forced.because}; a questionnaire answer cannot override it.` : ''),
        severity: 'warning',
        signal: 'computed',
        claims: [anchor],
        evidence,
        expected: forced?.answer,
        knownSince: latestKnown(ctx, evidence),
        // The entry has no line to adjust: a completeness decision on the entry key records it; `to` is the suggested choice.
        fix: { act: 'decide', target: r.key, to: forced?.answer, label: forced ? `Answer ${forced.answer}` : 'Record the answer' },
      })
    }
    return out
  },
}

// ── CHK-50: filings outside the return ────────────────────────────────────────────────

const deadline = (p: Packet, re: RegExp) => p.firm.deadlines.find((d) => re.test(d.what))
const engagementExcludes = (ctx: CheckContext, re: RegExp) =>
  docsOfType(ctx, /^engagement_letter$/).find((d) => d.pages.some((p) => new RegExp(String.raw`not included[^.]*${re.source}`, 'i').test(p.printed_content)))
/** A diagnostic attaches to the lines its refs are (or cite them); refs no line cites fall back to their document. */
function diagClaims(ctx: CheckContext, code: string, refs: string[]): string[] {
  const lines = refs.flatMap((r) => (ctx.claims[r] ? [r] : (ctx.citedBy[r] ?? [])))
  const docs = lines.length ? [] : refs.flatMap((r) => (ctx.ev[r] ? [ctx.ev[r].document_id] : []))
  return [`diag:${code}`, ...new Set([...lines, ...docs])]
}
const diagMatching = (ctx: CheckContext, re: RegExp) => {
  const d = latestOf(ctx.packet).diagnostics.find((x) => re.test(x.code) || re.test(x.message))
  return d ? diagClaims(ctx, d.code, d.refs) : null
}

/** Named payees on a contractor-payments page, paid 600 or more by a method other than card or a payment network (1099-K). */
function contractorPayees(ctx: CheckContext): ExtractedValue[] {
  return docsOfType(ctx, /^books_/).flatMap((d) =>
    (ctx.evByDoc[d.id] ?? []).filter((e) => {
      const text = d.pages.find((p) => p.page === e.page)?.printed_content ?? ''
      const row = text.split(';').find((r) => e.text_as_read && r.includes(e.text_as_read)) ?? ''
      return /\bcontractor payments\b/i.test(text) && !!e.label && row.includes(e.label) && typeof e.value === 'number' && e.value >= 600 &&
        /\bpaid by\b/i.test(row) && !/card|paypal|venmo/i.test(row)
    }),
  )
}

function outsideFinding(ctx: CheckContext, subject: string, title: string, why: string, claims: string[], evidence: string[], due?: { what: string; date: string }, excludedBy?: PacketDocument): Finding {
  const ev = [...evidence, ...(excludedBy ? [excludedBy.id] : [])]
  return {
    id: `chk:CHK-50:${subject}`,
    check: 'CHK-50',
    family: 'coverage_completeness',
    title,
    why:
      why +
      (due ? ` Due ${due.date} (${due.what}).` : '') +
      (excludedBy ? ` It is outside the engagement (${excludedBy.id}), so a written client notice is required.` : '') +
      ' Record evidence of filing or the client notice before sign-off.',
    severity: 'warning',
    signal: 'computed',
    claims,
    evidence: ev,
    knownSince: latestKnown(ctx, ev),
    fix: { act: 'dispose', target: claims[0], disposition: 'client_notified', label: 'Record the written client notice' },
  }
}

const chk50: Check = {
  id: 'CHK-50',
  name: 'Every outside filing triggered by the documents is identified',
  family: 'coverage_completeness',
  run(ctx) {
    const year = ctx.packet.household.tax_year
    const out: Finding[] = []

    const fm = foreignMaxUsd(ctx)
    if (fm && fm.usd > FBAR_THRESHOLD) {
      out.push(outsideFinding(
        ctx, `fbar_${year}`,
        `FinCEN 114 (FBAR) is required for ${year}: foreign account maximum ${fmt(fm.usd)} USD`,
        `The highest foreign balance (${fm.doc}) converted at the year-end rate exceeds ${fmt(FBAR_THRESHOLD)} USD.`,
        diagMatching(ctx, /fbar|fincen/i) ?? [fm.doc], [fm.ev, fm.doc, fm.rateRef],
        deadline(ctx.packet, /fincen|fbar/i), engagementExcludes(ctx, /(fincen|fbar)/),
      ))
    }

    const payees = contractorPayees(ctx)
    if (payees.length) {
      const filed = Object.values(ctx.lines).find((l) => l.form === 'SchC' && /filed .*1099/i.test(l.label))
      out.push({
        ...outsideFinding(
          ctx, `1099nec_${year}`,
          `Forms 1099-NEC are required for ${payees.length} contractor${payees.length === 1 ? '' : 's'} paid ${fmt(payees.reduce((a, e) => a + (e.value as number), 0))}`,
          `${payees.map((e) => `${e.label || e.field} ${fmt(e.value as number)}`).join(', ')} paid by a method other than card. ` +
            'A payee that is a corporation needs no 1099-NEC; confirm each payee before filing.' +
            (filed ? ` ${filed.key} "${filed.label}" is ${String(filed.value)}.` : ''),
          diagMatching(ctx, /1099-NEC|FORM_1099/i) ?? [payees[0].document_id], [...payees.map((e) => e.id), ...(filed ? [filed.key] : [])],
          deadline(ctx.packet, /1099-NEC/i), engagementExcludes(ctx, /Forms? 1099/),
        ),
        signal: 'heuristic', // payee entity type is not in the file
      })
    }

    // Prior-preparer items that name a foreign gift or inheritance return.
    const ppw = ctx.packet.prior_years.prior_preparer_workpaper
    const items = [
      ...ppw.open_items_left_by_prior_preparer.map((t, i) => ({ t, id: `py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${i}` })),
      ...ppw.notes.map((t, i) => ({ t, id: `py:/prior_preparer_workpaper/notes/${i}` })),
    ]
    for (const it of items.filter((x) => /\b3520\b/.test(x.t))) {
      const y = /(\d{4}) Form 3520/.exec(it.t)?.[1] ?? 'prior'
      const inherit = ctx.packet.documents.filter((d) => pageMatch(d, /inherit/i)).map((d) => d.id)
      out.push(outsideFinding(
        ctx, `f3520_${y}`,
        `Form 3520 for ${y} is unconfirmed`,
        `The prior preparer left "${it.t}" with no resolution. A foreign inheritance or gift over the threshold needs Form 3520 for that year, and FBAR / Form 8938 status for it.`,
        [it.id], [it.id, ...inherit],
      ))
    }
    return out
  },
}

// ── CHK-52: diagnostics and engine alternatives need a disposition ───────────────────────

/** "Treat X as Y" is a characterisation the law decides; anything else the engine offers is a taxpayer choice. */
const TREATMENT = /^\s*treat\b/i

const chk52: Check = {
  id: 'CHK-52',
  name: 'Engine diagnostics and alternatives each carry a recorded disposition',
  family: 'coverage_completeness',
  run(ctx) {
    const versions = ctx.packet.return_versions
    const latest = latestOf(ctx.packet)
    const out: Finding[] = []
    // CHK-50 says more about a diagnostic that is an outside filing (amount, deadline, engagement scope).
    const outside = new Set(chk50.run(ctx).map((f) => f.claims[0]))

    for (const d of latest.diagnostics) {
      if (outside.has(`diag:${d.code}`)) continue
      let first = versions.length - 1
      while (first > 0 && versions[first - 1].diagnostics.some((x) => x.code === d.code)) first--
      const evidence = [...d.refs, versions[first].version]
      out.push({
        id: `chk:CHK-52:${d.code}`,
        check: 'CHK-52',
        family: 'coverage_completeness',
        title: `Engine ${d.severity} ${d.code} has no recorded disposition`,
        why: `${d.message} Open since ${versions[first].version}. Every diagnostic needs a resolution note before sign-off.`,
        severity: d.severity === 'warning' ? 'warning' : 'info',
        signal: 'computed',
        claims: diagClaims(ctx, d.code, d.refs),
        evidence,
        knownSince: latestKnown(ctx, evidence),
        fix: d.severity === 'info' ? { act: 'dispose', target: `diag:${d.code}`, disposition: 'informational', label: 'Mark as informational' } : undefined,
      })
    }

    // Diagnostics that disappeared between versions and never came back.
    const live = new Set(latest.diagnostics.map((d) => d.code))
    const seen = new Set<string>()
    for (let i = versions.length - 2; i >= 0; i--) {
      for (const d of versions[i].diagnostics) {
        if (live.has(d.code) || seen.has(d.code)) continue
        seen.add(d.code)
        const next = versions[i + 1]
        const added = next.documents_used.filter((id) => !versions[i].documents_used.includes(id))
        const evidence = [...d.refs, versions[i].version, next.version]
        out.push({
          id: `chk:CHK-52:${d.code}`,
          check: 'CHK-52',
          family: 'coverage_completeness',
          title: `${d.code} disappeared in ${next.version} without a recorded resolution`,
          why:
            `${versions[i].version} said: ${d.message} ${next.version} no longer reports it. ` +
            (added.length ? `Documents first used in ${next.version}: ${added.join(', ')}. ` : '') +
            'Confirm a document or line change resolves the whole message, not just part of it.',
          severity: d.severity === 'warning' ? 'warning' : 'info',
          signal: 'computed',
          claims: diagClaims(ctx, d.code, d.refs),
          evidence,
          knownSince: latestKnown(ctx, evidence),
        })
      }
    }

    // Engine alternatives: a dominant one (no worse anywhere, better somewhere) must be adopted or its rejection
    // documented; a treatment question needs a decision; an election that only costs tax is low priority.
    for (const a of ctx.packet.what_if.alternatives) {
      const eff = whatIfEffect(ctx.packet, a.id)
      if (!eff) continue
      const dominant = eff.fed <= 0 && eff.ca <= 0 && (eff.fed < 0 || eff.ca < 0)
      const treatment = TREATMENT.test(a.description)
      const zero = eff.fed === 0 && eff.ca === 0
      const severity = dominant || (treatment && !zero) ? 'warning' : 'info'
      const evidence = [`whatif:${a.id}`, a.base_version]
      out.push({
        id: `chk:CHK-52:whatif:${a.id}`,
        check: 'CHK-52',
        family: 'coverage_completeness',
        title: `Engine alternative "${a.description}" has no recorded decision`,
        why:
          `Against ${a.base_version}: federal ${eff.fed >= 0 ? '+' : ''}${fmt(eff.fed)}, California ${eff.ca >= 0 ? '+' : ''}${fmt(eff.ca)} (engine what-if, exact). ` +
          (dominant
            ? 'It is no worse in either jurisdiction and better in one, so adopt it or document why not.'
            : treatment
              ? 'A treatment question, not a preference: decide it with authority.'
              : 'A taxpayer choice: record it and who made it.'),
        severity,
        signal: 'computed',
        claims: [`whatif:${a.id}`, ...a.changed_lines.slice(0, 1).map((c) => c.key)],
        evidence,
        stake: zero ? undefined : { fed: eff.fed, ca: eff.ca },
        knownSince: latestKnown(ctx, evidence),
        fix: { act: 'decide', target: `whatif:${a.id}`, label: dominant ? 'Adopt or document the rejection' : 'Record the decision' },
      })
    }
    return out
  },
}

export const checks: Check[] = [chk48, chk49, chk50, chk52]
