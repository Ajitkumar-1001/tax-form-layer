// Document index rows (spec §3.3): every document lands somewhere or says why not. Pure.
import type { z } from 'zod'
import type { ActInput, Disposition } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import { areaOfDoc, type AreaKey } from '@/lib/model/ids'
import type { State } from '@/lib/model/state'

export interface Lineage {
  text: string
  ref?: string
}

export interface DocRow {
  id: string
  title: string
  type: string
  belongsTo: string
  receivedAt: string
  afterV3: boolean
  notYetInFile: boolean
  extraction: string // 'extracted' | 'partial: page 32 not read' | ...
  partial: boolean
  landed: string[]
  used: boolean
  /** The pipeline marked it used, but no number on v3 came from it. */
  unlanded: boolean
  disposition: string | null
  lineage: Lineage[]
  openFindings: number
  views: number
  area: AreaKey
}

/** "Page 32 ('Additional transactions') was not read by the pipeline." → "page 32 not read". */
export function extractionText(status: string, reason: string | null): string {
  if (status === 'extracted') return 'extracted'
  const page = reason && /page (\d+)/i.exec(reason)
  if (status === 'partial') return page ? `partial: page ${page[1]} not read` : 'partial'
  return reason ? `${status.replaceAll('_', ' ')}: ${reason.split(';')[0].replace(/\.$/, '')}` : status.replaceAll('_', ' ')
}

export function documentRows(model: Model, state: State): DocRow[] {
  const versions = model.packet.return_versions
  const v3 = versions[versions.length - 1]
  const used = new Set(v3.documents_used)
  return model.packet.documents.map((d): DocRow => {
    const landed = model.landedIn[d.id] ?? []
    const s = state.claims[d.id]
    const supersededIn = versions.filter((v) => v.documents_superseded.includes(d.id)).map((v) => v.version)
    const chk18 = (model.findingsByClaim[d.id] ?? []).map((id) => model.findingsById[id]).filter((f) => f?.check === 'CHK-18')
    return {
      id: d.id,
      title: d.title,
      type: d.document_type,
      belongsTo: d.belongs_to,
      receivedAt: d.received_at,
      afterV3: d.received_at > v3.computed_at,
      notYetInFile: d.received_at > state.clock,
      extraction: extractionText(d.extraction.status, d.extraction.reason),
      partial: d.extraction.status !== 'extracted',
      landed,
      used: used.has(d.id),
      unlanded: used.has(d.id) && landed.length === 0,
      disposition: s?.disposition ? `${s.disposition.disposition.replaceAll('_', ' ')}${s.disposition.ref ? ` ${s.disposition.ref}` : ''}: ${s.disposition.reason}` : null,
      lineage: [
        ...(supersededIn.length ? [{ text: `superseded in ${supersededIn.join(', ')}` }] : []),
        ...(d.marked_corrected ? [{ text: 'marked corrected' }] : []),
        ...chk18.map((f) => ({ text: f.title, ref: f.id })),
      ],
      openFindings: s?.openFindings.length ?? 0,
      views: state.viewLog.filter((a) => String((a.body as { context?: unknown }).context ?? '').includes(d.id)).length,
      area: areaOfDoc(d.id),
    }
  })
}

export interface DocFilter {
  unlanded: boolean
  area: string | null
}

export function filterDocs(rows: DocRow[], f: DocFilter): DocRow[] {
  return rows.filter((r) => (!f.unlanded || r.unlanded) && (!f.area || r.area === f.area))
}

/** Rows needing attention first (unlanded without a disposition, open findings, partial reads), then by id. */
export function exceptionsFirst(rows: DocRow[]): DocRow[] {
  const weight = (r: DocRow) => (r.unlanded && !r.disposition ? 4 : 0) + (r.openFindings ? 2 : 0) + (r.partial ? 1 : 0)
  return [...rows].sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id))
}

export const isException = (r: DocRow): boolean => (r.unlanded && !r.disposition) || r.openFindings > 0 || r.partial || r.lineage.length > 0

/** One dispose act per selected document, sharing a single reason (posted as one batch). */
export type DispositionT = z.infer<typeof Disposition>

export function disposeActs(ids: string[], disposition: DispositionT, reason: string, ref?: string): ActInput[] {
  return ids.map((id) => ({ type: 'dispose', target: id, body: { disposition, reason, ...(ref ? { ref } : {}) } }))
}
