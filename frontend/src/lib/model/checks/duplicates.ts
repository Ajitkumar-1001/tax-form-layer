// Duplicates: the same income from two documents, a page scanned twice, a document received twice or corrected.
import { computeEffect } from '../effects'
import { jsonPointer } from '../ids'
import { sameValue } from '../mask-token'
import type { PacketDocument, ReturnLine } from '../packet-types'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const fmt = (n: number) => n.toLocaleString('en-US')
const latestVersion = (ctx: CheckContext) => ctx.packet.return_versions[ctx.packet.return_versions.length - 1]

/** The single document a line's extracted reads come from, if there is exactly one. */
function soloDoc(ctx: CheckContext, line: ReturnLine): string | null {
  const docs = new Set(line.sources.flatMap((s) => (ctx.ev[s] ? [ctx.ev[s].document_id] : [])))
  return docs.size === 1 ? [...docs][0] : null
}

const payerFamily = (d: PacketDocument) => d.issuer.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '')

/** Account suffixes printed on the pages a line's reads come from ("account ending 7731"). */
function accountSuffixes(ctx: CheckContext, line: ReturnLine): Set<string> {
  const out = new Set<string>()
  for (const s of line.sources) {
    const e = ctx.ev[s]
    const text = e && ctx.docs[e.document_id]?.pages.find((p) => p.page === e.page)?.printed_content
    for (const m of text?.matchAll(/account (?:ending|number ending|no\.? ending)\s+(\d{4})\b/gi) ?? []) out.add(m[1])
  }
  return out
}

const chk16: Check = {
  id: 'CHK-16',
  name: 'The same income is not reported from two documents',
  family: 'duplicate_or_superseded',
  run(ctx) {
    const payerLines = Object.values(ctx.lines).filter((l) => l.form === 'SchB' && typeof l.value === 'number' && l.value !== 0)
    const payers = payerLines.flatMap((l) => {
      const doc = soloDoc(ctx, l)
      return doc && ctx.docs[doc] ? [{ line: l, doc: ctx.docs[doc] }] : []
    })
    const out: Finding[] = []
    const flagged = new Set<string>()
    for (const [i, a] of payers.entries()) {
      for (const b of payers.slice(i + 1)) {
        if (a.doc.id === b.doc.id || a.line.value !== b.line.value || a.doc.tax_year !== b.doc.tax_year) continue
        const sameFamily = payerFamily(a.doc) !== '' && payerFamily(a.doc) === payerFamily(b.doc)
        const sa = accountSuffixes(ctx, a.line)
        const sharedAccount = [...accountSuffixes(ctx, b.line)].find((s) => sa.has(s))
        if (!sameFamily && !sharedAccount) continue
        // The copy is the line fed by the later-received document.
        const [keep, dup] = a.doc.received_at <= b.doc.received_at ? [a, b] : [b, a]
        if (flagged.has(dup.line.key)) continue
        flagged.add(dup.line.key)
        const amount = dup.line.value as number
        const group = dup.line.key.slice(0, dup.line.key.lastIndexOf('.') + 1)
        const py = ctx.packet.prior_years.return_2024
        const pyCount = Object.keys(py.lines).filter((k) => k.startsWith(group) && (py.line_labels[k] ?? '').toLowerCase().includes(payerFamily(keep.doc))).length
        const effect = computeEffect(ctx.packet, dup.line, 'value', amount, 0)
        const evidence = [...dup.line.sources.filter((s) => ctx.ev[s]), ...keep.line.sources.filter((s) => ctx.ev[s]), dup.doc.id, keep.doc.id]
        out.push({
          id: `chk:CHK-16:${dup.line.key}`,
          check: 'CHK-16',
          family: 'duplicate_or_superseded',
          title: `${dup.line.key} and ${keep.line.key} both report ${fmt(amount)} from ${dup.doc.id} and ${keep.doc.id}`,
          why:
            `Same amount, same tax year and the same payer family (${keep.doc.issuer} / ${dup.doc.issuer}` +
            (sharedAccount ? `; both pages print account ending ${sharedAccount}` : '') +
            '), so this is likely one payment reported on two forms. ' +
            (pyCount ? `The 2024 return had ${pyCount} such line${pyCount === 1 ? '' : 's'} for this payer. ` : '') +
            'Heuristic: a reviewer can record that they are distinct.',
          severity: 'warning',
          signal: 'heuristic',
          claims: [dup.line.key, keep.line.key, dup.doc.id],
          evidence,
          expected: 0,
          actual: amount,
          stake: effect.fed || effect.ca ? { fed: effect.fed, ca: effect.ca } : undefined,
          knownSince: latestKnown(ctx, evidence),
          fix: { act: 'adjust', target: dup.line.key, field: 'value', to: 0, label: `Set ${dup.line.key} to 0 (already in ${keep.line.key})` },
        })
      }
    }
    return out
  },
}

