// Process controls the packet's own record can be held to: approval gate, due diligence, self-review,
// re-review after late changes, unverified bank details, and extension sizing.
import { computeEffect, effectSpec, needsPartner } from '../effects'
import { MASK_RE, parseToken, sameValue } from '../mask-token'
import type { ReturnLine, ReturnVersion } from '../packet-types'
import { fmt, num, stepRef, withKnown } from './recompute'
import type { Check, CheckContext, Finding } from './types'

const DAY = 86_400_000
const cents = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (iso: string) => iso.slice(0, 10)
const staffName = (ctx: CheckContext, id: string) => ctx.packet.firm.staff.find((s) => s.id === id)?.name ?? id
const deadline = (ctx: CheckContext, re: RegExp) => ctx.packet.firm.deadlines.find((d) => re.test(d.what))?.date
const COMPLETED = /^completed$/i

/** Due-diligence lines (Form 8867) that are not completed while a credit they cover is claimed. */
function openDueDiligence(lines: ReturnLine[]): { line: ReturnLine; credits: string[] }[] {
  const byKey = new Map(lines.map((l) => [l.key, l]))
  return lines
    .filter((l) => l.form === 'F8867' && typeof l.value === 'string' && !COMPLETED.test(l.value))
    .map((l) => ({ line: l, credits: l.inputs.filter((k) => (num(byKey.get(k)?.value) ?? 0) > 0) }))
    .filter((d) => d.credits.length)
}

const approvalGate: Check = {
  id: 'CHK-53',
  name: 'Client approval gate',
  family: 'process_control',
  run(ctx) {
    const { timeline, return_versions: versions, client, firm } = ctx.packet
    const out: Finding[] = []
    for (const t of timeline.filter((e) => /client_approv/.test(e.event))) {
      const base = versions.filter((v) => v.computed_at < t.at).at(-1)
      if (!base) continue
      const reasons: string[] = []
      for (const { line, credits } of openDueDiligence(base.lines)) reasons.push(`${line.key} is '${line.value}' while ${credits.join(', ')} is claimed`)
      const warnings = base.diagnostics.filter((d) => d.severity === 'warning')
      if (warnings.length) reasons.push(`${warnings.length} engine warnings were open on ${base.version} (${warnings.map((d) => d.code).join(', ')})`)
      const late = [
        ...client.messages.filter((m) => m.sent_at > base.computed_at && m.sent_at < t.at && !t.refs.includes(m.id)).map((m) => m.id),
        ...Object.values(ctx.docs).filter((d) => d.received_at > base.computed_at && d.received_at < t.at).map((d) => d.id),
      ]
      if (late.length) reasons.push(`${late.join(', ')} arrived after ${base.version} was computed and no version reflects them`)
      const signers = [firm.assignment_at_start.reviewer, firm.assignment_at_start.partner]
      const signed = timeline.some((e) => e.at < t.at && e.actor && signers.includes(e.actor) && /review|sign/i.test(e.event))
      if (!signed) reasons.push('no reviewer or partner sign-off is on record')
      if (!reasons.length) continue
      out.push(withKnown(ctx, {
        id: `chk:CHK-53:${t.id}`, check: 'CHK-53', family: 'process_control', severity: 'high', signal: 'computed',
        title: `The client approved and signed on ${day(t.at)} while required steps were open`,
        why: `Measured against ${base.version}, the last version before the approval: ${reasons.join('; ')}. That approval cannot support filing; a new one must follow the open items.`,
        claims: [stepRef(ctx, /client approval/i), ...late.filter((id) => ctx.claims[id]?.kind === 'comm')],
        evidence: [`timeline:${t.id}`, base.version, ...late],
        fix: { act: 'decide', target: stepRef(ctx, /client approval/i), label: `Record that the ${day(t.at)} approval cannot be relied on for filing` },
      }))
    }
    return out
  },
}

