// Cross-document checks: one fact printed on two documents (or a document and the return) must agree.
// Supplemental basis vs broker basis, books vs information returns vs Schedule C, identity numbers,
// payee names and TINs, mortgage interest, property tax at purchase, and noncash gift values.
import { computeEffect, needsPartner } from '../effects'
import { SEASON_START } from '../ids'
import { parseToken, sameValue } from '../mask-token'
import type { ExtractedValue, PacketDocument, Person, ReturnLine } from '../packet-types'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pageRef = (doc: string, page: number) => `doc:${doc}#page${page}`
const docText = (d: PacketDocument) => d.pages.map((p) => p.printed_content).join('\n')
const typeOf = (ctx: CheckContext, e: ExtractedValue) => ctx.docs[e.document_id]?.document_type
const docsOfType = (ctx: CheckContext, ...types: string[]) => ctx.packet.documents.filter((d) => types.includes(d.document_type))
const evsOf = (ctx: CheckContext, docs: PacketDocument[]) => docs.flatMap((d) => ctx.evByDoc[d.id] ?? [])
const citedEvs = (ctx: CheckContext, line: ReturnLine) => line.sources.map((s) => ctx.ev[s]).filter((e): e is ExtractedValue => !!e)
const isComm = (ref: string) => /^(qa|msg|call)-/.test(ref)
const severityOf = (stake: { fed: number; ca: number }) => (needsPartner(stake) ? 'high' : 'warning')
/** MM/DD/YYYY → YYYY-MM-DD */
const iso = (us: string) => us.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2')
const last4 = (v: unknown) => parseToken(String(v))?.last4 ?? String(v).slice(-4)
/** "Atlas Outdoor Gear, Inc." → "atlas outdoor gear" */
const payerName = (issuer: string) => issuer.replace(/,.*$/, '').replace(/\s+(?:Inc|LLC|LLP|Co|Corp)\.?$/i, '').trim().toLowerCase()

function stakeOf(ctx: CheckContext, line: ReturnLine, field: 'value' | 'basis', from: number, to: number) {
  const e = computeEffect(ctx.packet, line, field, from, to)
  return { fed: e.fed, ca: e.ca }
}

// ── CHK-06 ──────────────────────────────────────────────────────────────────────────────
interface PlanLot { id: string; shares: number; acquired: string; sold: string; basis: number; doc: string; page: number; basisEv?: string }
interface BrokerLot { shares: number; acquired: string; sold: string; proceeds: ExtractedValue; basis?: ExtractedValue }

/** Lots described on a stock plan supplement, read from the printed text (the extraction lacks shares and sale dates). */
function planLots(ctx: CheckContext): PlanLot[] {
  const out: PlanLot[] = []
  for (const d of docsOfType(ctx, 'stock_plan_supplement')) {
    for (const pg of d.pages) {
      for (const m of pg.printed_content.matchAll(/\blot ([A-Z0-9][\w-]*):([\s\S]*?)(?=\blot [A-Z0-9][\w-]*:|$)/gi)) {
        const [, id, body] = m
        const shares = /(\d[\d,]*(?:\.\d+)?) sh\b/i.exec(body)
        const basis = /adjusted (?:cost )?basis \$?([\d,]+(?:\.\d+)?)/i.exec(body)
        // First date is the acquisition (vest or purchase), last is the sale (or disposition).
        const dates = [...body.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)].map((x) => iso(x[0]))
        if (!shares || !basis || dates.length < 2) continue
        const basisEv = ctx.evByDoc[d.id]?.find((e) => e.field.startsWith(`${id}_`) && /basis/i.test(e.field))
        out.push({
          id, shares: Number(shares[1].replace(/,/g, '')), acquired: dates[0], sold: dates[dates.length - 1],
          basis: Number(basis[1].replace(/,/g, '')), doc: d.id, page: pg.page, basisEv: basisEv?.id,
        })
      }
    }
  }
  return out
}

