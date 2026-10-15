// Types mirror the packet README ("sections"). Deep, open-ended maps stay as Records.

export type Money = number
export type Jurisdiction = 'federal' | 'california'

export interface Person {
  id: string
  role: string
  name: string
  ssn: string
  dob: string
  occupation?: string
  ip_pin?: string | null
  phone?: string
  email?: string
  relationship?: string
  months_lived_with_you?: number
  full_time_student?: boolean
  note?: string
  own_income?: string
}

export interface Household {
  filing_status: string
  tax_year: number
  entered_by: string
  people: Person[]
  addresses: { from: string; to: string | null; address: string; type: string }[]
  residency: { state: string; from: string; to: string; status: string }[]
  bank_account_for_refund_or_payment: { routing: string; account: string; type: string; bank: string }
  prior_year_agi_for_esignature: number
  related_returns: { who: string; return: string; prepared_by: string; in_this_packet: boolean | string }[]
}

export interface DocPage {
  page: number
  printed_content: string
}

export interface PacketDocument {
  id: string
  title: string
  document_type: string
  issuer: string
  belongs_to: string
  tax_year: number
  received_at: string
  uploaded_by: 'client' | 'firm' | string
  file_name: string
  page_count: number
  pages: DocPage[]
  marked_corrected?: boolean
  extraction: { status: 'extracted' | 'partial' | 'not_extracted'; values: number; reason: string | null }
}

