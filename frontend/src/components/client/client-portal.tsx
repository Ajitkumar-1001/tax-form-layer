'use client'
// The client portal body, in plain words: questions, what we still need, approve and sign, the client copy.
// Reads only client-facing parts of the projection (see portal-logic); never findings, memos or staff activity.
import { type ReactNode, useState } from 'react'
import { CircleCheckIcon, FileTextIcon, PaperclipIcon } from 'lucide-react'
import { MaskedText, Money } from '@/components/atoms'
import { ActButton } from '@/components/acts/act-host'
import { ClientCopy } from '@/components/filing/client-copy'
import { PrintSheet } from '@/components/filing/print-sheet'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import type { NoteView, TotalsSide } from '@/lib/model/state'
import { clientQuestions, portalClient, signState, stillNeeded } from './portal-logic'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-background p-5 ring-1 ring-foreground/10">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function ClientPortal() {
  const { viewer, identities } = useWorkspace()
  const client = portalClient(viewer, identities)
  if (!client) return <p className="text-sm">No client identities are set up for this return.</p>
  const acting = viewer.kind === 'client'
  return (
    <div className="flex flex-col gap-5">
      {acting ? (
        <p className="text-base">Hello {client.name.split(' ')[0]}.</p>
      ) : (
        <p role="status" className="rounded-lg bg-background p-3 text-sm ring-1 ring-foreground/10">
          You are previewing what {client.name} sees, as {viewer.name}. Choose a client above to answer or sign.
        </p>
      )}
      <Questions clientId={client.id} acting={acting} />
      <StillNeeded clientId={client.id} />
      <Sign clientId={client.id} acting={acting} />
      <Copy />
    </div>
  )
}

function Questions({ clientId, acting }: { clientId: string; acting: boolean }) {
  const { state } = useWorkspace()
  const { open, answered } = clientQuestions(state, clientId)
  return (
    <Card title="Questions from your preparer">
      {open.length === 0 && <p className="text-sm text-muted-foreground">No open questions. Thank you.</p>}
      <ul className="flex flex-col gap-4">
        {open.map((n) => (
          <li key={n.seq}>
            <Question note={n} acting={acting} />
          </li>
        ))}
      </ul>
      {answered.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Answered ({answered.length})</summary>
          <ul className="mt-3 flex flex-col gap-4">
            {answered.map((n) => (
              <li key={n.seq}>
                <Question note={n} acting={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function Question({ note, acting }: { note: NoteView; acting: boolean }) {
  const { identities } = useWorkspace()
  const nameOf = (id: string) => identities.find((v) => v.id === id)?.name ?? id
  const target = `act:${note.seq}`
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-muted-foreground">
        {nameOf(note.actor)} asked on {note.recorded_at.slice(0, 10)}
        {note.due && <> · please answer by {note.due.slice(0, 10)}</>}
      </p>
      <p>
        <MaskedText text={note.text} context={target} />
      </p>
      {note.replies.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-l-2 pl-3">
          {note.replies.map((r) => (
            <li key={r.seq} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {nameOf(r.actor)} · {r.recorded_at.slice(0, 10)}
              </span>
              <span>
                <MaskedText text={r.text} context={`act:${r.seq}`} />
              </span>
              {r.attachments.map((a) => (
                <span key={a.name} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <PaperclipIcon className="size-3" /> {a.name}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {note.resolved && <p className="text-xs text-emerald-800 dark:text-emerald-300">Your preparer marked this answered.</p>}
      {acting && (
        <div className="flex flex-wrap gap-2">
          <ActButton type="reply" target={target} size="sm">
            Answer
          </ActButton>
          <ActButton type="attach" target={target} prefill={{ label: 'Document for your preparer', filed_against: [target] }} size="sm" variant="outline">
            <PaperclipIcon /> Upload a document
          </ActButton>
        </div>
      )}
    </div>
  )
}

function StillNeeded({ clientId }: { clientId: string }) {
  const { model, state } = useWorkspace()
  const items = stillNeeded(model, state, clientId)
  return (
    <Card title="What we still need">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing right now. We will let you know here if that changes.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {items.map((i) => (
            <li key={i.key}>
              <MaskedText text={i.text} context={i.key} />
              {i.due && <span className="text-muted-foreground"> (by {i.due})</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Sign({ clientId, acting }: { clientId: string; acting: boolean }) {
  const { model, state } = useWorkspace()
  const s = signState(model, state, clientId)
  return (
    <Card title="Approve and sign">
      {s.kind === 'none' && <p className="text-sm text-muted-foreground">Your return is not ready to sign yet. We will ask you here when it is.</p>}
      {s.kind === 'filed' && <p className="text-sm">Your return has been filed. Your copy is below.</p>}
      {s.kind === 'changed' && (
        <p className="text-sm">Some amounts changed after we asked you to sign. We will send you a new request with the updated numbers.</p>
      )}
      {(s.kind === 'ready' || s.kind === 'signed') && (
        <>
          <p className="text-sm">These are the amounts you are approving. By signing, you authorize us to file your return electronically.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Balance title="Federal" side={state.totals.federal} />
            <Balance title="California" side={state.totals.california} />
          </div>
          {s.kind === 'ready' && acting && (
            <ActButton type="client_approve" target={`act:${s.requestSeq}`} className="self-start">
              Approve and sign with my PIN
            </ActButton>
          )}
          {s.kind === 'signed' && (
            <p className="inline-flex items-center gap-1.5 text-sm text-emerald-800 dark:text-emerald-300">
              <CircleCheckIcon className="size-4" /> You signed.
              {s.waitingFor.length > 0 && <span className="text-muted-foreground"> Waiting for {s.waitingFor.join(' and ')}.</span>}
            </p>
          )}
        </>
      )}
    </Card>
  )
}

function Balance({ title, side }: { title: string; side: TotalsSide }) {
  const owe = side.balance_estimate
  const estimate = side.delta !== 0
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 p-3">
      <span className="text-xs text-muted-foreground">{title}</span>
      <span className="text-lg font-semibold">
        <Money value={Math.abs(owe)} />
      </span>
      <span className="text-xs">
        {owe >= 0 ? 'you owe' : 'refund to you'}
        {estimate && <span className="text-muted-foreground"> · estimate: includes changes the tax software has not recomputed</span>}
      </span>
    </div>
  )
}

function Copy() {
  const { state } = useWorkspace()
  const [open, setOpen] = useState(false)
  if (!state.frozen.federal && !state.frozen.california) return null
  return (
    <Card title="Your copy">
      <p className="text-sm">A summary of the return as filed, ready to print or save as PDF.</p>
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <FileTextIcon /> Open your copy
      </Button>
      {open && (
        <PrintSheet title="Your copy of the return" onClose={() => setOpen(false)}>
          <ClientCopy />
        </PrintSheet>
      )}
    </Card>
  )
}
