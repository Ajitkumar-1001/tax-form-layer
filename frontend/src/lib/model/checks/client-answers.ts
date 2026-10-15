// Client answers vs documents: questionnaire answers the documents contradict, a deduction the client's
// own answer rules out, lines that rest only on what the client said (or on nothing), and client
// messages and calls that arrived after a version was computed and changed nothing.
import { computeEffect, effectSpec, needsPartner } from '../effects'
import { refKind } from '../ids'
import type { ExtractedValue, ReturnLine } from '../packet-types'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const snippet = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const cites = (sources: string[], id: string) => sources.some((s) => s === id || s.startsWith(`${id}#`))

/** The contradicting ref that entered the file first. */
const firstKnown = (ctx: CheckContext, refs: string[]) => [...refs].sort((a, b) => ctx.knownAt(a).localeCompare(ctx.knownAt(b)))[0]

// ── CHK-21 ──────────────────────────────────────────────────────────────────────────────
const DENIES = /^\s*(no|none)\b|\b(didn't|did not|never)\b[^.]*\bsell/i
/** A bare yes/no answer is read exactly; anything longer is read from its wording, which can misfire. */
const BARE_NO = /^\s*(no|none)\s*\.?\s*$/i
const MISFIRE = ' The answer is read as a denial from its wording; that reading can misfire.'

/** Documents whose sales landed on Form 8949 lines, by document type. */
function salesOn(ctx: CheckContext, types: string[]): { lines: number; docs: string[] } {
  const docs = new Set<string>()
  let lines = 0
  for (const line of Object.values(ctx.lines)) {
    if (line.form !== 'F8949') continue
    const ds = line.sources.map((s) => ctx.ev[s]?.document_id).filter((d): d is string => !!d && types.includes(ctx.docs[d]?.document_type))
    if (!ds.length) continue
    lines++
    ds.forEach((d) => docs.add(d))
  }
  return { lines, docs: [...docs].sort() }
}

const chk21: Check = {
  id: 'CHK-21',
  name: 'Questionnaire answers contradicted by documents',
  family: 'client_answer_vs_document',
  run(ctx) {
    const out: Finding[] = []
    const year = ctx.packet.household.tax_year
    const add = (qaId: string, title: string, why: string, evidence: string[], decidingDocs: string[]) => {
      const exact = BARE_NO.test(ctx.packet.client.questionnaire.find((q) => q.id === qaId)?.answer ?? '')
      // Known once the answer and the earliest contradicting document are both in the file; that one is the ref.
      const first = firstKnown(ctx, decidingDocs)
      out.push({
        id: `chk:CHK-21:${qaId}`,
        check: 'CHK-21',
        family: 'client_answer_vs_document',
        title,
        why: `${why} Documents govern; the answer must not drive a line.${exact ? '' : MISFIRE}`,
        severity: 'warning',
        signal: exact ? 'computed' : 'heuristic',
        claims: [qaId],
        evidence: [qaId, ...evidence],
        knownSince: latestKnown(ctx, [qaId, first]),
        fix: {
          act: 'dispose', target: qaId, disposition: 'contradicted_by', ref: first,
          label: `Mark as contradicted by ${decidingDocs.slice(0, 3).map((r) => (r.startsWith('py:') ? 'the 2024 return' : r)).join(', ')}`,
        },
      })
    }

    for (const q of ctx.packet.client.questionnaire) {
      if (/\bsell\b.*\b(stocks?|bonds?|mutual funds?|investments?)\b/i.test(q.question) && DENIES.test(q.answer)) {
        const s = salesOn(ctx, ['1099-B', '1099-composite'])
        if (s.lines) add(q.id, `Client answered "${snippet(q.answer, 40)}" to selling investments, but ${s.docs.join(', ')} report${s.docs.length === 1 ? 's' : ''} ${s.lines} sales`, `${q.id} asks "${q.question}"; the broker statements list ${s.lines} lots sold in ${year}, all on Form 8949.`, s.docs, s.docs)
      } else if (/crypto|digital asset/i.test(q.question) && DENIES.test(q.answer)) {
        const s = salesOn(ctx, ['1099-DA'])
        if (s.lines) add(q.id, `Client says they did not really sell digital assets, but ${s.docs.join(', ')} report${s.docs.length === 1 ? 's' : ''} ${s.lines} dispositions`, `${q.id}: "${q.answer}" The Form 1099-DA lists ${s.lines} sales in ${year}, all on Form 8949.`, s.docs, s.docs)
      } else if (/\bIRA\b/.test(q.question) && /prior basis[^.]*\b(none|no|zero)\b/i.test(q.answer)) {
        const py = ctx.packet.prior_years.return_2024
        const carried = Object.entries(py.line_labels).find(([k, label]) => /basis carried/i.test(label) && isNum(py.lines[k]) && (py.lines[k] as number) > 0)
        if (!carried) continue
        const amount = py.lines[carried[0]] as number
        const pyRef = `py:/return_2024/lines/${carried[0]}`
        const forms5498: ExtractedValue[] = ctx.packet.documents
          .filter((d) => d.document_type === '5498' && d.tax_year < year)
          .flatMap((d) => (ctx.evByDoc[d.id] ?? []).filter((e) => e.field === 'box1' && isNum(e.value)))
        add(q.id, `Client says there is no prior IRA basis, but the 2024 return carried ${fmt(amount)} of basis into ${year}`, `${q.id}: "${snippet(q.answer, 120)}" The 2024 Form 8606 (${carried[1]}) shows ${fmt(amount)}${forms5498.length ? `, and ${forms5498.map((e) => `${e.document_id} box 1 ${fmt(e.value as number)}`).join(', ')} confirms the prior-year contribution` : ''}.`, [pyRef, ...forms5498.map((e) => e.id)], [pyRef, ...forms5498.map((e) => e.document_id)])
      }
    }
    return out
  },
}

// ── CHK-23 ──────────────────────────────────────────────────────────────────────────────
const SE_HEALTH = 'Sch1.17'

const chk23: Check = {
  id: 'CHK-23',
  name: 'SE health insurance while spouse employer coverage was available',
  family: 'client_answer_vs_document',
  run(ctx) {
    const line = ctx.lines[SE_HEALTH]
    if (!line || !isNum(line.value) || line.value <= 0) return []
    const answer = ctx.packet.client.questionnaire.find((q) => /\beligible\b.*\b(coverage|plan)\b/i.test(q.question) && /^\s*yes\b/i.test(q.answer))
    if (!answer) return []
    // Corroboration: employer health coverage on W-2s (box 12 DD) and the prior-year note on this line.
    const dd = ctx.packet.extracted_values.filter((e) => /box12_DD$/i.test(e.field) && ctx.docs[e.document_id]?.document_type === 'W-2')
    const pyNote = ctx.packet.prior_years.return_2024.notes[SE_HEALTH]
    const evidence = [answer.id, ...line.sources, ...dd.map((e) => e.id), ...(pyNote ? [`py:/return_2024/notes/${SE_HEALTH}`] : [])]
    const e = computeEffect(ctx.packet, line, 'value', line.value, 0)
    const stake = { fed: e.fed, ca: e.ca }
    return [{
      id: `chk:CHK-23:${SE_HEALTH}`,
      check: 'CHK-23',
      family: 'client_answer_vs_document',
      title: `Self-employed health insurance of ${fmt(line.value)} is deducted although the client says spouse employer coverage was available`,
      why:
        `No deduction is allowed for a month in which the self-employed person was eligible for a subsidized plan of a spouse's employer (IRC §162(l)(2)(B)). ` +
        `${answer.id}: "${snippet(answer.answer, 140)}"` +
        (dd.length ? ` W-2 box 12 DD shows employer coverage (${[...new Set(dd.map((x) => x.document_id))].join(', ')}).` : '') +
        (pyNote ? ` 2024: "${pyNote}"` : '') +
        ' No month-by-month eligibility record exists.',
      severity: needsPartner(stake) ? 'high' : 'warning',
      signal: 'computed',
      claims: [SE_HEALTH, answer.id],
      evidence,
      expected: 0,
      actual: line.value,
      stake,
      knownSince: latestKnown(ctx, [answer.id, ...line.sources]),
      fix: { act: 'decide', target: SE_HEALTH, label: 'Decide eligibility month by month (IRC §162(l)(2)(B))' },
    }]
  },
}

// ── CHK-24 ──────────────────────────────────────────────────────────────────────────────
const CLIENT_KINDS = new Set(['qa', 'msg', 'call', 'household', 'timeline'])

/** An unsourced line that holds an engine default, an engine parameter or a zero, not a claimed amount. Payments stay. */
function engineConstant(ctx: CheckContext, line: ReturnLine): boolean {
  if (/^R-DEFAULT\b/.test(line.rule)) return true
  if (Object.values(ctx.packet.engine_reference.parameters).some((p) => p === line.value)) return true
  return line.value === 0 && effectSpec(line).category !== 'direct'
}

const chk24: Check = {
  id: 'CHK-24',
  name: 'Line provenance: client-only or unsourced lines',
  family: 'client_answer_vs_document',
  run(ctx) {
    const out: Finding[] = []
    for (const line of Object.values(ctx.lines)) {
      const clientOnly = line.sources.length > 0 && line.sources.every((s) => CLIENT_KINDS.has(refKind(s)))
      const unsourced = !line.sources.length && !line.inputs.length && !engineConstant(ctx, line)
      if (!clientOnly && !unsourced) continue
      const money = effectSpec(line).category !== 'none' && isNum(line.value) && Math.abs(line.value) > 1000
      const shown = isNum(line.value) ? fmt(line.value) : String(line.value)
      const comms = line.sources.filter((s) => /^(qa|msg|call)-/.test(s))
      out.push({
        id: `chk:CHK-24:${line.key}`,
        check: 'CHK-24',
        family: 'client_answer_vs_document',
        title: clientOnly
          ? `${line.label} (${line.key}, ${shown}) rests only on ${line.sources.join(', ')}`
          : `${line.label} (${line.key}, ${shown}) has no sources`,
        why: clientOnly
          ? 'No document supports this line: its only sources are client statements or firm events. Get a document, or verify and record why the client statement is enough.'
          : 'The line cites no document, answer or input line, so nothing shows where the value came from.',
        severity: money ? 'warning' : 'info',
        signal: 'computed',
        claims: [line.key, ...comms],
        evidence: line.sources,
        actual: line.value,
        knownSince: latestKnown(ctx, line.sources),
      })
    }
    return out
  },
}

// ── CHK-25 ──────────────────────────────────────────────────────────────────────────────
/** A message worth applying: it states an amount or a percentage, or delivers something. */
const SUBSTANTIVE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\battach/i

const chk25: Check = {
  id: 'CHK-25',
  name: 'Client information that arrived after a version and changed nothing',
  family: 'client_answer_vs_document',
  run(ctx) {
    const out: Finding[] = []
    const versions = [...ctx.packet.return_versions].sort((a, b) => a.computed_at.localeCompare(b.computed_at))
    const latest = versions[versions.length - 1]
    const comms = [
      ...ctx.packet.client.messages.map((m) => ({ id: m.id, at: m.sent_at, who: m.from, text: m.text })),
      ...ctx.packet.client.call_notes.map((c) => ({ id: c.id, at: c.date, who: c.participants.join(', '), text: c.notes.join(' ') })),
    ]
    for (const c of comms) {
      if (c.at <= versions[0].computed_at || !SUBSTANTIVE.test(c.text)) continue
      const later = versions.filter((v) => v.computed_at > c.at)
      if (later.some((v) => v.lines.some((l) => cites(l.sources, c.id)))) continue
      // A message that delivered a document is applied when a later version uses that document.
      const named = c.text.match(/\bD\d{2}\b/g) ?? []
      if (named.length && later.some((v) => named.some((d) => v.documents_used.includes(d)))) continue
      const before = versions.filter((v) => v.computed_at < c.at).pop()
      out.push({
        id: `chk:CHK-25:${c.id}`,
        check: 'CHK-25',
        family: 'client_answer_vs_document',
        title: later.length
          ? `${c.id} (${c.at.slice(0, 10)}) arrived after ${before?.version}; ${later.map((v) => v.version).join(', ')} cite${later.length === 1 ? 's' : ''} none of it`
          : `${c.id} (${c.at.slice(0, 10)}) arrived after ${latest.version}, the current return; no version reflects it`,
        why: `${c.who}: "${snippet(c.text, 160)}" It states an amount, a percentage or an attachment, so it may change the return. Apply it to the line it affects or record why not. The wording test is a pattern and can misfire.`,
        severity: 'warning',
        signal: 'heuristic',
        claims: [c.id],
        evidence: [c.id],
        knownSince: ctx.knownAt(c.id),
        fix: { act: 'dispose', target: c.id, disposition: 'applied_to', label: 'Apply to the line it changes, or dispose' },
      })
    }

    // The open-ended organizer question is where unsolicited facts land; nothing maps it to a line.
    for (const q of ctx.packet.client.questionnaire) {
      if (!/anything else/i.test(q.question) || /^\s*(no|none|n\/a|nothing)\b/i.test(q.answer)) continue
      if (versions.some((v) => v.lines.some((l) => cites(l.sources, q.id)))) continue
      out.push({
        id: `chk:CHK-25:${q.id}`,
        check: 'CHK-25',
        family: 'client_answer_vs_document',
        title: `The client's answer to "${q.question}" is not reflected in any line`,
        why: `${q.answered_by}: "${snippet(q.answer, 160)}" No version cites it. Any answer other than a plain "no" is treated as new information; that test can misfire.`,
        severity: 'warning',
        signal: 'heuristic',
        claims: [q.id],
        evidence: [q.id],
        knownSince: ctx.knownAt(q.id),
        fix: { act: 'dispose', target: q.id, disposition: 'applied_to', label: 'Apply to the line it changes, or dispose' },
      })
    }
    return out
  },
}

export const checks: Check[] = [chk21, chk23, chk24, chk25]