/** Broker lots grouped from extracted fields named `<lot>_quantity|acquired|sold|proceeds|basis`. */
function brokerLots(ctx: CheckContext): BrokerLot[] {
  const out: BrokerLot[] = []
  for (const d of docsOfType(ctx, '1099-B', '1099-composite')) {
    const byLot = new Map<string, Record<string, ExtractedValue>>()
    for (const e of ctx.evByDoc[d.id] ?? []) {
      const m = /^(.+)_(quantity|acquired|sold|proceeds|basis)$/.exec(e.field)
      if (!m) continue
      const lot = byLot.get(m[1]) ?? {}
      lot[m[2]] = e
      byLot.set(m[1], lot)
    }
    for (const f of byLot.values()) {
      if (!f.quantity || !f.acquired || !f.sold || !f.proceeds) continue
      out.push({ shares: Number(f.quantity.value), acquired: String(f.acquired.value), sold: String(f.sold.value), proceeds: f.proceeds, basis: f.basis })
    }
  }
  return out
}

const chk06: Check = {
  id: 'CHK-06',
  name: 'Supplemental basis statement vs broker basis',
  family: 'cross_document',
  run(ctx) {
    const plan = planLots(ctx)
    if (!plan.length) return []
    const year = String(ctx.packet.household.tax_year)
    const rsuIncome = evsOf(ctx, docsOfType(ctx, 'W-2')).filter((e) => /^box14_RSU$/i.test(e.field) && isNum(e.value))
    const vested = plan.filter((l) => /RSU/i.test(l.id) && l.acquired.startsWith(year))
    const rsuTotal = rsuIncome.reduce((s, e) => s + (e.value as number), 0)
    const ties = rsuTotal > 0 && Math.abs(rsuTotal - vested.reduce((s, l) => s + l.basis, 0)) < 0.5

    const out: Finding[] = []
    for (const lot of brokerLots(ctx)) {
      const p = plan.find((l) => l.shares === lot.shares && l.acquired === lot.acquired && l.sold === lot.sold)
      if (!p || !isNum(lot.proceeds.value)) continue
      for (const key of ctx.citedBy[lot.proceeds.id] ?? []) {
        const line = ctx.lines[key]
        if (line.form !== 'F8949' || !isNum(line.value)) continue
        // The 8949 lot value is the gain, so the basis the return actually uses is proceeds minus gain.
        const used = Math.round((lot.proceeds.value - line.value) * 100) / 100
        if (Math.abs(used - p.basis) < 0.5) continue
        const stake = stakeOf(ctx, line, 'basis', used, p.basis)
        const evidence = [
          lot.proceeds.id, ...(lot.basis ? [lot.basis.id] : []), ...(p.basisEv ? [p.basisEv] : []),
          pageRef(p.doc, p.page), pageRef(lot.proceeds.document_id, lot.proceeds.page),
          ...(ties && vested.includes(p) ? rsuIncome.map((e) => e.id) : []),
        ]
        out.push({
          id: `chk:CHK-06:${key}`,
          check: 'CHK-06',
          family: 'cross_document',
          title: `${key} uses basis ${fmt(used)}; the ${p.doc} stock plan supplement gives adjusted basis ${fmt(p.basis)} for lot ${p.id}`,
          why:
            `${p.doc} lot ${p.id} (${p.shares} sh, acquired ${p.acquired}, sold ${p.sold}) matches the ${lot.proceeds.document_id} lot on shares and both dates. ` +
            `${lot.basis?.text_as_read ? `The broker reports basis ${lot.basis.text_as_read}` : 'The broker left basis blank'}; the supplement's adjusted basis includes income already taxed as wages.` +
            (ties && vested.includes(p) ? ` W-2 box 14 RSU income ${fmt(rsuTotal)} equals the supplement basis of the lots that vested in ${year}.` : ''),
          severity: severityOf(stake),
          signal: 'computed',
          claims: [key],
          evidence,
          expected: p.basis,
          actual: used,
          stake,
          knownSince: latestKnown(ctx, evidence),
          fix: { act: 'adjust', target: key, field: 'basis', to: p.basis, label: `Set basis to ${p.doc} adjusted basis ${fmt(p.basis)}` },
        })
      }
    }
    return out
  },
}

