// Extracted reads checked against the text printed on their own page (a port of analysis/oracle.py),
// blank fields stored as zero, and pages or documents the pipeline never read.
import { computeEffect } from '../effects'
import { MASK_RE, type MaskToken, parseToken, sameValue, splitMasked } from '../mask-token'
import type { ExtractedValue } from '../packet-types'
import { unlanded } from './coverage'
import { type Check, type CheckContext, type Finding, latestKnown } from './types'

const SENSITIVE = new Set(['ssn', 'ein', 'account_number'])
const NUMERIC = new Set(['money', 'integer', 'quantity', 'percent'])
const NUM_RE = /\(?-?\$?\d[\d,]*(?:\.\d+)?\)?/g
const AMOUNT_RE = /\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2}/

const round2 = (n: number) => Math.round(n * 100) / 100
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
/** Masked tokens carry the last 4 digits; they must not count as printed numbers. */
const unmaskedText = (s: string) => s.replace(MASK_RE, ' ')

function pageText(ctx: CheckContext, doc: string, page: number): string | undefined {
  return ctx.docs[doc]?.pages.find((p) => p.page === page)?.printed_content
}

function num(s: string): number | null {
  const t = s.replace(/[,$]/g, '').trim()
  const neg = t.startsWith('(') && t.endsWith(')')
  const body = t.replace(/^\(+|\)+$/g, '')
  if (body === '' || Number.isNaN(Number(body))) return null
  return neg ? -Number(body) : Number(body)
}

function numbersOn(text: string): Set<number> {
  const out = new Set<number>()
  for (const m of unmaskedText(text).matchAll(NUM_RE)) {
    const n = num(m[0])
    if (n !== null) out.add(round2(n))
  }
  return out
}

function dateForms(v: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return [v]
  const [, y, mo, d] = m
  return [v, `${mo}/${d}/${y}`, `${Number(mo)}/${Number(d)}/${y}`, `${mo}/${d}/${y.slice(2)}`]
}

/** A masked value is compared token-to-token (equality tag); plain text by normalised substring. */
function textOnPage(v: string, page: string): boolean {
  const tok = parseToken(v)
  if (tok && tok.raw === v) return splitMasked(page).some((p) => typeof p !== 'string' && sameValue(p.raw, v))
  return norm(page).includes(norm(v))
}

/** Why an extracted read is not supported by its page; empty when it is. */
function readMisses(e: ExtractedValue, page: string | undefined): string[] {
  const why: string[] = []
  const v = e.value
  if (page === undefined) why.push('its page is not in the document')
  else if (NUMERIC.has(e.value_type) && typeof v === 'number') {
    const ns = numbersOn(page)
    const forms = e.value_type === 'percent' ? [v, v * 100] : [v]
    if (!forms.some((f) => ns.has(round2(f)) || ns.has(round2(-f)))) why.push('the number is not printed on the page')
  } else if (e.value_type === 'date' && v) {
    if (!dateForms(String(v)).some((f) => page.includes(f))) why.push('the date is not printed on the page')
  } else if (e.value_type !== 'boolean' && v !== null && v !== '') {
    if (!textOnPage(String(v), page)) why.push('the text is not printed on the page')
  }
  if (e.value_type === 'money' && e.text_as_read && typeof v === 'number') {
    const n = num(e.text_as_read)
    if (n !== null && Math.abs(n - v) > 0.005) why.push(`the stored value ${v} differs from the text read "${e.text_as_read}"`)
  }
  return why
}

const shown = (e: ExtractedValue, s: string) => (SENSITIVE.has(e.value_type) && !parseToken(s) ? `•••${s.slice(-4)}` : s)