export interface Position {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ExtractedValue {
  id: string
  document_id: string
  page: number
  field: string
  label: string
  value: number | string | boolean | null
  value_type: string
  text_as_read: string
  position: Position
  confidence: number
}

export interface Client {
  questionnaire: { id: string; question: string; answer: string; answered_by: string; answered_at: string }[]
  messages: { id: string; sent_at: string; from: string; to: string; text: string }[]
  call_notes: { id: string; date: string; participants: string[]; notes: string[] }[]
}

export interface Staff {
  id: string
  name: string
  role: 'preparer' | 'reviewer' | 'partner' | 'firm_administrator' | 'quality_reviewer' | string
  credential: string | null
  sensitive_data_clearance: boolean
  active_from: string
  note?: string
}

export interface Firm {
  name: string
  firm_identity: Record<string, unknown> & { ptins: Record<string, string>; paid_preparer_signing_returns: string }
  staff: Staff[]
  client_users: { id: string; name: string; role: string }[]
  assignment_at_start: { preparer: string; reviewer: string; partner: string }
  deadlines: { what: string; date: string }[]
  budget_hours: Record<string, number>
  starter_standards: {
    note: string
    verification_types: string[]
    variance_review: { compare_to: string; flag_if_change_over_percent: number; and_over_amount: number }
    review_levels: string[]
    rules: string[]
    required_steps: string[]
  }
}

export interface AssetRecord {
  asset_id: string
  description: string
  activity: string
  cost: Money
  placed_in_service: string
  method: string
  life_years: number
  disposed: string | null
  land_value: Money | null
  federal: Record<string, Money>
  california: Record<string, Money>
  amt_difference: Record<string, Money>
  sources: string[]
}

export interface PriorYears {
  return_2024: {
    prepared_by: string
    filed: string
    residency: string
    dependents: { name: string; ssn: string }[]
    lines: Record<string, number | string>
    line_labels: Record<string, string>
    line_sources: Record<string, string[] | string>
    notes: Record<string, string>
    K1_1120S: Record<string, number>
    K1_1065: Record<string, number | string>
  }
  prior_preparer_workpaper: {
    source_document: string
    summary_memo: string
    notes: string[]
    open_items_left_by_prior_preparer: string[]
    depreciation_schedule: string
  }
  asset_records: AssetRecord[]
  basis_records: Record<string, Record<string, unknown>[]>
  carryovers_into_2025: Record<string, unknown>
}

export interface TaxAgencyRecords {
  irs_account_transcript_2025: {
    as_of: string
    transactions: { date: string; code: string; description: string; amount: number | string }[]
  }[]
  ftb_account: {
    as_of: string
    tax_year_2025_payments: { date: string; amount: Money }[]
    tax_year_2024_payments_after_filing: { date: string; amount: Money; note: string }[]
  }
  notices: {
    id: string
    agency: string
    type: string
    tax_year: number
    dated: string
    summary?: string
    status?: string
    document: string
    response_due?: string
    items_under_examination?: unknown[]
  }[]
  efile: {
    date: string
    jurisdiction: string
    submission_id: string
    status: string
    errors?: { code: string; message: string }[]
  }[]
}

export interface TimelineEvent {
  id: string
  at: string
  event: string
  actor: string | null
  detail: string | null
  refs: string[]
}

export interface ReturnLine {
  key: string
  jurisdiction: Jurisdiction
  form: string
  line: string
  label: string
  value: number | string
  rule: string
  inputs: string[]
  sources: string[]
  note?: string
}

export interface ReturnAsset {
  asset_id: string
  description: string
  activity: string
  cost: Money
  land_value_not_depreciated: Money | null
  placed_in_service: string
  method: string
  life_years: number
  federal: { prior_accumulated: Money; depreciation_2025: Money; accumulated_end: Money }
  california: { prior_accumulated: Money; depreciation_2025: Money; accumulated_end: Money }
  amt: { depreciation_2025: Money; difference_from_regular: Money }
  disposed: string | null
  sources: string[]
  disposition?: {
    date: string
    sold_with: string
    unrecaptured_1250_depreciation: Money
    section_1250_ordinary_recapture: Money
  }
}

export type TaxEffectCategory =
  | 'wages'
  | 'interest'
  | 'schc_profit'
  | 'stcg'
  | 'ltcg'
  | 'ordinary_income'
  | 'adjustment'
  | 'salt'
  | 'itemized'
  | 'ca_source_income'

export interface ReturnVersion {
  version: string
  computed_at: string
  trigger: string
  documents_used: string[]
  documents_superseded: string[]
  summary: {
    federal: { agi: Money; taxable_income: Money; total_tax: Money; payments: Money; balance_due: Money; penalty: Money }
    california: { total_agi: Money; ca_agi: Money; total_tax: Money; payments: Money; balance_due: Money; penalty: Money }
  }
  tax_effect_rates: Record<TaxEffectCategory, { federal_per_dollar: number; california_per_dollar: number }>
  carryovers_out: { federal: Record<string, Money>; california: Record<string, unknown> }
  assets: ReturnAsset[]
  diagnostics: { code: string; severity: 'info' | 'warning'; message: string; refs: string[] }[]
  changes_from_previous: { key: string; change: 'added' | 'changed' | 'removed'; old?: number | string; new?: number | string }[]
  lines: ReturnLine[]
}

export interface WhatIf {
  alternatives: {
    id: string
    description: string
    base_version: string
    choices: Record<string, string>
    federal: { base: Record<string, Money>; alternative: Record<string, Money>; total_tax_change: Money; penalty_change: Money }
    california: { base: Record<string, Money>; alternative: Record<string, Money>; total_tax_change: Money }
    changed_lines: { key: string; change: string; old: number; new: number }[]
  }[]
  extension: {
    computed_at: string
    based_on_version: string
    federal: Record<string, Money | string>
    california: Record<string, Money | string>
  }
}

export interface Packet {
  packet: { name: string; version: string; generated: string; client_id: string }
  readme: Record<string, unknown>
  household: Household
  documents: PacketDocument[]
  extracted_values: ExtractedValue[]
  client: Client
  firm: Firm
  prior_years: PriorYears
  tax_agency_records: TaxAgencyRecords
  timeline: TimelineEvent[]
  engine_reference: { parameters: Record<string, unknown>; rules: Record<string, string> }
  return_versions: ReturnVersion[]
  what_if: WhatIf
  planning_reference_2026: Record<string, unknown>
  post_filing_rates: Record<string, unknown>
  fx_rates: Record<string, unknown>
}