// ── CHK-07 ──────────────────────────────────────────────────────────────────────────────
const GROSS_RECEIPTS = 'SchC.1'

const chk07: Check = {
  id: 'CHK-07',
  name: 'Gross receipts tie-out',
  family: 'cross_document',
  run(ctx) {
    const line = ctx.lines[GROSS_RECEIPTS]
    const books = evsOf(ctx, docsOfType(ctx, 'books_profit_loss')).find((e) => e.field === 'total_income' && isNum(e.value))
    if (!line || !isNum(line.value) || !books) return []
    const nec = evsOf(ctx, docsOfType(ctx, '1099-NEC')).filter((e) => e.field === 'box1' && isNum(e.value))
    const k = evsOf(ctx, docsOfType(ctx, '1099-K')).filter((e) => e.field === 'box1a' && isNum(e.value))
    const detail = evsOf(ctx, docsOfType(ctx, 'books_transaction_detail'))
    const dep = detail.find((e) => /\b(without|no) Form 1099\b/i.test(e.label) && isNum(e.value))
    const sum = (es: ExtractedValue[]) => es.reduce((s, e) => s + (e.value as number), 0)
    const necTotal = sum(nec)
    const kTotal = sum(k)
    const booksTotal = books.value as number
    const tied = !!dep && Math.abs(necTotal + (dep.value as number) - booksTotal) < 0.5
    // Card receipts the books attribute to a payer that also issued a 1099-NEC, for the same total as a 1099-K.
    const necPayers = nec.map((e) => payerName(ctx.docs[e.document_id].issuer)).filter((n) => n.length > 0)
    const overlap = detail.filter(
      (e) => isNum(e.value) && k.some((x) => x.value === e.value) && necPayers.some((n) => e.label.toLowerCase().includes(n)),
    )
    const out: Finding[] = []

    // Expected receipts: books income plus any 1099-K receipts the books do not attribute to a deposit.
    const unbooked = Math.max(0, kTotal - sum(overlap))
    const expected = booksTotal + unbooked
    const residual = line.value - expected
    if (Math.abs(residual) >= 0.5) {
      // The 1099-K(s) the residual equals: one form, or all of them together.
      const one = k.filter((e) => e.value === residual)
      const kRefs = one.length ? one : kTotal > 0 && Math.abs(residual - kTotal) < 0.5 ? k : []
      const stake = stakeOf(ctx, line, 'value', line.value, expected)
      const evidence = [books.id, ...kRefs.map((e) => e.id), ...overlap.map((e) => e.id), ...(dep ? [dep.id] : []), ...nec.map((e) => e.id)]
      const issuers = kRefs.map((e) => ctx.docs[e.document_id].issuer).join(', ')
      out.push({
        id: `chk:CHK-07:${GROSS_RECEIPTS}`,
        check: 'CHK-07',
        family: 'cross_document',
        title:
          `Gross receipts ${fmt(line.value)} are ${fmt(Math.abs(residual))} ${residual > 0 ? 'more' : 'less'} than ` +
          (unbooked ? `books income plus unbooked Form 1099-K receipts (${fmt(expected)})` : `books income ${fmt(booksTotal)}`) +
          (kRefs.length ? `; the difference equals the ${issuers} Form 1099-K` : ''),
        why:
          `Forms 1099-NEC total ${fmt(necTotal)}` +
          (dep ? ` and deposits from clients without a 1099 ${fmt(dep.value as number)}; together ${tied ? 'they equal' : 'they do not equal'} books income ${fmt(booksTotal)}. ` : '. ') +
          (overlap.length
            ? `The books deposit detail attributes ${overlap.map((e) => `${fmt(e.value as number)} (${e.label})`).join(', ')} to a payer that also issued a Form 1099-NEC, so that Form 1099-K money is already inside books income${kRefs.length ? ': possible double count' : ''}.`
            : 'No books detail attributes the Form 1099-K receipts to a deposit.'),
        severity: severityOf(stake),
        signal: tied ? 'computed' : 'heuristic',
        claims: [GROSS_RECEIPTS],
        evidence,
        expected,
        actual: line.value,
        stake,
        knownSince: latestKnown(ctx, evidence),
        fix: { act: 'adjust', target: GROSS_RECEIPTS, field: 'value', to: expected, label: `Set gross receipts to ${fmt(expected)}` },
      })
    }

    // A client who says customers pay by card, while every 1099-K is already attributed to a 1099-NEC payer.
    const cardAnswer = ctx.packet.client.questionnaire.find((q) => /1099/.test(q.question) && /\bcard\b/i.test(q.answer))
    if (cardAnswer && kTotal > 0 && Math.abs(sum(overlap) - kTotal) < 0.5) {
      const evidence = [cardAnswer.id, ...k.map((e) => e.id), ...overlap.map((e) => e.id)]
      out.push({
        id: `chk:CHK-07:${cardAnswer.id}`,
        check: 'CHK-07',
        family: 'cross_document',
        title: `Client says some clients pay by card, but no card receipts outside the 1099-NEC payers are on file`,
        why: `${cardAnswer.id}: "${cardAnswer.answer}" Every Form 1099-K dollar (${fmt(kTotal)}) is attributed in the books to a payer that also issued a 1099-NEC. Another processor or unrecorded card receipts may exist; this is a pattern, not proof.`,
        severity: 'warning',
        signal: 'heuristic',
        claims: [cardAnswer.id, GROSS_RECEIPTS],
        evidence,
        knownSince: latestKnown(ctx, evidence),
        fix: { act: 'note', target: cardAnswer.id, label: 'Ask the client about other card processors' },
      })
    }
    return out
  },
}