const dueDiligence: Check = {
  id: 'CHK-54',
  name: 'Due diligence is completed for the credits claimed',
  family: 'process_control',
  run(ctx) {
    const out: Finding[] = []
    for (const { line, credits } of openDueDiligence(Object.values(ctx.lines))) {
      const versions = ctx.packet.return_versions.filter((v) => openDueDiligence(v.lines).some((d) => d.line.key === line.key)).map((v) => v.version)
      const history = credits.map((k) => `${k} ${versions.map((v) => fmt(num(ctx.linesByVersion[v][k]?.value) ?? 0)).join(' / ')}`).join('; ')
      const diags = Object.values(ctx.claims).filter((c) => c.kind === 'diag' && c.sources.includes(line.key)).map((c) => c.id)
      out.push(withKnown(ctx, {
        id: `chk:CHK-54:${line.key}`, check: 'CHK-54', family: 'process_control', severity: 'high', signal: 'computed',
        title: `Due diligence (${line.form}) is '${line.value}' while credits are claimed`,
        why: `${history} in ${versions.join(' / ')}, with ${line.key} not completed in each. The firm requires documented due diligence for these credits before approval: each dependent's SSN agreed to a document, age from a verified birth date, and student status agreed to enrollment records.`,
        claims: [line.key, ...credits, stepRef(ctx, /due diligence/i), ...diags],
        evidence: versions,
        fix: { act: 'decide', target: line.key, label: 'Complete the due-diligence checklist' },
      }))
    }
    return out
  },
}

const noSelfReview: Check = {
  id: 'CHK-55',
  name: 'A person never reviews what they prepared',
  family: 'process_control',
  run(ctx) {
    const out: Finding[] = []
    const { reviewer, partner } = ctx.packet.firm.assignment_at_start
    for (const t of ctx.packet.timeline) {
      if (!t.actor) continue
      const produced = ctx.citedBy[`timeline:${t.id}`] ?? []
      const what = t.event.replaceAll('_', ' ')
      const role = t.actor === reviewer ? 'reviewer' : t.actor === partner ? 'partner' : null
      if (role && (produced.length || /extension|efile|filed/.test(t.event))) {
        out.push(withKnown(ctx, {
          id: `chk:CHK-55:${t.id}`, check: 'CHK-55', family: 'process_control', severity: 'high', signal: 'computed',
          title: `${staffName(ctx, t.actor)} (${t.actor}), the assigned ${role}, prepared "${what}" on ${day(t.at)}`,
          why: `${produced.length ? `It produced ${produced.join(', ')}. ` : ''}A person may not review or sign off on work they prepared, so this work needs a ${role} other than ${t.actor}.`,
          claims: [...produced, stepRef(ctx, role === 'reviewer' ? /reviewer sign-off/i : /partner sign-off/i)],
          evidence: [`timeline:${t.id}`],
        }))
      }
      const staff = ctx.packet.firm.staff.find((s) => s.id === t.actor)
      if (staff && staff.active_from > day(t.at)) {
        out.push(withKnown(ctx, {
          id: `chk:CHK-55:${t.id}:inactive`, check: 'CHK-55', family: 'process_control', severity: 'warning', signal: 'computed',
          title: `${staff.name} (${staff.id}) acted on ${day(t.at)}, before being active (${staff.active_from})`,
          why: `"${what}" was recorded by someone not yet active at the firm.`,
          claims: produced.length ? produced : [stepRef(ctx, /engagement letter/i)],
          evidence: [`timeline:${t.id}`],
        }))
      }
    }
    return out
  },
}

/**
 * Tax effect of one changed line. Lines the rate table cannot price pass their change down to the
 * lines they alone feed, until a priced line is reached.
 */
