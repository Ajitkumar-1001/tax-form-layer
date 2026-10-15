// Shared vocabulary: areas, ref kinds and when each packet item entered the file.
// Isomorphic (browser + server). Refs follow the packet README's reference_formats verbatim.
import type { Packet } from './packet-types'

export const AREAS = [
  'intake_and_engagement',
  'wages_and_stock_compensation',
  'investments_and_digital_assets',
  'business',
  'rentals_and_sale',
  'pass_throughs_and_basis',
  'deductions_and_credits',
  'california',
  'payments_and_filing',
] as const
export type AreaKey = (typeof AREAS)[number]

export const AREA_LABEL: Record<AreaKey, string> = {
  intake_and_engagement: 'Intake & identity',
  wages_and_stock_compensation: 'Wages & stock comp',
  investments_and_digital_assets: 'Investments & crypto',
  business: 'Business (Sch C)',
  rentals_and_sale: 'Rentals & sale',
  pass_throughs_and_basis: 'K-1s & basis',
  deductions_and_credits: 'Deductions & credits',
  california: 'California split',
  payments_and_filing: 'Payments & filing',
}

const docNum = (id: string) => Number(id.slice(1))
export function areaOfDoc(id: string): AreaKey {
  const n = docNum(id)
  if (n <= 7 || n === 70 || n === 71) return 'intake_and_engagement'
  if ((n >= 8 && n <= 13) || n === 73) return 'wages_and_stock_compensation'
  if (n >= 14 && n <= 27) return 'business'
  if ((n >= 28 && n <= 36) || n === 74) return 'investments_and_digital_assets'
  if (n >= 37 && n <= 40) return 'pass_throughs_and_basis'
  if ((n >= 41 && n <= 45) || (n >= 54 && n <= 66)) return 'deductions_and_credits'
  if (n >= 46 && n <= 53) return 'rentals_and_sale'
  return 'payments_and_filing' // D67-D69, D72
}

export function areaOfLine(key: string, form: string): AreaKey {
  const line = key.slice(form.length + 1)
  switch (form) {
    case 'F1040':
      if (/^1[a-z]$/.test(line)) return 'wages_and_stock_compensation'
      if (['2b', '3a', '3b', '7'].includes(line)) return 'investments_and_digital_assets'
      if (['4a', '4b', '12', '13', '14', '19'].includes(line)) return 'deductions_and_credits'
      return 'payments_and_filing'
    case 'Sch1':
      if (['3', '15', '16', '17'].includes(line)) return 'business'
      if (line === '5') return 'rentals_and_sale'
      if (line === '13') return 'deductions_and_credits'
      return 'payments_and_filing'
    case 'Sch2':
      if (line === '1') return 'wages_and_stock_compensation'
      if (line === '4') return 'business'
      if (line === '11') return 'wages_and_stock_compensation'
      if (line === '12') return 'investments_and_digital_assets'
      return 'payments_and_filing'
    case 'Sch3':
      if (line === '1') return 'investments_and_digital_assets'
      if (line === '11') return 'wages_and_stock_compensation'
      return 'payments_and_filing'
    case 'F6251':
    case 'F8959':
      return 'wages_and_stock_compensation'
    case 'SchB':
    case 'SchD':
    case 'F8949':
    case 'F8960':
    case 'F8938':
      return 'investments_and_digital_assets'
    case 'SchC':
    case 'SchSE':
    case 'F4562-C':
    case 'F8995':
    case 'F8995A':
      return 'business'
    case 'SchE':
      return /^(28|32|41)/.test(line) ? 'pass_throughs_and_basis' : 'rentals_and_sale'
    case 'F4562-E':
    case 'F4797':
    case 'F8582':
      return 'rentals_and_sale'
    case 'F7203':
      return 'pass_throughs_and_basis'
    case 'SchA':
    case 'F8283':
    case 'F2441':
    case 'F8812':
    case 'F8863':
    case 'F8889':
    case 'F8606':
    case 'F8867':
      return 'deductions_and_credits'
    case 'F540NR':
      return line === '72' || line === '71' || line === '73' ? 'payments_and_filing' : 'california'
    case 'SchCA540NR':
    case 'ScheduleS':
    case 'FTB3885A':
    case 'FTB5805':
      return 'california'
    case 'F2210':
      return 'payments_and_filing'
    default:
      return 'payments_and_filing'
  }
}

// ── Refs ────────────────────────────────────────────────────────────────────────────────
export type RefKind =
  | 'ev' | 'doc' | 'page' | 'qa' | 'msg' | 'call' | 'py' | 'agency' | 'asset' | 'household'
  | 'param' | 'timeline' | 'version' | 'line' | 'act' | 'batch' | 'chk' | 'area' | 'step'
  | 'whatif' | 'diag' | 'out' | 'return' | 'season' | 'unknown'