// ── CHK-08 ──────────────────────────────────────────────────────────────────────────────
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b|«ssn·[^»]*»/g
const DOB_RE = /\b(?:DOB|date of birth):?\s*(\d{2}\/\d{2}\/\d{4})/gi
const NAME_WINDOW = 120

/** The household member whose name appears closest before `at` (within a short window), if any. */
function ownerAt(text: string, at: number, people: Person[]): Person | undefined {
  let best: Person | undefined
  let bestPos = -1
  for (const p of people) {
    const pos = text.lastIndexOf(p.name, at)
    if (pos > bestPos && at - pos <= NAME_WINDOW) [best, bestPos] = [p, pos]
  }
  return best
}

interface Sighting { value: string; ref: string }

function sightings(ctx: CheckContext, person: Person, re: RegExp, docTypes?: string[]): Sighting[] {
  const people = ctx.packet.household.people
  const out: Sighting[] = []
  for (const d of ctx.packet.documents) {
    if (docTypes && !docTypes.includes(d.document_type)) continue
    for (const pg of d.pages) {
      for (const m of pg.printed_content.matchAll(re)) {
        if (ownerAt(pg.printed_content, m.index, people) !== person) continue
        const value = m[1] ? iso(m[1]) : m[0]
        const ev = ctx.evByDoc[d.id]?.find((e) => e.page === pg.page && sameValue(e.value, value))
        out.push({ value, ref: ev?.id ?? pageRef(d.id, pg.page) })
      }
    }
  }
  return out
}