/** The one identifier of the same shape printed on the page (the likely correct read), if exactly one exists. */
function printedAlternative(v: string, page: string): string | null {
  const tok = parseToken(v)
  if (tok && tok.raw === v) {
    const others = splitMasked(page).filter((p): p is MaskToken => typeof p !== 'string' && p.kind === tok.kind && !sameValue(p.raw, v))
    const eqs = [...new Map(others.map((t) => [t.eq, t.raw])).values()]
    return eqs.length === 1 ? eqs[0] : null
  }
  if (!/\d/.test(v) || v.length < 6) return null
  const shape = [...v].map((c) => (/\d/.test(c) ? '\\d' : /[A-Za-z]/.test(c) ? '[A-Za-z]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')
  const found = new Set([...page.matchAll(new RegExp(`(?<![\\w-])${shape}(?![\\w-])`, 'g'))].map((m) => m[0]))
  found.delete(v)
  return found.size === 1 ? [...found][0] : null
}

const chk01: Check = {
  id: 'CHK-01',
  name: 'Every extracted read is printed on its page',
  family: 'printed_vs_extracted',
  run(ctx) {
    const out: Finding[] = []
    for (const e of ctx.packet.extracted_values) {
      if (!e.text_as_read.trim()) continue // nothing was read: CHK-02 owns blank fields
      const page = pageText(ctx, e.document_id, e.page)
      const why = readMisses(e, page)
      if (!why.length) continue
      const cited = ctx.citedBy[e.id] ?? []
      const pageRef = `doc:${e.document_id}#page${e.page}`
      const evidence = [e.id, pageRef]
      const f: Finding = {
        id: `chk:CHK-01:${e.id}`,
        check: 'CHK-01',
        family: 'printed_vs_extracted',
        title: `${e.label} read as "${shown(e, e.text_as_read)}" is not on ${e.document_id} page ${e.page}`,
        why:
          `Compared the extracted read with the text printed on its page: ${why.join('; ')}. Read at confidence ${e.confidence}. ` +
          (cited.length
            ? `${cited.join(', ')} ${cited.length === 1 ? 'uses' : 'use'} it, so the return rests on a value the document does not show; confidence does not clear this.`
            : 'No return line uses it.'),
        severity: cited.length ? 'warning' : e.value === 0 ? 'info' : 'warning',
        signal: 'computed',
        claims: cited.length ? cited : [e.document_id],
        evidence,
        actual: e.value,
        knownSince: latestKnown(ctx, evidence),
      }
      const alt = typeof e.value === 'string' && page ? printedAlternative(e.value, page) : null
      if (alt) {
        f.expected = alt
        const line = cited.map((k) => ctx.lines[k]).find((l) => l?.label.includes(String(e.value)))
        if (line) {
          f.fix = { act: 'adjust', target: line.key, field: 'label', to: line.label.replace(String(e.value), alt), label: `Use the ${e.label.toLowerCase()} printed on the page` }
        }
      }
      // Stake of the unsupported amount: only when the single citing line is exactly the sum of its reads.
      const line = cited.length === 1 ? ctx.lines[cited[0]] : undefined
      if (line && typeof line.value === 'number' && typeof e.value === 'number' && e.value !== 0) {
        const reads = line.sources.map((s) => ctx.ev[s]?.value).filter((x) => typeof x === 'number')
        if (Math.abs(reads.reduce((a, b) => a + b, 0) - line.value) < 0.5) {
          const eff = computeEffect(ctx.packet, line, 'value', line.value, line.value - e.value)
          if (eff.fed || eff.ca) f.stake = { fed: eff.fed, ca: eff.ca }
        }
      }
      out.push(f)
    }
    return out
  },
}

const chk02: Check = {
  id: 'CHK-02',
  name: 'A blank printed field is missing, never zero',
  family: 'printed_vs_extracted',
  run(ctx) {
    const out: Finding[] = []
    for (const e of ctx.packet.extracted_values) {
      if (e.value !== 0 || e.text_as_read.trim() !== '') continue
      const page = pageText(ctx, e.document_id, e.page)
      const cited = ctx.citedBy[e.id] ?? []
      const evidence = [e.id, `doc:${e.document_id}#page${e.page}`]
      const notReported = page && /not reported/i.test(page) ? ' The page prints "not reported" for it.' : ''
      out.push({
        id: `chk:CHK-02:${e.id}`,
        check: 'CHK-02',
        family: 'printed_vs_extracted',
        title: `${e.label} is blank on ${e.document_id} page ${e.page} but was stored as 0`,
        why:
          `Nothing was read for this field (empty text), yet the stored value is 0.${notReported} A blank field is missing data, not zero. ` +
          (cited.length
            ? `${cited.join(', ')} ${cited.length === 1 ? 'uses' : 'use'} the 0 as if it were printed; it stays open until a source for the real amount is attached or the assumption is recorded.`
            : 'No return line uses it.'),
        severity: cited.length ? 'high' : 'warning',
        signal: 'computed',
        claims: cited.length ? cited : [e.document_id],
        evidence,
        expected: null,
        actual: 0,
        knownSince: latestKnown(ctx, evidence),
      })
    }
    return out
  },
}

const chk03: Check = {
  id: 'CHK-03',
  name: 'Every page with amounts was read, or says where its content went',
  family: 'printed_vs_extracted',
  run(ctx) {
    const out: Finding[] = []
    const latest = ctx.packet.return_versions[ctx.packet.return_versions.length - 1]
    // A used document that was never extracted lands nowhere; this finding says why, so CHK-48 leaves it here.
    const unused = new Map(unlanded(ctx).map((u) => [u.doc.id, u]))
    for (const d of ctx.packet.documents) {
      const { status, reason } = d.extraction
      const superseded = latest.documents_superseded.includes(d.id)
      if (status === 'partial') {
        const readPages = new Set((ctx.evByDoc[d.id] ?? []).map((e) => e.page))
        for (const pg of d.pages) {
          if (readPages.has(pg.page) || !AMOUNT_RE.test(unmaskedText(pg.printed_content))) continue
          const ref = `doc:${d.id}#page${pg.page}`
          out.push({
            id: `chk:CHK-03:${d.id}#page${pg.page}`,
            check: 'CHK-03',
            family: 'printed_vs_extracted',
            title: `${d.id} page ${pg.page} prints amounts that were never extracted`,
            why:
              `${d.title}: extraction is partial${reason ? ` ("${reason}")` : ''}. The page prints amounts but no value was read from it, so nothing on it can reach the return.` +
              (superseded ? ' The document is superseded in the current version, so this is lineage only.' : ''),
            severity: superseded ? 'info' : 'warning',
            signal: 'computed',
            claims: [d.id],
            evidence: [ref],
            knownSince: latestKnown(ctx, [d.id]),
            fix: superseded ? undefined : { act: 'dispose', target: ref, disposition: 'requested', label: `Request extraction of page ${pg.page}` },
          })
        }
      } else if (status === 'not_extracted') {
        const structured = /reproduced as structured data/i.test(reason ?? '')
        const used = unused.get(d.id)
        out.push({
          id: `chk:CHK-03:${d.id}`,
          check: 'CHK-03',
          family: 'printed_vs_extracted',
          title: `${d.id} was not extracted (${d.page_count} page${d.page_count === 1 ? '' : 's'})`,
          why:
            `${d.title}: ${(reason ?? 'no reason recorded').replace(/\.$/, '')}. ` +
            (structured
              ? 'Its content is available as structured packet data; confirm that copy against the pages.'
              : 'Only a summary exists, so amounts on its pages are not available to any check.') +
            (used ? ` ${latest.version} lists it as used, yet no line cites it; record its disposition.` : ''),
          severity: structured && (!used || used.support) ? 'info' : 'warning',
          signal: 'computed',
          claims: [d.id],
          evidence: [d.id],
          knownSince: latestKnown(ctx, [d.id]),
          fix: used?.support ? { act: 'dispose', target: d.id, disposition: 'informational', label: 'Mark as support only' } : undefined,
        })
      }
    }
    return out
  },
}

export const checks: Check[] = [chk01, chk02, chk03]