export function refKind(ref: string): RefKind {
  if (/^ev-\d+$/.test(ref)) return 'ev'
  if (/^D\d{2}$/.test(ref)) return 'doc'
  if (ref.startsWith('doc:') || /^D\d{2}#page\d+$/.test(ref)) return 'page'
  if (ref.startsWith('qa-')) return 'qa'
  if (ref.startsWith('msg-')) return 'msg'
  if (ref.startsWith('call-')) return 'call'
  if (ref.startsWith('py:')) return 'py'
  if (ref.startsWith('agency:')) return 'agency'
  if (ref.startsWith('asset:')) return 'asset'
  if (ref.startsWith('household')) return 'household'
  if (ref.startsWith('ref:')) return 'param'
  if (ref.startsWith('timeline:')) return 'timeline'
  if (/^v\d$/.test(ref)) return 'version'
  if (ref.startsWith('act:')) return 'act'
  if (ref.startsWith('batch:')) return 'batch'
  if (ref.startsWith('chk:')) return 'chk'
  if (ref.startsWith('area:')) return 'area'
  if (ref.startsWith('step:')) return 'step'
  if (ref.startsWith('whatif:')) return 'whatif'
  if (ref.startsWith('diag:')) return 'diag'
  if (ref.startsWith('out:')) return 'out'
  if (ref === 'return') return 'return'
  if (ref === 'season') return 'season'
  if (/^[A-Za-z0-9-]+\.[\w.-]+$/.test(ref)) return 'line'
  return 'unknown'
}

/** `doc:D31#page32` or `D23#page3` → { doc: 'D31', page: 32 } */
export function parsePageRef(ref: string): { doc: string; page: number } | null {
  const m = /^(?:doc:)?(D\d{2})#page(\d+)$/.exec(ref)
  return m ? { doc: m[1], page: Number(m[2]) } : null
}

/** RFC 6901 pointer into an object. */
export function jsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root
  return pointer
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), root)
}

// ── Season clock and knownAt ────────────────────────────────────────────────────────────
/** The README's "now": v3 computed. The clock only moves forward from here, via `clock` acts. */
export const SEASON_START = '2026-06-23T06:05:00Z'
const ENGAGEMENT_SIGNED = '2026-01-12T17:06:00Z'
const PRIOR_YEAR_RECEIVED = '2026-01-21T00:00:00Z'
const ORGANIZER_ENTERED = '2026-01-20T04:00:00Z'

/** When a packet item entered the file. Items with knownAt > clock are hidden or greyed ("not yet in file"). */
export function knownAt(p: Packet, ref: string): string {
  const kind = refKind(ref)
  switch (kind) {
    case 'doc':
      return p.documents.find((d) => d.id === ref)?.received_at ?? ENGAGEMENT_SIGNED
    case 'page': {
      const pg = parsePageRef(ref)
      return pg ? knownAt(p, pg.doc) : ENGAGEMENT_SIGNED
    }
    case 'ev': {
      const ev = p.extracted_values.find((e) => e.id === ref)
      return ev ? knownAt(p, ev.document_id) : ENGAGEMENT_SIGNED
    }
    case 'qa':
      return p.client.questionnaire.find((q) => q.id === ref)?.answered_at ?? ORGANIZER_ENTERED
    case 'msg':
      return p.client.messages.find((m) => m.id === ref)?.sent_at ?? ENGAGEMENT_SIGNED
    case 'call':
      return p.client.call_notes.find((c) => c.id === ref.split('#')[0])?.date ?? ENGAGEMENT_SIGNED
    case 'timeline':
      return p.timeline.find((t) => t.id === ref.slice('timeline:'.length))?.at ?? ENGAGEMENT_SIGNED
    case 'version':
      return p.return_versions.find((v) => v.version === ref)?.computed_at ?? ENGAGEMENT_SIGNED
    case 'agency': {
      const [, section, idx] = ref.slice('agency:'.length).split('/')
      const a = p.tax_agency_records
      if (section === 'irs_account_transcript_2025') return a.irs_account_transcript_2025[Number(idx)]?.as_of ?? ENGAGEMENT_SIGNED
      if (section === 'ftb_account') return a.ftb_account.as_of
      if (section === 'efile') return a.efile[Number(idx)]?.date ?? ENGAGEMENT_SIGNED
      if (section === 'notices') {
        const n = a.notices[Number(idx)]
        if (!n) return ENGAGEMENT_SIGNED
        const doc = knownAt(p, n.document)
        return doc > n.dated ? doc : n.dated
      }
      return ENGAGEMENT_SIGNED
    }
    case 'py':
      return PRIOR_YEAR_RECEIVED
    case 'household':
      return ORGANIZER_ENTERED
    default:
      return ENGAGEMENT_SIGNED
  }
}

/** Packet moments the clock can step to ("next event >"), ascending, after `from`. */
export function seasonEvents(p: Packet, from: string): { at: string; ref: string; label: string }[] {
  const evs = [
    ...p.timeline.map((t) => ({ at: t.at, ref: `timeline:${t.id}`, label: t.event.replaceAll('_', ' ') })),
    ...p.documents.map((d) => ({ at: d.received_at, ref: d.id, label: `${d.id} received` })),
    ...p.client.messages.map((m) => ({ at: m.sent_at, ref: m.id, label: `${m.id} from ${m.from}` })),
  ]
  return evs.filter((e) => e.at > from).sort((a, b) => a.at.localeCompare(b.at))
}