function identityFinding(ctx: CheckContext, person: Person, field: string, label: string, own: string, seen: Sighting[]): Finding | null {
  const wrong = seen.filter((s) => !sameValue(s.value, own))
  if (!wrong.length) return null
  const claim = `household:${person.id}#${field}`
  const evidence = seen.map((s) => s.ref)
  const knownBy = (s: Sighting) => latestKnown(ctx, [`household:${person.id}`, s.ref])
  // Any single disagreeing sighting proves the problem, so it is known from the earliest one.
  const knownSince = wrong.map(knownBy).sort()[0]
  // The text is static, so it names only what is in the file when the finding first shows (the clock starts
  // at SEASON_START); later sightings stay in `evidence`.
  const shownAt = knownSince > SEASON_START ? knownSince : SEASON_START
  const seenThen = seen.filter((s) => knownBy(s) <= shownAt)
  const wrongThen = wrong.filter((s) => knownBy(s) <= shownAt)
  const agreed = wrongThen.every((s) => sameValue(s.value, wrongThen[0].value))
  const where = [...new Set(wrongThen.map((s) => (s.ref.startsWith('py:') ? 'the 2024 return' : (ctx.ev[s.ref]?.document_id ?? s.ref.replace(/^doc:(D\d+).*/, '$1')))))]
  const sensitive = field !== 'dob'
  // A masked PIN shows no tail (mask.ts), so it reads as words.
  const show = (v: string) => (!sensitive ? v : last4(v) ? `ending ${last4(v)}` : 'a masked value')
  return {
    id: `chk:CHK-08:${claim}`,
    check: 'CHK-08',
    family: 'cross_document',
    title: `${person.name}'s ${label} in the organizer does not match ${wrongThen.length} of ${seenThen.length} places it is printed`,
    why: `The organizer has ${show(own)}; ${where.join(', ')} show${where.length === 1 ? 's' : ''} ${agreed ? show(wrongThen[0].value) : 'other values'}. Identity data that disagrees with agency records rejects the e-file.`,
    severity: 'high',
    signal: 'computed',
    claims: [claim],
    evidence,
    expected: agreed ? wrongThen[0].value : undefined,
    actual: own,
    knownSince,
    fix: { act: 'adjust', target: claim, field: 'value', label: `Correct the ${label} to the one printed on ${where.join(', ')}` },
  }
}

const chk08: Check = {
  id: 'CHK-08',
  name: 'One person, one identity',
  family: 'cross_document',
  run(ctx) {
    const out: Finding[] = []
    const dependents = ctx.packet.prior_years.return_2024.dependents
    for (const person of ctx.packet.household.people) {
      const ssns = sightings(ctx, person, SSN_RE)
      dependents.forEach((d, i) => {
        if (d.name === person.name) ssns.push({ value: d.ssn, ref: `py:/return_2024/dependents/${i}/ssn` })
      })
      const dobs = sightings(ctx, person, DOB_RE, ['identity_document'])
      const pins = person.ip_pin
        ? evsOf(ctx, docsOfType(ctx, 'irs_ip_pin_notice').filter((d) => docText(d).includes(person.name)))
            .filter((e) => /ip_pin/i.test(e.field))
            .map((e) => ({ value: String(e.value), ref: e.id }))
        : []
      for (const f of [
        identityFinding(ctx, person, 'ssn', 'SSN', person.ssn, ssns),
        identityFinding(ctx, person, 'dob', 'date of birth', person.dob, dobs),
        person.ip_pin ? identityFinding(ctx, person, 'ip_pin', 'IP PIN', person.ip_pin, pins) : null,
      ]) {
        if (f) out.push(f)
      }
    }
    return out
  },
}

// ── CHK-09 ──────────────────────────────────────────────────────────────────────────────
const TIN_RE = /\b\d{2}-\d{7}\b|\b\d{3}-\d{2}-\d{4}\b|«(?:ein|ssn)·[^»]*»/g

/** Pages a line cites: the page of each cited value, or every page of a cited document. */
function citedPages(ctx: CheckContext, line: ReturnLine): { doc: string; page: number; text: string }[] {
  const out = new Map<string, { doc: string; page: number; text: string }>()
  for (const s of line.sources) {
    const e = ctx.ev[s]
    const d = ctx.docs[e?.document_id ?? s]
    for (const pg of d?.pages ?? []) {
      if (e && pg.page !== e.page) continue
      out.set(pageRef(d.id, pg.page), { doc: d.id, page: pg.page, text: pg.printed_content })
    }
  }
  return [...out.values()]
}

