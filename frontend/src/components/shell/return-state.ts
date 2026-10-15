// The return's state as the shell and the Overview show it: its stage, its claims by status and its filing deadlines.
// Pure (no React), so the rail, the top bar and the Overview model read the same numbers.
import type { Packet } from '@/lib/model/packet-types'
import type { ClaimStatus, Stage, State } from '@/lib/model/state'

const DAY = 86_400_000

// The return's life, in order: one mark per stage, the current one long.
export const STAGES: { key: Stage; label: string }[] = [
  { key: 'preparation', label: 'Preparation' },
  { key: 'review', label: 'Review' },
  { key: 'partner', label: 'Partner review' },
  { key: 'approval', label: 'Client approval' },
  { key: 'filed', label: 'Filed' },
  { key: 'amending', label: 'Amending' },
]

export function stageLabel(stage: Stage): string {
  return (STAGES.find((s) => s.key === stage) ?? STAGES[0]).label
}

export type SpectrumKey = 'checked' | 'corrected' | 'matches' | 'unchecked' | 'open'
export interface SpectrumPart {
  key: SpectrumKey
  label: string
  tone: string
  count: number
}

// The claim spectrum, from done to not done: what a person checked or corrected, what a check passed, the rest not
// checked yet, the open claims at the far end. "Not checked yet" is hollow, so shape and not only colour sets it apart.
export const SPECTRUM: { key: SpectrumKey; label: string; statuses: ClaimStatus[]; tone: string }[] = [
  { key: 'checked', label: 'Checked by staff', statuses: ['verified', 'accepted'], tone: 'bg-success' },
  { key: 'corrected', label: 'Corrected', statuses: ['adjusted'], tone: 'bg-info' },
  { key: 'matches', label: 'Matches the page (automatic)', statuses: ['read_ok'], tone: 'bg-info/70' },
  { key: 'unchecked', label: 'Not checked yet', statuses: ['unreviewed'], tone: 'ring-1 ring-inset ring-foreground/55' },
  { key: 'open', label: 'Has an open issue', statuses: ['open'], tone: 'bg-danger' },
]

/** Claims per spectrum part. Only claims in the file count: one the season clock has not reached is not in the return yet. */
export function spectrum(state: Pick<State, 'claims'>): { parts: SpectrumPart[]; total: number } {
  const counts = new Map<ClaimStatus, number>()
  let total = 0
  for (const c of Object.values(state.claims)) {
    if (c.flags.includes('not_yet_in_file')) continue
    counts.set(c.status, (counts.get(c.status) ?? 0) + 1)
    total++
  }
  const parts = SPECTRUM.map(({ key, label, tone, statuses }) => ({ key, label, tone, count: statuses.reduce((n, s) => n + (counts.get(s) ?? 0), 0) }))
  return { parts, total }
}

export interface Deadline {
  what: string
  date: string
  at: number
}

/** The return's own due dates, in order: the firm's internal targets and other filings' dates are not the return's. */
export function filingDeadlines(packet: Packet): Deadline[] {
  return packet.firm.deadlines
    .filter((d) => !/internal|outside/i.test(d.what))
    .map((d) => ({ what: d.what, date: d.date, at: Date.parse(`${d.date}T00:00:00Z`) }))
    .sort((a, b) => a.at - b.at)
}

/** The due date the return faces next at the season clock, with whole days left (rounded up); null once all have passed. */
export function nextDeadline(packet: Packet, clock: string): (Deadline & { daysLeft: number }) | null {
  const now = Date.parse(clock)
  const due = filingDeadlines(packet).find((d) => d.at > now)
  return due ? { ...due, daysLeft: Math.ceil((due.at - now) / DAY) } : null
}