const SCAN_NOTE = /^\s*\([^)]*\)\s*/
const REPEAT_PHRASE = /\b(second scan|rescan(?:ned)?|duplicate (?:page|scan|copy)|copy of (?:page|the))\b/i
const rows = (text: string) => text.replace(SCAN_NOTE, '').split('; ').map((r) => r.trim()).filter(Boolean)

/** Share of the later page's rows that also appear on the earlier page. */
function overlap(a: string[], b: string[]): number {
  const set = new Set(a)
  return b.filter((r) => set.has(r)).length / Math.max(a.length, b.length)
}

/** A line that consumes a page parameter (e.g. miles × mileage rate): its value scaled from the corrected input. */
function scaledDependent(ctx: CheckContext, input: string, from: number, to: number): { line: ReturnLine; to: number } | null {
  for (const key of ctx.claims[input]?.usedBy ?? []) {
    const l = ctx.lines[key]
    if (!l || l.inputs.length !== 1 || typeof l.value !== 'number') continue
    const param = l.sources.find((s) => s.startsWith('ref:param.'))
    const rate = param ? jsonPointer(ctx.packet.engine_reference.parameters, `/${param.slice('ref:param.'.length)}`) : undefined
    if (typeof rate === 'number' && Math.abs(from * rate - l.value) < 1) return { line: l, to: Math.round(to * rate) }
  }
  return null
}

const chk17: Check = {
  id: 'CHK-17',
  name: 'A page scanned twice is counted once',
  family: 'duplicate_or_superseded',
  run(ctx) {
    const out: Finding[] = []
    for (const d of ctx.packet.documents) {
      for (const [j, later] of d.pages.entries()) {
        const lr = rows(later.printed_content)
        const twin = d.pages.slice(0, j).find((earlier) => {
          const sim = overlap(rows(earlier.printed_content), lr)
          return (sim >= 0.9 && lr.length >= 3) || (sim >= 0.5 && REPEAT_PHRASE.test(later.printed_content))
        })
        if (!twin) continue
        const evs = ctx.evByDoc[d.id] ?? []
        const dupEvs = new Set(evs.filter((e) => e.page === later.page).map((e) => e.id))
        const twinEvs = new Set(evs.filter((e) => e.page === twin.page).map((e) => e.id))
        const lines = [...new Set([...dupEvs].flatMap((e) => ctx.citedBy[e] ?? []))]
        const dupRef = `doc:${d.id}#page${later.page}`
        const evidence = [dupRef, `doc:${d.id}#page${twin.page}`, ...[...dupEvs].filter((e) => ctx.citedBy[e])]
        const f: Finding = {
          id: `chk:CHK-17:${d.id}#page${later.page}`,
          check: 'CHK-17',
          family: 'duplicate_or_superseded',
          title: `${d.id} page ${later.page} repeats page ${twin.page}`,
          why:
            `${d.title}: page ${later.page} has the same rows as page ${twin.page}` +
            (REPEAT_PHRASE.test(later.printed_content) ? ' and says on its face that it is a second scan' : '') +
            '. No line may count both pages. ' +
            (lines.length ? `${lines.join(', ')} ${lines.length === 1 ? 'uses' : 'use'} values from both.` : 'No return line uses the repeated page.'),
          severity: lines.length ? 'high' : 'info',
          signal: 'computed',
          claims: lines.length ? lines : [d.id],
          evidence,
          knownSince: latestKnown(ctx, evidence),
        }
        // A line that sums reads from both pages: drop the repeated page's reads.
        const summed = lines.map((k) => ctx.lines[k]).find((l) => {
          if (!l || typeof l.value !== 'number' || !l.sources.some((s) => twinEvs.has(s))) return false
          const reads = l.sources.map((s) => ctx.ev[s]?.value)
          return reads.every((v) => typeof v === 'number') && Math.abs((reads as number[]).reduce((a, b) => a + b, 0) - l.value) < 0.5
        })
        if (summed && typeof summed.value === 'number') {
          const repeated = summed.sources.filter((s) => dupEvs.has(s)).reduce((a, s) => a + (ctx.ev[s].value as number), 0)
          const expected = summed.value - repeated
          const direct = computeEffect(ctx.packet, summed, 'value', summed.value, expected)
          // A line with no tax effect of its own (miles) is corrected through the line that carries the tax (car expense),
          // so the fix, its primary claim and the recorded effect all sit on that line.
          const dep = direct.fed || direct.ca ? null : scaledDependent(ctx, summed.key, summed.value, expected)
          const target = dep ? { line: dep.line, to: dep.to } : { line: summed, to: expected }
          const from = target.line.value as number
          const eff = computeEffect(ctx.packet, target.line, 'value', from, target.to)
          const counted = `page ${later.page} counted once`
          f.claims = [...new Set([target.line.key, summed.key, ...lines])]
          f.expected = target.to
          f.actual = from
          if (dep) f.why += ` ${summed.key} becomes ${fmt(expected)} (${counted}), so ${dep.line.key} becomes ${fmt(dep.to)} (now ${fmt(from)}).`
          f.fix = {
            act: 'adjust', target: target.line.key, field: 'value', to: target.to,
            label: dep ? `Set ${dep.line.key} to ${fmt(dep.to)} (${summed.key} ${fmt(expected)}, ${counted})` : `Set ${summed.key} to ${fmt(expected)} (${counted})`,
          }
          if (eff.fed || eff.ca) f.stake = { fed: eff.fed, ca: eff.ca }
        }
        out.push(f)
      }
    }
    return out
  },
}

