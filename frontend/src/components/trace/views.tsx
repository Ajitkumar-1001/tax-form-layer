'use client'
// Trace views for refs that are not claims: a read, a page, a finding, an act, a required entry,
// a packet record, an area, a batch, or nothing at all.
import Link from 'next/link'
import { ActButton } from '@/components/acts/act-host'
import { MaskedText } from '@/components/atoms/masked-text'
import { RefLink } from '@/components/atoms/ref-link'
import { DocPage } from '@/components/doc/doc-page'
import { useWorkspace } from '@/components/workspace/context'
import type { Finding } from '@/lib/model/checks/types'
import type { Val } from '@/lib/model/claims'
import { AREA_LABEL, type AreaKey } from '@/lib/model/ids'
import type { ExtractedValue, PacketDocument } from '@/lib/model/packet-types'
import { indexActs } from '@/lib/model/project'
import { Attachments, EvidenceRefs } from './evidence'
import { FindingCard, FindingsList } from './findings'
import { ActionBar, TraceTitle } from './header'
import { ActList, ActRow } from './history'
import { Empty, JsonView, Section, useWho, ValueText } from './parts'
import { actFiles, findingsCiting, historyFor, historyRow, pageRefForms } from './resolve'

const ids = (fs: Finding[]) => fs.map((f) => f.id)

function History({ refs, compact }: { refs: string[]; compact: boolean }) {
  if (compact) return null
  return (
    <Section title="History">
      <ActList refs={refs} />
    </Section>
  )
}

export function EvView({ ev, compact }: { ev: ExtractedValue; compact: boolean }) {
  const { model } = useWorkspace()
  const lines = model.citedBy[ev.id] ?? []
  return (
    <>
      <TraceTitle refId={ev.id} kind={`Extracted value · ${ev.field}`} label={ev.label}>
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <ValueText value={ev.value} context={ev.id} className="font-mono text-xl font-semibold" />
          <span className="text-muted-foreground">
            read from <RefLink to={ev.document_id} /> <RefLink to={`doc:${ev.document_id}#page${ev.page}`}>page {ev.page}</RefLink> at confidence {ev.confidence}
          </span>
        </p>
      </TraceTitle>
      <ActionBar target={ev.id} kind="other" />
      <Section title="Used by">
        {lines.length ? <p className="flex flex-wrap gap-2 text-sm">{lines.map((l) => <RefLink key={l} to={l} />)}</p> : <Empty>No line of the current return cites this value.</Empty>}
      </Section>
      <FindingsList ids={ids(findingsCiting(model, [ev.id]))} title="Findings citing it" />
      <Section title="Printed page">
        <DocPage key={ev.id} doc={ev.document_id} page={ev.page} focus={[ev.id]} />
      </Section>
      <History refs={[ev.id]} compact={compact} />
    </>
  )
}

export function PageView({ refId, doc, page, compact }: { refId: string; doc: PacketDocument; page: number; compact: boolean }) {
  const { model } = useWorkspace()
  const onPage = (model.evByDoc[doc.id] ?? []).filter((e) => e.page === page).map((e) => e.id)
  const landed = model.landedIn[doc.id] ?? []
  const refs = pageRefForms(doc.id, page) // acts target the doc: form, whichever form the URL used
  return (
    <>
      <TraceTitle refId={refId} kind="Document page" label={`${doc.title}, page ${page} of ${doc.page_count}`}>
        <p className="text-sm text-muted-foreground">
          <RefLink to={doc.id} /> · {doc.issuer} · {onPage.length} values read on this page · document landed in {landed.length} lines
        </p>
      </TraceTitle>
      <ActionBar target={refs[0]} kind="page" />
      <FindingsList ids={ids(findingsCiting(model, [...refs, ...onPage]))} title="Findings on this page" />
      <DocPage key={refId} doc={doc.id} page={page} pager />
      <History refs={refs} compact={compact} />
    </>
  )
}

