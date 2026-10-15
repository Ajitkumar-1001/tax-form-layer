'use client'
// The client portal body, in plain words. One headline says what is left to do; below it the amounts the client
// approves stand as a field of their own beside what we need from them. Reads only client-facing parts of the
// projection (see portal-logic); never findings, memos or staff activity.
import { type CSSProperties, useState } from 'react'
import { CircleCheckIcon, FileTextIcon, PaperclipIcon } from 'lucide-react'
import { MaskedText } from '@/components/atoms'
import { formatMoney } from '@/components/atoms/format'
import { ActButton } from '@/components/acts/act-host'
import { ClientCopy } from '@/components/filing/client-copy'
import { PrintSheet } from '@/components/filing/print-sheet'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { NoteView, TotalsSide } from '@/lib/model/state'
import { clientQuestions, type NeedItem, portalClient, portalHeadline, type SignState, signState, stillNeeded } from './portal-logic'

/** Position in the entrance: each part of the page rises 70 ms after the one before. */
const at = (i: number) => ({ '--i': i }) as CSSProperties

export function ClientPortal() {
  const { model, state, viewer, identities } = useWorkspace()
  const client = portalClient(viewer, identities)
  if (!client) return <p className="py-10 text-base">No client identities are set up for this return.</p>
  const acting = viewer.kind === 'client'
  const { open, answered } = clientQuestions(state, client.id)
  // stillNeeded() lists the open questions first; they have their own place below, so only the firm's requests remain.
  const requested = stillNeeded(model, state, client.id).filter((i) => !i.key.startsWith('act:'))
  const sign = signState(model, state, client.id)
  // On a phone the amounts come first only when there is something to approve or read; otherwise what we need leads.
  const signFirst = sign.kind === 'ready' || sign.kind === 'signed' || sign.kind === 'filed'
  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-4 pt-6 pb-10 lg:pt-14 lg:pb-16">
        <h1 style={at(0)} className="rise max-w-6xl text-4xl leading-none font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl xl:text-8xl">
          {portalHeadline(open.length, requested.length, sign)}
        </h1>
        {acting ? (
          <p style={at(1)} className="rise text-xl">Hello {client.name.split(' ')[0]}.</p>
        ) : (
          <p role="status" style={at(1)} className="rise max-w-2xl text-xl">
            You are previewing what {client.name} sees, as {viewer.name}. Choose a client above to answer or sign.
          </p>
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <Approve sign={sign} acting={acting} className={signFirst ? undefined : 'max-lg:order-last'} />
        <ForYou open={open} answered={answered} requested={requested} acting={acting} />
      </div>
    </div>
  )
}

const message: Partial<Record<SignState['kind'], string>> = {
  none: 'Your return is not ready to sign yet. We will ask you here when it is.',
  changed: 'Some amounts changed after we asked you to sign. We will send you a new request with the updated numbers.',
  filed: 'Your return has been filed. A summary is ready to print or save as PDF.',
}

/** The amounts being approved, or why there are none yet. One flat ink field: the figures are the point of the page. */
function Approve({ sign, acting, className }: { sign: SignState; acting: boolean; className?: string }) {
  const { state } = useWorkspace()
  const [copyOpen, setCopyOpen] = useState(false)
  const amounts = sign.kind === 'ready' || sign.kind === 'signed'
  return (
    <section aria-labelledby="approve-h" style={at(2)}
      className={`rise flex flex-col gap-8 bg-foreground p-6 text-background sm:p-10 lg:sticky lg:top-6 ${className ?? ''}`}>
      <h2 id="approve-h" className="text-2xl font-semibold">
        Approve and sign
      </h2>
      {message[sign.kind] && <p className="max-w-md text-2xl">{message[sign.kind]}</p>}
      {sign.kind === 'filed' && (
        <>
          <Button variant="secondary" size="lg" className="self-start" onClick={() => setCopyOpen(true)}>
            <FileTextIcon /> Open your copy
          </Button>
          {copyOpen && (
            <PrintSheet title="Your copy of the return" onClose={() => setCopyOpen(false)}>
              <ClientCopy />
            </PrintSheet>
          )}
        </>
      )}
      {amounts && (
        <>
          <p className="max-w-lg text-base">These are the amounts you are approving. By signing, you authorize us to file your return electronically.</p>
          <div className="grid gap-10 sm:grid-cols-2">
            <Balance title="Federal" side={state.totals.federal} />
            <Balance title="California" side={state.totals.california} />
          </div>
          {sign.kind === 'ready' && acting && (
            <ActButton type="client_approve" target={`act:${sign.requestSeq}`} variant="secondary" size="lg" className="self-start">
              Approve and sign with my PIN
            </ActButton>
          )}
          {sign.kind === 'signed' && (
            <p className="inline-flex flex-wrap items-center gap-x-2 text-base">
              <CircleCheckIcon className="size-5" /> You signed.
              {sign.waitingFor.length > 0 && <span>Waiting for {sign.waitingFor.join(' and ')}.</span>}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function Balance({ title, side }: { title: string; side: TotalsSide }) {
  const owe = side.balance_estimate
  const estimate = side.delta !== 0
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-6xl leading-none font-semibold tracking-tight tabular-nums sm:text-5xl">${formatMoney(Math.abs(owe))}</p>
      <p className="text-base">{owe >= 0 ? 'you owe' : 'refund to you'}</p>
      {estimate && <p className="max-w-xs text-sm">Estimate: includes changes the tax software has not recomputed.</p>}
    </div>
  )
}

/** What we need from the client: the questions (with their actions), then the items the firm asked for. */
function ForYou({ open, answered, requested, acting }: { open: NoteView[]; answered: NoteView[]; requested: NeedItem[]; acting: boolean }) {
  const nothing = open.length === 0 && requested.length === 0
  return (
    <div className="flex flex-col gap-6">
      {nothing && (
        <section style={at(3)} className="rise bg-foreground/[0.06] p-6 sm:p-8">
          <p className="text-base">No open questions. Thank you. We will let you know here if anything else is needed.</p>
        </section>
      )}
      {open.length > 0 && (
        <section aria-labelledby="questions-h" style={at(3)} className="rise flex flex-col gap-4">
          <h2 id="questions-h" className="text-2xl font-semibold">
            Questions from your preparer
          </h2>
          <ul className="flex flex-col gap-4">
            {open.map((n) => (
              <li key={n.seq} className="bg-foreground/[0.06] p-5 sm:p-6">
                <Question note={n} acting={acting} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {requested.length > 0 && (
        <section aria-labelledby="needed-h" style={at(4)} className="rise bg-foreground/[0.06] p-5 sm:p-6">
          <h2 id="needed-h" className="text-2xl font-semibold">
            What we still need
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-base">
            {requested.map((i) => (
              <li key={i.key}>
                <MaskedText text={i.text} context={i.key} />
                {i.due && <span> (by {i.due})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {answered.length > 0 && (
        <details style={at(5)} className="rise bg-foreground/[0.06] p-5 text-base sm:p-6">
          <summary className="cursor-pointer font-medium">Answered ({answered.length})</summary>
          <ul className="mt-4 flex flex-col gap-6">
            {answered.map((n) => (
              <li key={n.seq}>
                <Question note={n} acting={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Question({ note, acting }: { note: NoteView; acting: boolean }) {
  const { identities } = useWorkspace()
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  const target = `act:${note.seq}`
  return (
    <div className="flex flex-col gap-3 text-base">
      <p className="text-sm">
        {nameOf(note.actor)} asked on {note.recorded_at.slice(0, 10)}
        {note.due && <> · please answer by {note.due.slice(0, 10)}</>}
      </p>
      <p className="text-lg">
        <MaskedText text={note.text} context={target} />
      </p>
      {note.replies.length > 0 && (
        <ul className="flex flex-col gap-2">
          {note.replies.map((r) => (
            <li key={r.seq} className="flex flex-col gap-0.5 bg-background p-3">
              <span className="text-sm">
                {nameOf(r.actor)} · {r.recorded_at.slice(0, 10)}
              </span>
              <span>
                <MaskedText text={r.text} context={`act:${r.seq}`} />
              </span>
              {r.attachments.map((a) => (
                <span key={a.name} className="inline-flex items-center gap-1 text-sm">
                  <PaperclipIcon className="size-3.5" /> {a.name}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {note.resolved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Your preparer marked this answered.</p>}
      {acting && (
        <div className="flex flex-wrap gap-2">
          <ActButton type="reply" target={target}>
            Answer
          </ActButton>
          <ActButton type="attach" target={target} prefill={{ label: 'Document for your preparer', filed_against: [target] }} variant="outline">
            <PaperclipIcon /> Upload a document
          </ActButton>
        </div>
      )}
    </div>
  )
}