const chk09: Check = {
  id: 'CHK-09',
  name: 'Names and TINs on return lines are printed on the cited page',
  family: 'cross_document',
  run(ctx) {
    const out: Finding[] = []
    const pyLines = Object.entries(ctx.packet.prior_years.return_2024.lines)
    for (const line of Object.values(ctx.lines)) {
      const tin = line.label.match(TIN_RE)?.[0]
      if (!tin) continue
      const name = /(?:^|:\s*)([^:]+?),\s*(?:tax ID|TIN|EIN)\b/i.exec(line.label)?.[1]?.trim()
      const pages = citedPages(ctx, line)
      if (!pages.length) continue
      const text = pages.map((p) => p.text).join('\n')
      const pageTins = text.match(TIN_RE) ?? []
      const refs = pages.map((p) => pageRef(p.doc, p.page))
      const docs = [...new Set(pages.map((p) => p.doc))].join(', ')
      const tinEv = citedEvs(ctx, line).find((e) => sameValue(e.value, tin))

      if (!pageTins.some((t) => sameValue(t, tin))) {
        const evidence = [...(tinEv ? [tinEv.id] : []), ...refs]
        out.push({
          id: `chk:CHK-09:${line.key}:tin`,
          check: 'CHK-09',
          family: 'cross_document',
          title: `The tax ID on ${line.key} (ending ${last4(tin)}) is not printed on ${docs}`,
          why: `${docs} prints ${pageTins.length ? pageTins.map((t) => `a tax ID ending ${last4(t)}`).join(', ') : 'no tax ID'}. The return must carry the provider's number exactly as printed.`,
          severity: 'warning',
          signal: 'computed',
          claims: [line.key],
          evidence,
          knownSince: latestKnown(ctx, evidence),
          fix: { act: 'adjust', target: line.key, field: 'label', label: `Set the tax ID to the one printed on ${docs}` },
        })
      }

      if (name && !text.toLowerCase().includes(name.toLowerCase())) {
        // The prior-year return names the payee for the same TIN: a likely correct name.
        const py = pyLines.find(([, v]) => typeof v === 'string' && (v.match(TIN_RE) ?? []).some((t) => sameValue(t, tin)))
        const pyName = py ? String(py[1]).split(TIN_RE)[0].replace(/[,\s]+$/, '') : undefined
        const usable = pyName && text.toLowerCase().includes(pyName.toLowerCase()) ? pyName : undefined
        const evidence = [...(tinEv ? [tinEv.id] : []), ...refs, ...(py ? [`py:/return_2024/lines/${py[0]}`] : [])]
        out.push({
          id: `chk:CHK-09:${line.key}:name`,
          check: 'CHK-09',
          family: 'cross_document',
          title: `"${name}" on ${line.key} is not printed on ${docs}`,
          why: `The payee name on the return must match the cited statement.` + (pyName ? ` The 2024 return shows "${pyName}" for the same tax ID.` : ''),
          severity: 'warning',
          signal: 'computed',
          claims: [line.key],
          evidence,
          knownSince: latestKnown(ctx, evidence),
          fix: usable
            ? { act: 'adjust', target: line.key, field: 'label', to: line.label.replace(name, usable), label: `Rename to "${usable}" as printed on ${docs}` }
            : { act: 'adjust', target: line.key, field: 'label', label: `Use the name printed on ${docs}` },
        })
      }
    }
    return out
  },
}

