// Pure half of the notice room (spec §3.7): the IRS Letter 566, its items mapped to claims, and the
// preconditions for answering it (CHK-20 is not in code, so they are computed here from packet facts).
import type { Act } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import type { Val } from '@/lib/model/claims'
import type { ClaimStatus, State } from '@/lib/model/state'

type Notice = Model['packet']['tax_agency_records']['notices'][number]

export interface NoticeRef {
  ref: string // agency:/notices/<i>
  notice: Notice
  knownAt: string
  received: boolean
}

/** The examination notice (the one with items under examination), and whether the clock has reached it. */
export function findNotice(model: Model, clock: string): NoticeRef | null {
  const list = model.packet.tax_agency_records.notices
  const i = list.findIndex((n) => (n.items_under_examination ?? []).length > 0)
  if (i < 0) return null
  const ref = `agency:/notices/${i}`
  const knownAt = model.knownAt(ref)
  return { ref, notice: list[i], knownAt, received: knownAt <= clock }
}

/** Earlier notices already in the file (e.g. the resolved 2023 CP2000), for context. */
export function earlierNotices(model: Model, clock: string, except: string | null): { ref: string; notice: Notice }[] {
  return model.packet.tax_agency_records.notices
    .map((notice, i) => ({ ref: `agency:/notices/${i}`, notice }))
    .filter((n) => n.ref !== except && model.knownAt(n.ref) <= clock)
}

export interface MappedItem {
  n: number
  text: string
  claims: string[]
}

// Standards patterns: what each kind of examination item points at on this return.
const PATTERNS: [RegExp, (model: Model) => string[]][] = [
  [/charitable|8283|schedule a/i, (m) => ['SchA.12', ...Object.keys(m.lines).filter((k) => k.startsWith('F8283.'))]],
  [/gross receipts|schedule c/i, () => ['SchC.1']],
]

export function mapItems(model: Model, notice: Notice): MappedItem[] {
  return (notice.items_under_examination ?? []).map((raw, i) => {
    const text = String(raw)
    const claims = PATTERNS.filter(([re]) => re.test(text)).flatMap(([, f]) => f(model)).filter((id) => model.claims[id])
    return { n: i + 1, text, claims: [...new Set(claims)] }
  })
}

export interface ClaimRecord {
  id: string
  label: string
  original: Val
  effective: Val
  status: ClaimStatus
  sources: string[]
  findings: { id: string; title: string; status: 'open' | 'resolved'; visible: boolean }[]
  acts: Act[]
}

/** Everything about one claim that a response needs: value as filed, how it was built, findings and acts. */
export function claimRecord(model: Model, state: State, id: string): ClaimRecord {
  const c = state.claims[id]
  const bySeq = new Map(state.acts.map((a) => [a.seq, a]))
  return {
    id, label: model.claims[id]?.label ?? id, original: c?.original ?? null, effective: c?.effective ?? null, status: c?.status ?? 'unreviewed',
    sources: model.claims[id]?.sources ?? [],
    findings: (model.findingsByClaim[id] ?? []).map((fid) => ({
      id: fid, title: model.findingsById[fid].title, status: state.findings[fid]?.status ?? 'open', visible: state.findings[fid]?.visible ?? false,
    })),
    acts: (state.actsByRef[id] ?? []).map((s) => bySeq.get(s)).filter((a): a is Act => !!a && a.type !== 'view_sensitive'),
  }
}

/** One line for an act in the record: its reason, choice or text. */
export function actSummary(a: Act): string {
  const b = a.body as Record<string, unknown>
  const pick = [b.reason, b.choice, b.text, b.disposition, b.method, b.level].find((v) => typeof v === 'string')
  const to = a.type === 'adjust' && b.to !== undefined ? ` → ${String(b.to)}` : ''
  return `${a.type.replaceAll('_', ' ')}${to}${pick ? `: ${String(pick)}` : ''}`
}

export interface Precondition {
  key: string
  ok: boolean
  title: string
  detail: string
  refs: string[]
}

const textOf = (model: Model, doc: string) => (model.docs[doc]?.pages ?? []).map((p) => p.printed_content).join('\n')

/** What must be on file before the firm may answer the notice. */
export function preconditions(model: Model, clock: string, notice: Notice): Precondition[] {
  const p = model.packet
  const poa = p.documents.filter((d) => /2848|power of attorney/i.test(`${d.title} ${d.document_type}`))
  const letter = textOf(model, 'D01')
  const scope = /Scope:[^.]*\./.exec(letter)?.[0] ?? 'D01 states no scope.'
  const covers = /exam|audit|representation/i.test(scope)
  const designeeQa = p.client.questionnaire.find((q) => /discuss your return with the IRS/i.test(q.question))
  const designeeEnds = `${p.household.tax_year + 2}-04-15` // third-party designee authority ends at the next year's due date
  const consent = textOf(model, 'D02')
  const until = /until (\d{2})\/(\d{2})\/(\d{4})/.exec(consent)
  const consentEnds = until ? `${until[3]}-${until[1]}-${until[2]}` : null
  const due = notice.response_due ?? ''
  return [
    {
      key: 'authority', ok: poa.length > 0, refs: poa.map((d) => d.id),
      title: poa.length ? 'Authority to represent is on file' : 'No authority to represent: no Form 2848 in the file',
      detail: poa.length ? `Form 2848: ${poa.map((d) => d.id).join(', ')}.` : 'Both spouses must sign a Form 2848 before the firm can speak for them in the examination.',
    },
    {
      key: 'scope', ok: covers, refs: ['D01'],
      title: covers ? 'The engagement covers examination work' : 'The engagement letter excludes examination work',
      detail: `D01: "${scope}" A new engagement letter for the examination is needed.`,
    },
    {
      key: 'designee', ok: !!designeeQa && clock.slice(0, 10) <= designeeEnds, refs: designeeQa ? [designeeQa.id] : [],
      title: clock.slice(0, 10) <= designeeEnds ? 'Third-party designee authority still runs' : 'Third-party designee authority has lapsed',
      detail: `${designeeQa ? `${designeeQa.id} answered "${designeeQa.answer}". ` : ''}Designee authority on the return ends ${designeeEnds}; it never covers an examination.`,
    },
    {
      key: 'consent', ok: !!consentEnds && consentEnds >= due, refs: ['D02'],
      title: consentEnds && consentEnds >= due ? 'Section 7216 consent runs past the response date' : 'Section 7216 consent does not cover the response date',
      detail: `D02 consent ${consentEnds ? `runs until ${consentEnds}` : 'has no end date'}; the response is due ${due || 'on a date not stated'}.`,
    },
  ]
}