function priceRoot(ctx: CheckContext, v: ReturnVersion, root: string): { fed: number; ca: number; estimated: boolean } {
  const lines = ctx.linesByVersion[v.version]
  const changed = new Map(v.changes_from_previous.map((c) => [c.key, c]))
  const users = new Map<string, string[]>()
  for (const l of v.lines) for (const i of l.inputs) users.set(i, [...(users.get(i) ?? []), l.key])
  const delta = (k: string) => {
    const c = changed.get(k)
    const from = c?.old === undefined ? 0 : num(c.old)
    const to = c?.new === undefined ? 0 : num(c.new)
    return from === null || to === null ? null : { from, to }
  }
  let fed = 0
  let ca = 0
  let fedPriced = false
  let priced = false // only a California-only line can be priced while fedPriced stays false
  const queue = [root]
  const seen = new Set<string>()
  while (queue.length) {
    const k = queue.shift()!
    const d = delta(k)
    if (seen.has(k) || !lines[k] || !d) continue
    seen.add(k)
    const e = computeEffect(ctx.packet, lines[k], 'value', d.from, d.to)
    if (e.basis !== 'none') {
      fed += e.fed
      ca += e.ca
      fedPriced ||= e.category !== 'ca_source_income'
      priced = true
      continue
    }
    for (const u of users.get(k) ?? []) if (lines[u].inputs.filter((i) => changed.has(i)).length === 1) queue.push(u)
  }
  const d = delta(root)
  if (fedPriced || lines[root]?.jurisdiction !== 'federal' || !d) return { fed, ca, estimated: false }
  // Nothing on the federal side could be priced: estimate the change as ordinary income.
  const rate = ctx.packet.return_versions[ctx.packet.return_versions.length - 1].tax_effect_rates.ordinary_income
  return { fed: Math.round((d.to - d.from) * rate.federal_per_dollar), ca: priced ? ca : Math.round((d.to - d.from) * rate.california_per_dollar), estimated: true }
}

const changesAfterReview: Check = {
  id: 'CHK-56',
  name: 'Changes after review re-open review; large ones route to the partner',
  family: 'process_control',
  run(ctx) {
    const reviewed = deadline(ctx, /review complete/i)
    if (!reviewed) return []
    const out: Finding[] = []
    for (const v of ctx.packet.return_versions.filter((x) => day(x.computed_at) > reviewed && x.changes_from_previous.length)) {
      const lines = ctx.linesByVersion[v.version]
      const changed = new Set(v.changes_from_previous.map((c) => c.key))
      const roots = v.changes_from_previous.filter((c) => !(lines[c.key]?.inputs ?? []).some((i) => changed.has(i)))
      const lateDocs = Object.values(ctx.docs).filter((d) => day(d.received_at) > reviewed && d.received_at <= v.computed_at).map((d) => d.id)
      out.push(withKnown(ctx, {
        id: `chk:CHK-56:${v.version}`, check: 'CHK-56', family: 'process_control', severity: 'warning', signal: 'computed',
        title: `${v.version} changed ${changed.size} lines after the internal review-complete date (${reviewed})`,
        why: `Computed ${day(v.computed_at)}${lateDocs.length ? ` on documents received after review (${lateDocs.join(', ')})` : ''}. ${roots.length} root changes: ${roots.map((c) => c.key).join(', ')}. Every changed line needs a new reviewer sign-off.`,
        claims: [stepRef(ctx, /reviewer sign-off/i), ...roots.map((c) => c.key)],
        evidence: [v.version],
      }))
      for (const c of roots) {
        const line = lines[c.key]
        // A payment changes the balance due, not the tax: it is not an adjustment the partner rule covers.
        if (!line || effectSpec(line).hint?.startsWith('Payment')) continue
        const e = priceRoot(ctx, v, c.key)
        if (!needsPartner(e)) continue
        out.push(withKnown(ctx, {
          id: `chk:CHK-56:${c.key}`, check: 'CHK-56', family: 'process_control', severity: 'warning', signal: e.estimated ? 'heuristic' : 'computed',
          title: `${c.key} changed after review (${c.old === undefined ? 'new' : fmt(Number(c.old))} → ${c.new === undefined ? 'removed' : fmt(Number(c.new))}); its effect needs partner sign-off`,
          why: `Tax effect fed ${fmt(e.fed)}, CA ${fmt(e.ca)}${e.estimated ? ', estimated at the ordinary-income rate because no rate category maps to this line' : ''}. Any change with an effect over 1,000 needs a partner sign-off from a partner who did not prepare it.`,
          claims: [c.key, stepRef(ctx, /partner sign-off/i)],
          evidence: [v.version, ...line.sources.filter((s) => !s.startsWith('ref:'))],
        }))
      }
    }
    return out
  },
}

