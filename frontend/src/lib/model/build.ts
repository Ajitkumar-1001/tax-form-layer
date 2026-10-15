// Model = everything derived from the packet alone (act-independent). Built once per packet,
// in the browser from the masked packet and on the server for enforcement. Pure and synchronous.
import type { ExtractedValue, Packet, PacketDocument, ReturnLine } from './packet-types'
import { type Claim, deriveClaims } from './claims'
import { knownAt } from './ids'
import { runChecks } from './checks'
import type { CheckContext, Finding } from './checks/types'

export interface Model extends CheckContext {
  claimList: Claim[]
  findings: Finding[]
  findingsById: Record<string, Finding>
  /** claim id → finding ids attached to it. */
  findingsByClaim: Record<string, string[]>
}

export function buildModel(packet: Packet): Model {
  const claims = deriveClaims(packet)
  const linesByVersion: Record<string, Record<string, ReturnLine>> = {}
  for (const v of packet.return_versions) linesByVersion[v.version] = Object.fromEntries(v.lines.map((l) => [l.key, l]))
  const lines = linesByVersion[packet.return_versions[packet.return_versions.length - 1].version]

  const ev: Record<string, ExtractedValue> = {}
  const evByDoc: Record<string, ExtractedValue[]> = {}
  for (const e of packet.extracted_values) {
    ev[e.id] = e
    ;(evByDoc[e.document_id] ??= []).push(e)
  }
  const docs: Record<string, PacketDocument> = Object.fromEntries(packet.documents.map((d) => [d.id, d]))

  const citedBy: Record<string, string[]> = {}
  const landedIn: Record<string, string[]> = {}
  for (const l of Object.values(lines)) {
    for (const s of l.sources) {
      ;(citedBy[s] ??= []).push(l.key)
      const doc = ev[s]?.document_id ?? (docs[s] ? s : undefined)
      if (doc && !(landedIn[doc] ??= []).includes(l.key)) landedIn[doc].push(l.key)
    }
  }

  const memo = new Map<string, string>()
  const ctx: CheckContext = {
    packet, claims, lines, linesByVersion, ev, evByDoc, docs, citedBy, landedIn,
    knownAt: (ref) => {
      let k = memo.get(ref)
      if (!k) memo.set(ref, (k = knownAt(packet, ref)))
      return k
    },
  }
  const findings = runChecks(ctx)
  const findingsById = Object.fromEntries(findings.map((f) => [f.id, f]))
  const findingsByClaim: Record<string, string[]> = {}
  for (const f of findings) for (const c of f.claims) (findingsByClaim[c] ??= []).push(f.id)

  return { ...ctx, claimList: Object.values(claims), findings, findingsById, findingsByClaim }
}