/** Field → value map of a document's extracted reads. */
function reads(ctx: CheckContext, doc: string): Map<string, unknown> {
  return new Map((ctx.evByDoc[doc] ?? []).map((e) => [e.field, e.value]))
}

function fieldDiff(a: Map<string, unknown>, b: Map<string, unknown>): { field: string; from: unknown; to: unknown }[] {
  return [...new Set([...a.keys(), ...b.keys()])].filter((f) => !sameValue(a.get(f), b.get(f))).map((f) => ({ field: f, from: a.get(f), to: b.get(f) }))
}

const chk18: Check = {
  id: 'CHK-18',
  name: 'A duplicate or corrected document feeds the return once, with lineage recorded',
  family: 'duplicate_or_superseded',
  run(ctx) {
    const latest = latestVersion(ctx)
    const superseded = new Set(latest.documents_superseded)
    const lands = (id: string) => (ctx.landedIn[id] ?? []).length > 0
    const groups = new Map<string, PacketDocument[]>()
    for (const d of ctx.packet.documents) {
      const k = [d.document_type, d.issuer, d.belongs_to, d.tax_year].join('|')
      groups.set(k, [...(groups.get(k) ?? []), d])
    }
    const out: Finding[] = []
    for (const docs of groups.values()) {
      if (docs.length < 2) continue
      const sorted = [...docs].sort((a, b) => a.received_at.localeCompare(b.received_at))
      for (const [i, later] of sorted.entries()) {
        for (const earlier of sorted.slice(0, i)) {
          const ra = reads(ctx, earlier.id)
          const rb = reads(ctx, later.id)
          const diff = fieldDiff(ra, rb)
          const evidence = [later.id, earlier.id]
          if (later.marked_corrected) {
            const ok = superseded.has(earlier.id) && !lands(earlier.id)
            const changes = diff.slice(0, 8).map((c) => `${c.field} ${String(c.from)} → ${String(c.to)}`).join(', ')
            out.push({
              id: `chk:CHK-18:${earlier.id}`,
              check: 'CHK-18',
              family: 'duplicate_or_superseded',
              title: ok ? `${later.id} (corrected) supersedes ${earlier.id}` : `${earlier.id} is replaced by corrected ${later.id} but still feeds the return`,
              why:
                `${later.title} is marked corrected. ${diff.length} field${diff.length === 1 ? '' : 's'} changed${changes ? `: ${changes}` : ''}. ` +
                (ok
                  ? `${earlier.id} is superseded in ${latest.version} and no line cites it; record the lineage.`
                  : `${earlier.id} must be superseded and no line may cite it (${superseded.has(earlier.id) ? 'superseded' : 'not superseded'}, ${lands(earlier.id) ? 'still cited' : 'not cited'}).`),
              severity: ok ? 'info' : 'high',
              signal: 'computed',
              claims: [earlier.id, later.id],
              evidence,
              knownSince: latestKnown(ctx, evidence),
              fix: { act: 'dispose', target: earlier.id, disposition: 'superseded_by', ref: later.id, label: `Mark ${earlier.id} superseded by ${later.id}` },
            })
          } else if (ra.size > 0 && diff.length === 0 && !superseded.has(later.id)) {
            const both = lands(earlier.id) && lands(later.id)
            out.push({
              id: `chk:CHK-18:${later.id}`,
              check: 'CHK-18',
              family: 'duplicate_or_superseded',
              title: `${later.id} is a second copy of ${earlier.id}`,
              why:
                `Same type, issuer and recipient, and all ${ra.size} extracted fields are identical. ` +
                (both
                  ? 'Both copies feed the return, so its amounts are counted twice.'
                  : `${latest.version} lists ${later.id} as used but not superseded; amounts are counted once, only the lineage is missing.`),
              severity: both ? 'high' : 'warning',
              signal: 'computed',
              claims: [later.id, earlier.id],
              evidence,
              knownSince: latestKnown(ctx, evidence),
              fix: { act: 'dispose', target: later.id, disposition: 'duplicate_of', ref: earlier.id, label: `Mark ${later.id} a duplicate of ${earlier.id}` },
            })
          }
        }
      }
    }
    return out
  },
}

/** Documents CHK-18 speaks for: second copies and originals replaced by a corrected document. */
export function copiedOrReplaced(ctx: CheckContext): Set<string> {
  return new Set(chk18.run(ctx).map((f) => f.claims[0]))
}

export const checks: Check[] = [chk16, chk17, chk18]