const bankAccount: Check = {
  id: 'CHK-59',
  name: 'Refund and debit bank details are verified from a document',
  family: 'process_control',
  run(ctx) {
    const bank = ctx.packet.household.bank_account_for_refund_or_payment
    const values = [bank.routing, bank.account].filter(Boolean)
    // Works on raw and masked packets: the masker swaps the same value for the same token everywhere.
    const inText = (text: string, v: string) => {
      const t = parseToken(v)
      return t ? [...text.matchAll(MASK_RE)].some((m) => m[3] === t.eq) : text.includes(v)
    }
    const onDoc = Object.values(ctx.docs).some((d) => d.pages.some((p) => values.some((v) => inText(p.printed_content, v))))
      || ctx.packet.extracted_values.some((e) => values.some((v) => sameValue(e.value, v)))
    if (onDoc) return []
    const answers = ctx.packet.client.questionnaire.filter((q) => bank.bank && q.answer.includes(bank.bank)).map((q) => q.id)
    return [withKnown(ctx, {
      id: 'chk:CHK-59:household#bank_account', check: 'CHK-59', family: 'process_control', severity: 'warning', signal: 'computed',
      title: `The refund and debit account (${bank.bank}) rests only on the organizer`,
      why: `No document in the file prints its routing or account number${answers.length ? `; the only other mention is ${answers.join(', ')}` : ''}. A wrong number sends the refund or the debit to someone else.`,
      claims: ['household#bank_account', ...answers],
      evidence: ['household', ...answers],
      fix: { act: 'note', target: 'household#bank_account', label: 'Ask the client for a voided check or bank letter, then verify against it' },
    })]
  },
}