// ── CHK-10 ──────────────────────────────────────────────────────────────────────────────
const chk10: Check = {
  id: 'CHK-10',
  name: 'Lender interest counted once',
  family: 'cross_document',
  run(ctx) {
    const out: Finding[] = []
    for (const line of Object.values(ctx.lines)) {
      if (!isNum(line.value)) continue
      const cited = citedEvs(ctx, line)
      const box1s = cited.filter((e) => typeOf(ctx, e) === '1098' && e.field === 'box1')
      if (!box1s.length) continue
      // A payoff or closing-statement interest amount the same lender says is already in its cited Form 1098 box 1.
      const dups = cited.filter((e) => {
        if (typeOf(ctx, e) === '1098' || !/interest/i.test(e.label) || !isNum(e.value)) return false
        const d = ctx.docs[e.document_id]
        return box1s.some((b) => {
          const lender = ctx.docs[b.document_id]
          if (lender.issuer !== d.issuer) return false
          return /reported on (?:the )?(?:\d{4} )?Form 1098/i.test(docText(d)) || /box 1.{0,80}\bincludes\b.{0,80}\b(payoff|prepaid)/i.test(docText(lender))
        })
      })
      if (!dups.length) continue
      const extra = dups.reduce((s, e) => s + (e.value as number), 0)
      const expected = Math.round((line.value - extra) * 100) / 100
      const stake = stakeOf(ctx, line, 'value', line.value, expected)
      const lenders = box1s.filter((b) => dups.some((e) => ctx.docs[e.document_id].issuer === ctx.docs[b.document_id].issuer))
      const evidence = [...dups.map((e) => e.id), ...lenders.map((e) => e.id), ...[...dups, ...lenders].map((e) => pageRef(e.document_id, e.page))]
      out.push({
        id: `chk:CHK-10:${line.key}`,
        check: 'CHK-10',
        family: 'cross_document',
        title: `${line.key} adds ${fmt(extra)} of interest that the lender's Form 1098 already includes`,
        why: `${dups.map((e) => `${e.document_id} ${e.label} ${fmt(e.value as number)}`).join('; ')} is reported inside box 1 of ${lenders.map((e) => `${e.document_id} (${fmt(e.value as number)})`).join(', ')}, so it is counted twice.`,
        severity: severityOf(stake),
        signal: 'computed',
        claims: [line.key],
        evidence,
        expected,
        actual: line.value,
        stake,
        knownSince: latestKnown(ctx, evidence),
        fix: { act: 'adjust', target: line.key, field: 'value', to: expected, label: `Remove the duplicated ${fmt(extra)}: set to ${fmt(expected)}` },
      })
    }
    return out
  },
}

// ── CHK-11 ──────────────────────────────────────────────────────────────────────────────
const ADDRESS_RE = /\b\d{2,6}(?: [A-Z][a-z]+)+ (?:Dr|Drive|Way|St|Street|Rd|Road|Blvd|Ave|Avenue|Ln|Lane|Ct|Court|Pl|Cir)\b/
const isLevy = (ctx: CheckContext, e: ExtractedValue) =>
  isNum(e.value) && (['property_tax_receipt', 'property_tax_bill'].includes(typeOf(ctx, e) ?? '') || (typeOf(ctx, e) === '1098' && e.field === 'box10'))

