'use client'
// /filing's "Client approval and submit" section (spec 3, §5): the request, each client's approval in words, then
// Request approval and Submit. Both buttons render for every viewer; a refused one stays focusable and says why. The step
// reasons are not repeated here: they live once, under #steps.
import { CircleCheckIcon, RotateCcwIcon } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { refHref } from '@/components/atoms'
import { useWorkspace } from '@/components/workspace/context'
import type { OpenActRequest } from '@/components/workspace/types'
import { cn } from '@/lib/utils'
import { ActReasonText, FilingAct } from './filing-act'
import { type SpouseStatus, spouseStatus } from './filing-logic'
import { JUR, type Jur, JURS, nameOf } from './filing-status'
import { A } from './item-list'

const SPOUSE: Record<SpouseStatus, { words: string; className: string; icon: ReactNode }> = {
  not_requested: { words: 'Not requested', className: 'text-muted-foreground', icon: null },
  pending: { words: 'Waiting for approval', className: 'text-warning', icon: null },
  approved: { words: 'Approved', className: 'text-success', icon: <CircleCheckIcon aria-hidden className="size-4 shrink-0" /> },
  reopened: {
    words: 'Amounts changed; a new request is needed',
    className: 'text-warning',
    icon: <RotateCcwIcon aria-hidden className="size-4 shrink-0" />,
  },
}

const CAUTION = "The request is still current; requesting again restarts both clients' approval."

export function ApprovalSubmit(): ReactElement {
  const { model, state } = useWorkspace()
  const ap = state.approval
  const clients = model.packet.firm.client_users.map((u) => ({ id: u.id, name: u.name, status: spouseStatus(state, u.id) }))
  const open: Jur[] = JURS.filter((j) => !state.frozen[j])
  const js: Jur[] = open.length ? open : [...JURS]
  const requestApproval: OpenActRequest = { type: 'request_approval', target: 'return' }
  const submit: OpenActRequest = { type: 'file', target: 'return', prefill: { kind: 'submit', jurisdictions: js } }
  // Requesting again while the request is current restarts the approvals already given; authorize() allows it.
  const caution = ap?.current && clients.some((c) => c.status !== 'approved') ? CAUTION : undefined
  // A focus return (act-host.tsx, returnFocusTo): Submit freezing the return swaps its button for the refused form.
  return (
    <section
      aria-labelledby="approval"
      data-focus-return
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h2 id="approval" className="scroll-mt-44 text-base font-semibold lg:scroll-mt-20">
        Client approval and submit
      </h2>
      <p className="max-w-prose text-xs text-muted-foreground">
        The clients approve exact amounts; any amount change reopens their approval.
      </p>
      {ap && (
        <p className="text-sm">
          Requested by {nameOf(model, ap.requested_by)} (<A href={refHref(`act:${ap.request_seq}`)}>{`change ${ap.request_seq}`}</A>);{' '}
          {ap.current ? 'the amounts are unchanged since.' : 'an amount changed since, so a new request is needed.'}
        </p>
      )}
      <ul className="flex flex-col divide-y text-sm">
        {clients.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span className="font-medium">{c.name}</span>
            <span className={cn('inline-flex items-center gap-1', SPOUSE[c.status].className)}>
              {SPOUSE[c.status].icon}
              {SPOUSE[c.status].words}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-start gap-2">
        <FilingAct request={requestApproval} reason={<ActReasonText request={requestApproval} gate="request_approval" />} caution={caution}>
          {ap ? 'Request approval again' : 'Request approval'}
        </FilingAct>
        <FilingAct request={submit} reason={<ActReasonText request={submit} gate="submit" />}>
          {`Submit ${js.map((j) => JUR[j]).join(' and ')}`}
        </FilingAct>
      </div>
    </section>
  )
}