const extensionSizing: Check = {
  id: 'CHK-60',
  name: 'Extension sizing and late-payment interest from agency data',
  family: 'process_control',
  run(ctx) {
    const { what_if, tax_agency_records, timeline, post_filing_rates } = ctx.packet
    const ext = what_if.extension
    const baseLines = ctx.linesByVersion[ext.based_on_version]
    const paid = num(ext.federal.paid_with_form_4868)
    const tax = num(ext.federal.estimated_total_tax)
    const transcripts = tax_agency_records.irs_account_transcript_2025
    const ti = transcripts.reduce((best, t, i) => (t.as_of <= day(ext.computed_at) && (best < 0 || t.as_of > transcripts[best].as_of) ? i : best), -1)
    if (!baseLines || paid === null || tax === null || ti < 0) return []
    const estimates = transcripts[ti].transactions
      .filter((x) => x.code === '670' && typeof x.amount === 'number' && !/extension|4868/i.test(x.description))
      .reduce((a, x) => a + (x.amount as number), 0)
    const at = (lines: Record<string, ReturnLine>, k: string) => num(lines[k]?.value) ?? 0
    const extEvent = timeline.find((t) => /extension/.test(t.event))
    const extLines = extEvent ? (ctx.citedBy[`timeline:${extEvent.id}`] ?? []) : []
    const transcriptRef = `agency:/irs_account_transcript_2025/${ti}`
    const paymentsStep = stepRef(ctx, /estimated payments/i)
    const out: Finding[] = []

    const need = tax - at(baseLines, 'F1040.25d') - estimates - at(baseLines, 'F1040.31')
    const sized = Math.ceil(need / 500) * 500
    if (sized > paid) {
      const base = ctx.packet.return_versions.find((v) => v.version === ext.based_on_version)
      const open = (base?.diagnostics ?? []).filter((d) => d.severity === 'warning' && /EXPECTED|BASIS/.test(d.code)).map((d) => d.code)
      out.push(withKnown(ctx, {
        id: 'chk:CHK-60:extension', check: 'CHK-60', family: 'process_control', severity: 'warning', signal: 'computed',
        title: `The extension paid ${fmt(paid)}; sized from the IRS transcript it should have been ${fmt(sized)}`,
        why:
          `${ext.based_on_version} total tax ${fmt(tax)} − withholding ${fmt(at(baseLines, 'F1040.25d'))} − estimates on the transcript ${fmt(estimates)} − refundable credits ${fmt(at(baseLines, 'F1040.31'))} = ${fmt(need)}, ` +
          `rounded up to the next 500. The engine used payments of ${fmt(num(ext.federal.payments) ?? 0)}, more than the transcript shows.` +
          (open.length ? ` No provision was made for open items on ${ext.based_on_version}: ${open.join(', ')}.` : ''),
        claims: [...extLines, paymentsStep],
        evidence: [transcriptRef, ext.based_on_version, ...(extEvent ? [`timeline:${extEvent.id}`] : [])],
        expected: sized, actual: paid,
        fix: { act: 'decide', target: extLines[0] ?? paymentsStep, label: 'Record the client communication about the shortfall, interest and penalty' },
      }))
    }

    // Balance paid after the original due date accrues interest and the failure-to-pay penalty.
    const due = deadline(ctx, /original due date/i)
    const paidEvent = timeline.find((t) => /balance_paid/.test(t.event))
    const interestRate = num(post_filing_rates.irs_underpayment_interest_rate_annual)
    const ftpRate = num(post_filing_rates.irs_failure_to_pay_penalty_per_month)
    if (due && paidEvent && day(paidEvent.at) > due && interestRate !== null && ftpRate !== null) {
      const balance = at(ctx.lines, 'F1040.24') - at(ctx.lines, 'F1040.25d') - estimates - at(ctx.lines, 'F1040.31')
      if (balance > 0) {
        const paidOn = day(paidEvent.at)
        const days = Math.round((Date.parse(paidOn) - Date.parse(due)) / DAY)
        const [y1, m1, d1] = due.split('-').map(Number)
        const [y2, m2, d2] = paidOn.split('-').map(Number)
        const months = (y2 - y1) * 12 + (m2 - m1) + (d2 > d1 ? 1 : 0) // part months count as whole
        const interest = Math.round(balance * interestRate * (days / 365) * 100) / 100
        const ftp = Math.round(balance * ftpRate * months * 100) / 100
        const last = ctx.packet.return_versions[ctx.packet.return_versions.length - 1].version
        out.push(withKnown(ctx, {
          id: 'chk:CHK-60:late-payment', check: 'CHK-60', family: 'process_control', severity: 'warning', signal: 'computed',
          title: `The ${fmt(balance)} balance was paid ${days} days late; about ${cents(interest)} interest and ${cents(ftp)} failure-to-pay are not in the workpaper`,
          why:
            `On ${last} with the transcript's estimates: total tax ${fmt(at(ctx.lines, 'F1040.24'))} − withholding ${fmt(at(ctx.lines, 'F1040.25d'))} − estimates ${fmt(estimates)} − ` +
            `extension and credits ${fmt(at(ctx.lines, 'F1040.31'))} = ${fmt(balance)}, paid ${paidOn} (due ${due}). Interest ${fmt(interestRate * 100)}% × ${days}/365; ` +
            `failure-to-pay ${fmt(ftpRate * 100)}% × ${months} months. An extension of time to file is not an extension of time to pay.`,
          claims: ['F1040.37', paymentsStep],
          evidence: [`timeline:${paidEvent.id}`, transcriptRef, last],
          fix: { act: 'decide', target: 'F1040.37', label: 'Record the interest and penalty communicated to the client' },
        }))
      }
    }
    return out
  },
}

export const checks: Check[] = [approvalGate, dueDiligence, noSelfReview, changesAfterReview, bankAccount, extensionSizing]
