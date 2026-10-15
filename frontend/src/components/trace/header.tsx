'use client'
// Trace header: what the claim is, its value now and before, status, support, timing, effect, and the acts.
import type { ReactNode } from 'react'
import { ActButton } from '@/components/acts/act-host'
import { formatClock } from '@/components/atoms/format'
import { Stake } from '@/components/atoms/money'
import { RefLink } from '@/components/atoms/ref-link'
import { FlagChips, StatusPill, SupportLetters } from '@/components/atoms/status'
import { useWorkspace } from '@/components/workspace/context'
import type { OpenActRequest } from '@/components/workspace/types'
import type { Claim, ClaimKind } from '@/lib/model/claims'
import type { ClaimState } from '@/lib/model/state'
import { useWho, ValueText } from './parts'
import { netEffect } from './resolve'

const KIND_LABEL: Record<ClaimKind, string> = {
  line: 'Return line', doc: 'Document', comm: 'Client communication', fact: 'Household fact', step: 'Firm required step',
  whatif: 'Engine alternative', diag: 'Engine diagnostic', prior_item: 'Prior-preparer item',
}

export function TraceTitle({ refId, kind, label, children }: { refId: string; kind: string; label: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-w-0 flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>{kind}</span>
        <span className="font-mono text-foreground">{refId}</span>
      </p>
      <h1 className="text-lg leading-snug font-semibold text-balance">{label}</h1>
      {children}
    </header>
  )
}

export function ClaimHeader({ claim, cs }: { claim: Claim; cs: ClaimState | undefined }) {
  const { state } = useWorkspace()
  const who = useWho()
  const net = netEffect(state, claim.id)
  const adj = cs?.adjust
  const later = claim.knownAt > state.clock
  const jur = claim.jurisdiction === 'california' ? 'CA' : claim.jurisdiction === 'federal' ? 'Fed' : null
  // Comms show their text and diagnostics their severity below; only numbers and facts get the big value.
  const valued = claim.kind === 'line' || claim.kind === 'fact'
  return (
    <TraceTitle refId={claim.id} kind={[KIND_LABEL[claim.kind], claim.form].filter(Boolean).join(' · ')} label={claim.label}>
      {valued && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {jur && <span className="text-xs text-muted-foreground">{jur}</span>}
          <ValueText value={cs?.effective ?? claim.value} context={claim.id} className="font-mono text-xl font-semibold tabular-nums" />
          {adj?.field === 'value' && (
            <s className="font-mono text-sm text-muted-foreground" title="Packet value before the live adjustment">
              <ValueText value={cs?.original ?? null} context={claim.id} />
            </s>
          )}
          {adj && adj.field !== 'value' && (
            <span className="text-sm">
              {adj.field} <s className="text-muted-foreground"><ValueText value={adj.from} context={claim.id} /></s> → <ValueText value={adj.to} context={claim.id} />
            </span>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {cs && <StatusPill status={cs.status} />}
        {cs && <FlagChips flags={cs.flags} />}
        {cs && <SupportLetters support={cs.support} />}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Item label={later ? 'Not yet in file' : 'In file since'} dim={later}>{formatClock(claim.knownAt)}</Item>
        {net.count > 0 && (
          <Item label={`Net effect of ${net.count} live ${net.count === 1 ? 'adjustment' : 'adjustments'}`}>
            {net.fed || net.ca ? <Stake fed={net.fed} ca={net.ca} /> : 'none'}
          </Item>
        )}
        {adj?.needs_partner && <Item label="Partner">{adj.partner_covered ? 'covered by a valid partner sign-off' : 'needs partner sign-off (over 1,000)'}</Item>}
        {cs && cs.preparedBy.length > 0 && <Item label="Prepared by">{cs.preparedBy.map(who).join(', ')}</Item>}
        {cs?.disposition && (
          <Item label="Disposed">
            {cs.disposition.disposition.replaceAll('_', ' ')}{cs.disposition.ref && <> <RefLink to={cs.disposition.ref} /></>} by {who(cs.disposition.actor)}
          </Item>
        )}
        {cs?.decision && <Item label="Decided">{cs.decision.choice} ({cs.decision.authority}) by {who(cs.decision.actor)}</Item>}
        {cs && cs.openBelow > 0 && <Item label="Open below">{cs.openBelow} inputs</Item>}
        {claim.kind === 'diag' && <Item label="Engine says">{String(claim.value)}</Item>}
      </dl>
    </TraceTitle>
  )
}

function Item({ label, children, dim }: { label: string; children: ReactNode; dim?: boolean }) {
  return (
    <div className={dim ? 'flex gap-1 text-muted-foreground' : 'flex gap-1'}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

type Action = { type: OpenActRequest['type']; label: string; prefill?: Record<string, unknown> }

const NOTE: Action = { type: 'note', label: 'Note', prefill: { kind: 'memo' } }
const ASK: Action = { type: 'note', label: 'Ask client', prefill: { kind: 'question_client' } }
const REVIEW: Action = { type: 'note', label: 'Review note', prefill: { kind: 'review_note' } }
const ATTACH: Action = { type: 'attach', label: 'Attach' }
const VERIFY: Action = { type: 'verify', label: 'Verify' }
const ADJUST: Action = { type: 'adjust', label: 'Adjust' }
const DECIDE: Action = { type: 'decide', label: 'Decide' }
const DISPOSE: Action = { type: 'dispose', label: 'Dispose' }

export type ActionKind = ClaimKind | 'page' | 'entry' | 'other'

const ACTIONS: Record<ActionKind, Action[]> = {
  line: [VERIFY, ADJUST, DECIDE, NOTE, ASK, REVIEW, ATTACH],
  fact: [VERIFY, ADJUST, DECIDE, NOTE, ASK, REVIEW, ATTACH],
  doc: [VERIFY, DISPOSE, NOTE, ASK, REVIEW, ATTACH],
  comm: [VERIFY, DISPOSE, NOTE, REVIEW, ATTACH],
  step: [NOTE, REVIEW, ATTACH],
  whatif: [DECIDE, DISPOSE, NOTE, REVIEW],
  diag: [DECIDE, DISPOSE, NOTE, REVIEW],
  prior_item: [DISPOSE, NOTE, REVIEW, ATTACH],
  page: [DISPOSE, NOTE, REVIEW, ATTACH],
  entry: [{ type: 'adjust', label: 'Answer' }, NOTE, REVIEW, ATTACH],
  other: [NOTE, REVIEW, ATTACH],
}

/** The acts that fit this kind of ref. Each is disabled with the authorize() reason when not allowed. */
export function ActionBar({ target, kind }: { target: string; kind: ActionKind }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Actions">
      {ACTIONS[kind].map((a) => (
        <ActButton key={a.label} type={a.type} target={target} prefill={a.prefill} size="sm" variant="outline">
          {a.label}
        </ActButton>
      ))}
    </div>
  )
}
