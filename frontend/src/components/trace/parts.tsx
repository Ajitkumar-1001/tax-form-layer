'use client'
// Small pieces shared by the trace views.
import type { ReactNode } from 'react'
import { MaskedText } from '@/components/atoms/masked-text'
import { Money } from '@/components/atoms/money'
import { RefLink } from '@/components/atoms/ref-link'
import { useWorkspace } from '@/components/workspace/context'
import type { Val } from '@/lib/model/claims'
import { cn } from '@/lib/utils'
import { resolveRef } from './resolve'

/**
 * `focusReturn` makes the section a focus return (`data-focus-return`, act-host.tsx returnFocusTo) for a section whose act
 * buttons go when the act lands, and the section stays. Opt-in: every other section renders as before.
 */
export function Section({ title, children, className, aside, focusReturn }: { title: ReactNode; children: ReactNode; className?: string; aside?: ReactNode; focusReturn?: boolean }) {
  return (
    <section
      data-focus-return={focusReturn ? true : undefined}
      tabIndex={focusReturn ? -1 : undefined}
      className={cn('flex min-w-0 flex-col gap-2', focusReturn && 'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
        {aside && <div className="ml-auto text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>

/** A packet value: money in tabular figures, masked tokens with Reveal, booleans as Yes/No. */
export function ValueText({ value, context, className }: { value: Val | undefined; context: string; className?: string }) {
  if (value === undefined || value === null) return <span className={cn('text-muted-foreground', className)}>—</span>
  if (typeof value === 'number') return <Money value={value} className={className} />
  if (typeof value === 'boolean') return <span className={className}>{value ? 'Yes' : 'No'}</span>
  return <span className={className}><MaskedText text={value} context={context} /></span>
}

/** Pretty JSON with masked tokens kept masked. */
export function JsonView({ value, context }: { value: unknown; context: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      <MaskedText text={text ?? 'undefined'} context={context} />
    </pre>
  )
}

/** "Name (role)" for an actor id; system and unknown ids pass through. */
export function useWho(): (id: string) => string {
  const { identities } = useWorkspace()
  return (id) => {
    if (id === 'system') return 'System'
    const v = identities.find((x) => x.id === id)
    return v ? `${v.name} (${v.role.replaceAll('_', ' ')})` : id
  }
}

/** A client answer, message or call note in full. */
export function CommCard({ id }: { id: string }) {
  const { client } = useWorkspace().model.packet
  const q = client.questionnaire.find((x) => x.id === id)
  const m = client.messages.find((x) => x.id === id)
  const c = client.call_notes.find((x) => x.id === id)
  const head = (meta: string) => (
    <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
      <RefLink to={id} />
      <span>{meta}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
      {q && (
        <>
          {head(`questionnaire · answered by ${q.answered_by} ${q.answered_at.slice(0, 10)}`)}
          <p className="text-muted-foreground"><MaskedText text={q.question} context={id} /></p>
          <p><MaskedText text={q.answer} context={id} /></p>
        </>
      )}
      {m && (
        <>
          {head(`message ${m.from} → ${m.to} · ${m.sent_at.slice(0, 16).replace('T', ' ')}`)}
          <p className="whitespace-pre-wrap"><MaskedText text={m.text} context={id} /></p>
        </>
      )}
      {c && (
        <>
          {head(`call ${c.date.slice(0, 10)} · ${c.participants.join(', ')}`)}
          <ul className="list-disc pl-5">
            {c.notes.map((n, i) => <li key={i}><MaskedText text={n} context={id} /></li>)}
          </ul>
        </>
      )}
      {!q && !m && !c && head('not in the packet')}
    </div>
  )
}

/** Compact card for any ref that is not a document page: a line, comm, fact, finding or packet record. */
export function RefPreview({ to }: { to: string }) {
  const { model, state } = useWorkspace()
  const r = resolveRef(model, to)
  if (r.kind === 'claim' && r.claim.kind === 'comm') return <CommCard id={to} />
  const box = (children: ReactNode) => <div className="flex min-w-0 flex-col gap-1 rounded-md border p-3 text-sm">{children}</div>
  switch (r.kind) {
    case 'claim': {
      const cs = state.claims[to]
      const landed = r.claim.kind === 'doc' ? (model.landedIn[to]?.length ?? 0) : null
      return box(
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <RefLink to={to} />
            <span className="min-w-0 flex-1 truncate" title={r.claim.label}>{r.claim.label}</span>
            {r.claim.kind !== 'doc' && <ValueText value={cs?.effective ?? r.claim.value} context={to} className="font-mono" />}
          </div>
          {landed !== null && (
            <p className="text-xs text-muted-foreground">
              {model.docs[to]?.page_count} pages · {landed ? `landed in ${landed} lines` : 'lands in no line'}
            </p>
          )}
        </>,
      )
    }
    case 'finding':
      return box(<p><RefLink to={to}>{r.finding.title}</RefLink></p>)
    case 'ev':
      return box(
        <div className="flex flex-wrap items-baseline gap-2">
          <RefLink to={to} />
          <span className="flex-1">{r.ev.label}</span>
          <ValueText value={r.ev.value} context={to} className="font-mono" />
        </div>,
      )
    case 'data':
      return box(
        <>
          <div className="flex items-baseline gap-2">
            <RefLink to={to} />
            <span className="text-xs text-muted-foreground">{r.title}</span>
          </div>
          <JsonView value={r.value} context={to} />
        </>,
      )
    case 'entry':
      return box(<p><RefLink to={to} /> <span className="text-muted-foreground">entry not on the current return</span></p>)
    case 'unknown':
      return box(<p><span className="font-mono">{to}</span> <span className="text-muted-foreground">is not in the packet</span></p>)
    default:
      return box(<RefLink to={to} />)
  }
}
