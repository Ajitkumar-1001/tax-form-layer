'use client'
// Tab 3: who touched it, when (wall and season time), why, with what effect; sign-offs; reveal log.
import { ActButton } from '@/components/acts/act-host'
import { Ago } from '@/components/atoms/ago'
import { formatClock } from '@/components/atoms/format'
import { MaskedText } from '@/components/atoms/masked-text'
import { Stake } from '@/components/atoms/money'
import { RefLink } from '@/components/atoms/ref-link'
import { useWorkspace } from '@/components/workspace/context'
import type { Act, AdjustDerived } from '@/lib/model/acts'
import type { Claim, Val } from '@/lib/model/claims'
import { cn } from '@/lib/utils'
import { Empty, Section, useWho, ValueText } from './parts'
import { historyFor, signoffsCovering, viewLogFor } from './resolve'

/** The one-line "what" of an act, from its body. */
function ActWhat({ act }: { act: Act }) {
  const b = act.body as Record<string, unknown>
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '')
  const ctx = act.target
  switch (act.type) {
    case 'adjust':
      return (
        <span>
          {s('field')} <ValueText value={(act.derived as Partial<AdjustDerived>).from as Val} context={ctx} /> → <ValueText value={b.to as Val} context={ctx} />
        </span>
      )
    case 'verify':
      return <span>{s('method').replaceAll('_', ' ')} at {s('level')} level</span>
    case 'decide':
      return <span>{s('kind').replaceAll('_', ' ')}: {s('choice')} <span className="text-muted-foreground">(authority: {s('authority')})</span></span>
    case 'dispose':
      return <span>{s('disposition').replaceAll('_', ' ')}{s('ref') && <> <RefLink to={s('ref')} /></>}</span>
    case 'note':
      return <span>{s('kind').replaceAll('_', ' ')}{b.blocking === true && ' (blocking)'}{s('to') && ` to ${s('to')}`}: <MaskedText text={s('text')} context={ctx} /></span>
    case 'reply':
    case 'resolve':
      return <span>{s('resolution') && `${s('resolution')}: `}<MaskedText text={s('text')} context={ctx} /></span>
    case 'attach':
      return <span>{s('label')}</span>
    case 'signoff':
      return <span>{s('level')} sign-off</span>
    case 'clock':
      return <span>to {formatClock(s('to'))}</span>
    default:
      return null
  }
}

export function ActRow({ act, reverted, revertable }: { act: Act; reverted: boolean; revertable: boolean }) {
  const who = useWho()
  const b = act.body as { reason?: string }
  const effect = act.type === 'adjust' ? (act.derived as Partial<AdjustDerived>).effect : undefined
  return (
    <li className={cn('flex flex-col gap-0.5 border-t py-2 text-sm first:border-t-0', reverted && 'text-muted-foreground')}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <RefLink to={`act:${act.seq}`} className="font-mono text-xs">#{act.seq}</RefLink>
        <span className={cn('font-medium', reverted && 'line-through')}>{act.type.replaceAll('_', ' ')}</span>
        <span className={cn(reverted && 'line-through')}><ActWhat act={act} /></span>
        {reverted && <span className="rounded bg-muted px-1 text-xs">reverted</span>}
        {revertable && (
          <ActButton type="revert" target={`act:${act.seq}`} size="xs" variant="ghost" className="ml-auto">
            Revert
          </ActButton>
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{who(act.actor)}</span>
        <span><Ago iso={act.recorded_at} /> ({formatClock(act.recorded_at)})</span>
        <span>season {formatClock(act.season_at)}</span>
        {act.target && <span>on <RefLink to={act.target} /></span>}
        {act.batch_id && <span>batch <RefLink to={`batch:${act.batch_id}`}>{act.batch_id.slice(0, 8)}</RefLink></span>}
      </p>
      {b.reason && <p className={cn('text-xs', reverted && 'line-through')}>Why: <MaskedText text={b.reason} context={act.target} /></p>}
      {effect && (effect.fed !== 0 || effect.ca !== 0) && (
        <p className="text-xs">Effect <Stake fed={effect.fed} ca={effect.ca} /> <span className="text-muted-foreground">({effect.basis})</span></p>
      )}
    </li>
  )
}

export function ActList({ refs }: { refs: string[] }) {
  const { state } = useWorkspace()
  const rows = historyFor(state, refs)
  return rows.length ? <ul>{rows.map((r) => <ActRow key={r.act.seq} {...r} />)}</ul> : <Empty>Nothing recorded yet.</Empty>
}

export function HistoryTab({ refs, claim, value }: { refs: string[]; claim?: Pick<Claim, 'id' | 'area'>; value?: Val }) {
  const { state } = useWorkspace()
  const who = useWho()
  const signoffs = claim ? signoffsCovering(state, claim) : []
  const views = viewLogFor(state, refs[0], value)
  return (
    <div className="flex flex-col gap-6">
      <Section title="Acts">
        <ActList refs={refs} />
      </Section>
      {claim && (
        <Section title="Sign-offs covering it">
          {signoffs.length ? (
            <ul className="grid gap-1 text-sm">
              {signoffs.map((s) => (
                <li key={s.seq} className="flex flex-wrap items-baseline gap-x-2">
                  <RefLink to={`act:${s.seq}`} className="font-mono text-xs">#{s.seq}</RefLink>
                  <span>{s.level} on {s.target}</span>
                  <span className="text-muted-foreground">{who(s.actor)} · <Ago iso={s.recorded_at} /></span>
                  <span className={s.valid ? 'text-emerald-700 dark:text-emerald-300' : 'text-orange-700 dark:text-orange-300'}>
                    {s.valid ? 'valid' : `reopened: ${s.changed.length} of ${s.scope_size} changed`}
                  </span>
                  {s.changedHere && <span className="text-xs">this claim changed since signing</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No sign-off covers it yet.</Empty>
          )}
        </Section>
      )}
      {views.length > 0 && (
        <Section title="Reveal log">
          <ul className="grid gap-1 text-sm">
            {views.map((a) => {
              const b = a.body as { denied?: boolean; reason?: string; kind?: string }
              return (
                <li key={a.seq} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs">#{a.seq}</span>
                  <span>{who(a.actor)}</span>
                  <span className={b.denied ? 'text-destructive' : ''}>{b.denied ? `refused${b.reason ? `: ${b.reason}` : ''}` : `revealed ${b.kind ?? ''}`}</span>
                  <span className="text-muted-foreground"><Ago iso={a.recorded_at} /></span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
    </div>
  )
}