export function FindingView({ finding: f, compact }: { finding: Finding; compact: boolean }) {
  const { state } = useWorkspace()
  const visible = state.findings[f.id]?.visible
  return (
    <>
      <TraceTitle refId={f.id} kind={`Finding · ${f.family.replaceAll('_', ' ')}`} label={f.title} />
      {!visible && <p className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">Not yet in file: its evidence arrives {f.knownSince.slice(0, 10)}, after the season clock.</p>}
      <FindingCard finding={f} showClaims />
      <Section title="Evidence">
        <EvidenceRefs refs={f.evidence} />
      </Section>
      <History refs={[f.id]} compact={compact} />
    </>
  )
}

export function ActView({ refId, seq, compact }: { refId: string; seq: number; compact: boolean }) {
  const { state } = useWorkspace()
  const who = useWho()
  const act = state.acts.find((a) => a.seq === seq)
  if (!act) return <NotFound refId={refId} what={`Act #${seq} is not in this engagement's log.`} />
  const row = historyRow(act, indexActs(state.acts).dead)
  const note = state.notes.find((n) => n.seq === seq)
  const { file, attachments, ...body } = act.body as { file?: unknown; attachments?: unknown } & Record<string, unknown>
  const files = actFiles(act)
  return (
    <>
      <TraceTitle refId={refId} kind={`Act · ${act.type.replaceAll('_', ' ')}`} label={<>#{seq} by {who(act.actor)} on <RefLink to={act.target} /></>} />
      <ul><ActRow {...row} /></ul>
      {note && (
        <Section title={note.open ? 'Open note' : 'Resolved note'} focusReturn>
          <p className="text-sm"><MaskedText text={note.text} context={refId} /></p>
          {note.replies.map((r) => (
            <div key={r.seq} className="rounded-md bg-muted/60 p-2 text-sm">
              <p className="text-xs text-muted-foreground">{who(r.actor)} · <RefLink to={`act:${r.seq}`}>#{r.seq}</RefLink></p>
              <p><MaskedText text={r.text} context={refId} /></p>
            </div>
          ))}
          {note.resolved && <p className="text-sm text-muted-foreground">Resolved ({note.resolved.resolution}) by {who(note.resolved.actor)}: <MaskedText text={note.resolved.text} context={refId} /></p>}
          {note.open && (
            <div className="flex gap-1.5">
              <ActButton type="reply" target={refId} size="sm" variant="outline">Reply</ActButton>
              <ActButton type="resolve" target={refId} size="sm" variant="outline">Resolve</ActButton>
            </div>
          )}
        </Section>
      )}
      <Section title="Cites">
        <p className="flex flex-wrap gap-2 text-sm">{act.refs.map((r) => <RefLink key={r} to={r} />)}</p>
      </Section>
      <Section title="Recorded">
        <JsonView value={{ body: { ...body, ...(file !== undefined && { file: '(file, see attachments)' }), ...(attachments !== undefined && { attachments: '(files, see attachments)' }) }, derived: act.derived, hash: act.hash, prev_hash: act.prev_hash }} context={refId} />
      </Section>
      {files.length > 0 && (
        <Section title="Files">
          {files.map((f) => (
            <a key={f.name} href={f.href} download={f.name} className="w-fit text-sm text-primary underline-offset-2 hover:underline">
              Download {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)
            </a>
          ))}
        </Section>
      )}
      <History refs={[refId]} compact={compact} />
    </>
  )
}

export function EntryView({ refId, findings, earlier, compact }: { refId: string; findings: Finding[]; earlier: { version: string; label: string; value: Val }[]; compact: boolean }) {
  const { state } = useWorkspace()
  const answer = state.adjusts.filter((a) => a.target === refId && !a.reverted).at(-1)
  const acts = historyFor(state, [refId, ...ids(findings)])
  if (!findings.length && !earlier.length && !acts.length) return <NotFound refId={refId} />
  return (
    <>
      <TraceTitle refId={refId} kind={earlier.length ? 'Return line, not in the current version' : 'Required entry, not on the return'} label={findings[0]?.title ?? earlier.at(-1)?.label ?? refId}>
        <p className="text-sm">
          {answer ? <>Answered <ValueText value={answer.to} context={refId} className="font-mono font-semibold" /> by <RefLink to={`act:${answer.seq}`}>#{answer.seq}</RefLink></> : <span className="text-muted-foreground">No answer recorded.</span>}
        </p>
      </TraceTitle>
      <ActionBar target={refId} kind="entry" />
      {earlier.length > 0 && (
        <Section title="Earlier versions">
          <ul className="grid gap-0.5 text-sm">
            {earlier.map((e) => <li key={e.version}><span className="font-mono text-xs">{e.version}</span> {e.label}: <ValueText value={e.value} context={refId} /></li>)}
          </ul>
        </Section>
      )}
      <FindingsList ids={ids(findings)} />
      <History refs={[refId, ...ids(findings)]} compact={compact} />
    </>
  )
}

export function DataView({ refId, title, value, compact }: { refId: string; title: string; value: unknown; compact: boolean }) {
  const { model } = useWorkspace()
  const facts = refId.startsWith('household:') ? model.claimList.filter((c) => c.id.startsWith(`${refId}#`)).map((c) => c.id) : []
  const citing = model.citedBy[refId] ?? []
  return (
    <>
      <TraceTitle refId={refId} kind={title} label={<span className="font-mono">{refId}</span>} />
      <ActionBar target={refId} kind="other" />
      {facts.length > 0 && <p className="flex flex-wrap gap-2 text-sm"><span className="text-muted-foreground">Facts</span>{facts.map((f) => <RefLink key={f} to={f} />)}</p>}
      {citing.length > 0 && <p className="flex flex-wrap gap-2 text-sm"><span className="text-muted-foreground">Cited by</span>{citing.map((f) => <RefLink key={f} to={f} />)}</p>}
      <FindingsList ids={ids(findingsCiting(model, [refId]))} title="Findings citing it" />
      <Section title="Value">
        <JsonView value={value} context={refId} />
      </Section>
      <Attachments target={refId} />
      <History refs={[refId]} compact={compact} />
    </>
  )
}

export function AreaView({ refId, area, compact }: { refId: string; area: AreaKey; compact: boolean }) {
  const { state } = useWorkspace()
  const who = useWho()
  const a = state.areas.find((x) => x.key === area)
  if (!a) return <NotFound refId={refId} />
  return (
    <>
      <TraceTitle refId={refId} kind="Area" label={AREA_LABEL[area]}>
        <p className="text-sm text-muted-foreground">
          {a.claims} claims · {a.open} open · {a.findingsOpen} open findings · assigned to {who(a.assignee)} · {a.hours}h of {a.budget ?? '—'}h
        </p>
      </TraceTitle>
      <Section title="Definition of done">
        <ul className="grid gap-1 text-sm">
          {a.done.map((d) => (
            <li key={d.label} className={d.ok ? 'text-emerald-700 dark:text-emerald-300' : ''}>
              {d.ok ? '✓' : '○'} {d.label}{!d.ok && d.ref && <> · <RefLink to={d.ref} /></>}
            </li>
          ))}
        </ul>
      </Section>
      <History refs={[refId]} compact={compact} />
    </>
  )
}

export function BatchView({ refId, id }: { refId: string; id: string }) {
  const { state } = useWorkspace()
  const dead = indexActs(state.acts).dead
  const acts = state.acts.filter((a) => a.batch_id === id)
  if (!acts.length) return <NotFound refId={refId} />
  return (
    <>
      <TraceTitle refId={refId} kind="Batch" label={`${acts.length} acts recorded together`} />
      <ActButton type="revert" target={refId} size="sm" variant="outline" className="w-fit">Revert the batch</ActButton>
      <ul>{acts.map((a) => <ActRow key={a.seq} {...historyRow(a, dead)} />)}</ul>
    </>
  )
}

export function NotFound({ refId, what }: { refId: string; what?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <TraceTitle refId={refId || '(empty)'} kind="Not found" label="Nothing here" />
      <p className="text-sm text-muted-foreground">
        {what ?? <>No line, document, page, value, client answer, fact, step, finding or act is called <span className="font-mono">{refId || '(empty)'}</span>.</>}
      </p>
      <p className="text-sm">
        <Link href="/queue" className="text-primary underline-offset-2 hover:underline">Back to the queue</Link> or press ⌘K to search.
      </p>
    </div>
  )
}
