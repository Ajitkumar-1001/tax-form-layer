'use client'
// Tab 1: the printed pages behind a claim, its findings' evidence side by side, comms and attachments.
import { DocPage } from '@/components/doc/doc-page'
import { Ago } from '@/components/atoms/ago'
import { MaskedText } from '@/components/atoms/masked-text'
import { RefLink } from '@/components/atoms/ref-link'
import { useWorkspace } from '@/components/workspace/context'
import type { Claim } from '@/lib/model/claims'
import { cn } from '@/lib/utils'
import { CommCard, Empty, RefPreview, Section, useWho } from './parts'
import { attachmentsFor, claimFindingIds, firstSentence, groupEvidence, linkedComms, type PageGroup, provenanceOf } from './resolve'

const pageKey = (g: PageGroup) => `${g.doc}#${g.page}`

/** Pages side by side (two columns from md up), anything else as cards under them. */
export function EvidenceRefs({ refs, pager = false }: { refs: string[]; pager?: boolean }) {
  const { model } = useWorkspace()
  const { pages, other } = groupEvidence(model, refs)
  return (
    <div className="flex flex-col gap-3">
      {pages.length > 0 && (
        <div className={cn('grid gap-3', pages.length > 1 && 'md:grid-cols-2')}>
          {pages.map((g) => <DocPage key={pageKey(g)} doc={g.doc} page={g.page} focus={g.focus} pager={pager} />)}
        </div>
      )}
      {other.map((r) => <RefPreview key={r} to={r} />)}
    </div>
  )
}

export function EvidenceTab({ claim }: { claim: Claim }) {
  const { model, state } = useWorkspace()
  const findings = claimFindingIds(model, claim).map((id) => model.findingsById[id]).filter((f) => state.findings[f.id]?.visible)
  const sources = claim.kind === 'comm' || claim.kind === 'doc' ? [] : claim.sources
  const shown = new Set(groupEvidence(model, sources).pages.map(pageKey))
  const own = (g: PageGroup) => shown.has(pageKey(g)) || (claim.kind === 'doc' && g.doc === claim.id)
  // A finding's evidence gets its own side-by-side row when it compares pages or shows one not drawn above.
  const pairs = findings.filter((f) => {
    const pages = groupEvidence(model, f.evidence).pages
    return pages.length > 1 || pages.some((g) => !own(g))
  })
  const comms = linkedComms(model, state, claim.id, [...claim.sources, ...findings.flatMap((f) => f.evidence)]).filter((c) => c !== claim.id)
  // A line with no document behind it says where the value does come from, in CHK-24's own words; the link waits for the clock.
  const prov = claim.kind === 'line' ? provenanceOf(model, claim) : undefined
  const provWhy = prov?.finding ? firstSentence(model.findingsById[prov.finding].why) : ''
  const provLink = prov?.finding && state.findings[prov.finding]?.visible ? <> <RefLink to={prov.finding}>See the provenance finding</RefLink></> : null

  return (
    <div className="flex flex-col gap-6">
      {claim.kind === 'doc' && <DocumentEvidence id={claim.id} flagged={groupEvidence(model, findings.flatMap((f) => f.evidence)).pages.filter((g) => g.doc === claim.id)} />}
      {claim.kind === 'comm' && <CommCard id={claim.id} />}
      {sources.length > 0 && (
        <Section title="Sources">
          {prov?.kind === 'client' && <Empty>{provWhy}{provLink}</Empty>}
          <EvidenceRefs refs={sources} />
        </Section>
      )}
      {prov?.kind === 'inputs' && <Empty>This line cites no source; it is computed from its inputs (see Built).</Empty>}
      {prov?.kind === 'unsourced' && <Empty>{provWhy}{provLink}</Empty>}
      {prov?.kind === 'engine' && <Empty>No document or input line behind this line: the engine set it as a default, a parameter or a zero (rule under Built).</Empty>}
      {pairs.map((f) => (
        <Section key={f.id} title={<>Compare · <RefLink to={f.id} className="normal-case">{f.check}</RefLink></>}>
          <p className="text-sm">{f.title}</p>
          <EvidenceRefs refs={f.evidence} />
        </Section>
      ))}
      {comms.length > 0 && (
        <Section title="Client communications">
          {comms.map((c) => <CommCard key={c} id={c} />)}
        </Section>
      )}
      <Attachments target={claim.id} />
    </div>
  )
}

/** A document: where it landed, its disposition, and its pages (opening on the first page a finding flags). */
function DocumentEvidence({ id, flagged }: { id: string; flagged: PageGroup[] }) {
  const { model, state } = useWorkspace()
  const who = useWho()
  const d = model.docs[id]
  const landed = model.landedIn[id] ?? []
  const disposition = state.claims[id]?.disposition
  return (
    <Section title="Where it landed">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        {landed.length ? (
          <>
            <span>Landed in {landed.length} {landed.length === 1 ? 'line' : 'lines'}:</span>
            {landed.map((k) => <RefLink key={k} to={k} />)}
          </>
        ) : (
          <span className="text-muted-foreground">Lands in no line of the current return.</span>
        )}
      </p>
      {disposition && (
        <p className="text-sm">
          Disposed as <strong>{disposition.disposition.replaceAll('_', ' ')}</strong>
          {disposition.ref && <> (<RefLink to={disposition.ref} />)</>} by {who(disposition.actor)}: {disposition.reason}
        </p>
      )}
      {d && (
        <p className="text-xs text-muted-foreground">
          {d.document_type} · {d.issuer} · {d.file_name} · uploaded by {d.uploaded_by} {d.received_at.slice(0, 10)} · extraction {d.extraction.status}
          {d.extraction.reason && `: ${d.extraction.reason}`} · {model.evByDoc[id]?.length ?? 0} values read
          {d.marked_corrected && ' · marked CORRECTED'}
        </p>
      )}
      <DocPage key={id} doc={id} page={flagged[0]?.page} focus={flagged.flatMap((g) => g.focus)} pager />
    </Section>
  )
}

/** Files and pasted text filed against a ref, each file downloadable. */
export function Attachments({ target }: { target: string }) {
  const { state } = useWorkspace()
  const who = useWho()
  const rows = attachmentsFor(state, target)
  if (!rows.length) return null
  return (
    <Section title="Attachments">
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.seq} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{r.label}</span>
              <span className="text-xs text-muted-foreground">{who(r.actor)} · <Ago iso={r.recorded_at} /> · <RefLink to={`act:${r.seq}`}>act {r.seq}</RefLink></span>
            </p>
            {r.text && <p className="whitespace-pre-wrap text-muted-foreground"><MaskedText text={r.text} context={target} /></p>}
            {r.files.map((f) => (
              <a key={f.name} href={f.href} download={f.name} className="w-fit text-primary underline-offset-2 hover:underline">
                Download {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)
              </a>
            ))}
          </li>
        ))}
      </ul>
    </Section>
  )
}