const chk11: Check = {
  id: 'CHK-11',
  name: 'Real estate tax apportioned at purchase',
  family: 'cross_document',
  run(ctx) {
    const out: Finding[] = []
    const year = ctx.packet.household.tax_year
    for (const buy of docsOfType(ctx, 'closing_statement_buyer')) {
      if (buy.tax_year !== year) continue
      const credit = ctx.evByDoc[buy.id]?.find((e) => /seller credit/i.test(e.label) && /tax/i.test(e.label) && isNum(e.value))
      const address = ADDRESS_RE.exec(`${buy.title}\n${docText(buy)}`)?.[0]
      if (!credit || !address) continue
      for (const line of Object.values(ctx.lines)) {
        if (!isNum(line.value) || line.sources.includes(credit.id)) continue
        const levies = citedEvs(ctx, line).filter((e) => {
          const d = ctx.docs[e.document_id]
          return isLevy(ctx, e) && `${d.title}\n${docText(d)}`.includes(address)
        })
        if (!levies.length) continue
        // The same levy can appear on the lender's 1098 and the county receipt: count it once.
        const levy = Math.max(...levies.map((e) => e.value as number))
        const expected = Math.round((levy - (credit.value as number)) * 100) / 100
        if (line.value <= expected) continue
        const stake = stakeOf(ctx, line, 'value', line.value, expected)
        const evidence = [credit.id, ...levies.map((e) => e.id), pageRef(buy.id, credit.page)]
        out.push({
          id: `chk:CHK-11:${line.key}`,
          check: 'CHK-11',
          family: 'cross_document',
          title: `${line.key} deducts the full ${fmt(levy)} levy, including the seller's ${fmt(credit.value as number)} share credited at purchase`,
          why: `${buy.id} (purchase of ${address}) shows "${credit.label}" ${fmt(credit.value as number)}: the seller paid that part of the year's tax through the closing. The buyer deducts only the levy less that credit. ${(ctx.citedBy[credit.id] ?? []).length ? '' : `${credit.id} is cited by no line.`}`.trim(),
          severity: severityOf(stake),
          signal: 'computed',
          claims: [line.key],
          evidence,
          expected,
          actual: line.value,
          stake,
          knownSince: latestKnown(ctx, evidence),
          fix: { act: 'adjust', target: line.key, field: 'value', to: expected, label: `Set to levy less seller credit: ${fmt(expected)}` },
        })
      }
    }
    return out
  },
}

// ── CHK-12 ──────────────────────────────────────────────────────────────────────────────
/** The box 4a clause (up to the next ; or .) says checked, and not "not checked" or "unchecked". */
function box4aChecked(text: string): boolean {
  const clause = /\b4a\b([^;.]{0,120})/i.exec(text)?.[1] ?? ''
  return /\bchecked\b/i.test(clause) && !/\b(?:not\s+|un)checked\b/i.test(clause)
}

const chk12: Check = {
  id: 'CHK-12',
  name: 'Charitable noncash value capped by third-party evidence',
  family: 'cross_document',
  run(ctx) {
    const out: Finding[] = []
    for (const d of docsOfType(ctx, '1098-C')) {
      const proceeds = ctx.evByDoc[d.id]?.find((e) => e.field === 'box4c' && isNum(e.value))
      // Box 4c caps the deduction only when box 4a (sold at arm's length) is checked.
      if (!proceeds || !box4aChecked(docText(d))) continue
      const cap = proceeds.value as number
      for (const key of ctx.landedIn[d.id] ?? []) {
        const line = ctx.lines[key]
        if (!isNum(line.value) || line.value <= cap) continue
        const comms = line.sources.filter(isComm)
        const stake = stakeOf(ctx, line, 'value', line.value, cap)
        const evidence = [proceeds.id, ...line.sources.filter((s) => ctx.ev[s]?.document_id === d.id && s !== proceeds.id), pageRef(d.id, proceeds.page), ...comms]
        out.push({
          id: `chk:CHK-12:${key}`,
          check: 'CHK-12',
          family: 'cross_document',
          title: `${key} deducts ${fmt(line.value)}, above the ${fmt(cap)} gross proceeds on ${d.id} (Form 1098-C)`,
          why:
            `${d.issuer} sold the vehicle at arm's length (box 4a), so the deduction is limited to the box 4c gross proceeds.` +
            (comms.length ? ` The ${fmt(line.value)} value comes from ${comms.join(', ')}, a client estimate.` : ''),
          severity: severityOf(stake),
          signal: 'computed',
          claims: [key, ...comms],
          evidence,
          expected: cap,
          actual: line.value,
          stake,
          knownSince: latestKnown(ctx, evidence),
          fix: { act: 'adjust', target: key, field: 'value', to: cap, label: `Limit to the ${d.id} gross proceeds ${fmt(cap)}` },
        })
      }
    }
    return out
  },
}

export const checks: Check[] = [chk06, chk07, chk08, chk09, chk10, chk11, chk12]
