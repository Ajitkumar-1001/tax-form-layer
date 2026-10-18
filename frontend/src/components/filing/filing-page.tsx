'use client'
// /filing, the filing checklist (spec 3): status, required steps, approval and submit, sign-offs, partner desk and the record.
import { type ReactElement, type ReactNode, useEffect } from 'react'
import { LockIcon } from 'lucide-react'
import { useWorkspace } from '@/components/workspace/context'
import { plainMasked } from '@/lib/model/mask-token'
import { ApprovalSubmit } from './approval-submit'
import { type FilingStatus, filingStatus, JUR, JURS } from './filing-status'
import { FilingsRecord } from './filings-record'
import { A } from './item-list'
import { PartnerDesk } from './partner-desk'
import { RequiredSteps } from './required-steps'
import { ExtensionPanel, SeasonRecord } from './season-panels'
import { SignoffMatrix } from './signoff-matrix'

export function FilingPage(): ReactElement {
  // The page renders only once the workspace has booted, after the browser's own jump to #steps (or #matrix) found
  // nothing, so jump once here.
  useEffect(() => {
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
  }, [])
  return (
    <div className="flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">Filing desk</h1>
          <Chip />
        </div>
        <StatusLine />
      </header>
      <RequiredSteps />
      <ApprovalSubmit />
      <Section
        id="matrix"
        title="Sign-offs"
        hint="A sign-off covers the values and decisions, the evidence, the findings and the open notes and questions in its scope, and reopens itself when any of them changes."
      >
        <SignoffMatrix />
      </Section>
      <Section id="desk" title="Partner desk" hint="Adjustments over 1,000 and open process findings that need the partner's sign-off.">
        <PartnerDesk />
      </Section>
      <Section id="record" title="Record">
        <div className="flex flex-col gap-6">
          <Section level={3} id="filings" title="Filings and agency results" hint="Agency responses are simulated by one disclosed rule (see About).">
            <FilingsRecord />
          </Section>
          <Section level={3} id="extension" title="Extension">
            <ExtensionPanel />
          </Section>
          <Section
            level={3}
            id="season"
            title="Season record"
            hint="What the packet says happened after return version 3, shown as the season clock passes it. These are packet facts, not acts in this workpaper."
          >
            <SeasonRecord />
          </Section>
        </div>
      </Section>
    </div>
  )
}

// A link to /filing#<id> lands on the heading; its scroll margin keeps it clear of the sticky header (one 56 px row from
// lg, two rows below). Required steps and Client approval and submit write their own sections (§2's literal anchors).
const HEADING = {
  2: 'scroll-mt-44 text-base font-semibold lg:scroll-mt-20',
  3: 'scroll-mt-44 text-sm font-semibold lg:scroll-mt-20',
} as const

/**
 * A headed section (§2): the heading carries the id links land on, then at most one hint line. It is a focus return
 * (`data-focus-return`) for an act dialog whose opener inside it is gone or disabled (act-host.tsx, returnFocusTo),
 * e.g. Open amendment once nothing is frozen, and for the partner desk's own sign-off.
 */
function Section({ id, title, hint, level = 2, children }: { id: string; title: string; hint?: string; level?: 2 | 3; children: ReactNode }) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section
      aria-labelledby={id}
      data-focus-return
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Heading id={id} className={HEADING[level]}>
        {title}
      </Heading>
      {hint && <p className="max-w-prose text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  )
}

/** Beside the h1, once (§3.4): what is frozen, else the open amendment, else nothing. */
function Chip() {
  const { state } = useWorkspace()
  const frozen = JURS.filter((j) => state.frozen[j])
  if (frozen.length) {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium text-foreground">
        <LockIcon aria-hidden className="size-3" />
        {`Frozen: ${frozen.map((j) => JUR[j]).join(' and ')} filed and accepted`}
      </span>
    )
  }
  if (state.amendment > 0) {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-info-soft px-2 text-xs font-medium text-info">
        {`Amendment ${state.amendment} open`}
      </span>
    )
  }
  return null
}

/** Where filing stands, then the viewer's next step for it or why they have none (§3.1). */
function StatusLine() {
  const { model, state, viewer } = useWorkspace()
  const status = filingStatus(model, state, viewer)
  return (
    <p data-filing-status className="max-w-prose text-sm leading-relaxed text-pretty">
      {plainMasked(status.headline)}{' '}
      {status.next
        ? <>Your next step for filing: <A href={status.next.href}>{plainMasked(status.next.text)}</A>.</>
        : <NoneText none={status.none!} />}
    </p>
  )
}

/** Why the viewer has no next step. Its `link` phrase, when set, is split out at its first occurrence and linked. */
function NoneText({ none }: { none: NonNullable<FilingStatus['none']> }) {
  const { link } = none
  const at = link ? none.text.indexOf(link.text) : -1
  if (!link || at < 0) return <>{plainMasked(none.text)}</>
  return (
    <>
      {plainMasked(none.text.slice(0, at))}
      <A href={link.href}>{plainMasked(link.text)}</A>
      {plainMasked(none.text.slice(at + link.text.length))}
    </>
  )
}
