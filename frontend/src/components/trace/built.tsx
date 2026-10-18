'use client'
// Tab 2: how the value was built — the engine rule verbatim, the inputs tree, every version, the what-ifs.
import { useState } from 'react'
import { Money } from '@/components/atoms/money'
import { RefLink } from '@/components/atoms/ref-link'
import { StatusPill } from '@/components/atoms/status'
import { useWorkspace } from '@/components/workspace/context'
import type { Claim } from '@/lib/model/claims'
import { Empty, JsonView, Section, ValueText } from './parts'
import { type Provenance, provenanceOf, valueRows, whatIfsTouching } from './resolve'

export function BuiltTab({ claim }: { claim: Claim }) {
  switch (claim.kind) {
    case 'line':
      return <LineBuilt claim={claim} />
    case 'whatif':
      return <WhatIfBuilt id={claim.id.slice('whatif:'.length)} />
    case 'diag':
      return <DiagBuilt code={claim.id.slice('diag:'.length)} />
    case 'step':
      return <StepBuilt n={Number(claim.id.slice('step:'.length))} />
    default:
      return (
        <Section title="Sources">
          {claim.sources.length ? <p className="flex flex-wrap gap-2 text-sm">{claim.sources.map((s) => <RefLink key={s} to={s} />)}</p> : <Empty>Entered, not computed.</Empty>}
        </Section>
      )
  }
}

/** What a line with no input lines is, by where its value comes from (provenanceOf). */
const LEAF: Record<Provenance, string> = {
  documents: 'A leaf: read from sources, not computed from other lines.',
  inputs: 'A leaf: read from sources, not computed from other lines.', // not reached: a line with inputs shows its tree
  client: 'A leaf: read from client statements or firm events only, not from a document.',
  unsourced: 'No sources and no input lines: nothing shows where this value came from.',
  engine: 'Set by the engine (see the rule above): no sources and no input lines.',
}

function LineBuilt({ claim }: { claim: Claim }) {
  const { model, state } = useWorkspace()
  const prov = provenanceOf(model, claim)
  const rule = claim.rule ? model.packet.engine_reference.rules[claim.rule] : undefined
  const whatIfs = whatIfsTouching(model, claim.id)
  return (
    <div className="flex flex-col gap-6">
      <Section title={<>Engine rule {claim.rule && <span className="font-mono normal-case">{claim.rule}</span>}</>}>
        {rule ? <blockquote className="border-l-2 pl-3 text-sm">{rule}</blockquote> : <Empty>No rule text in engine_reference.</Empty>}
        {claim.note && <p className="text-sm"><span className="text-muted-foreground">Engine note: </span>{claim.note}</p>}
      </Section>

      <Section title="Inputs" aside={claim.usedBy.length ? <>feeds {claim.usedBy.map((u) => <RefLink key={u} to={u} className="ml-1" />)}</> : undefined}>
        {claim.inputs.length ? (
          <ul className="flex flex-col gap-0.5 text-sm">
            {claim.inputs.map((k) => <InputNode key={k} id={k} trail={[claim.id]} />)}
          </ul>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-muted-foreground">{LEAF[prov.kind]}</p>
            {claim.sources.length > 0 && <p className="flex flex-wrap gap-2">{claim.sources.map((s) => <RefLink key={s} to={s} />)}</p>}
            {prov.kind === 'unsourced' && prov.finding && state.findings[prov.finding]?.visible && <RefLink to={prov.finding} className="w-fit">See the provenance finding</RefLink>}
          </div>
        )}
      </Section>

      <Section title="Values by version">
        <table className="w-full max-w-md text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr><th className="text-left font-normal">Version</th><th className="text-right font-normal">Value</th><th className="text-right font-normal">Change</th><th className="text-right font-normal">%</th></tr>
          </thead>
          <tbody>
            {valueRows(claim).map((r) => (
              <tr key={r.label} className="border-t">
                <td className="py-1">{r.label === '2024' ? '2024 return' : r.label}</td>
                <td className="py-1 text-right font-mono"><ValueText value={r.value} context={claim.id} /></td>
                <td className="py-1 text-right font-mono">{r.delta === null ? '' : <Money value={r.delta} signed />}</td>
                <td className="py-1 text-right font-mono tabular-nums">{r.pct === null ? '' : `${r.pct > 0 ? '+' : r.pct < 0 ? '−' : ''}${Math.abs(r.pct).toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {whatIfs.length > 0 && (
        <Section title="Engine alternatives that change this line">
          <ul className="grid gap-2 text-sm">
            {whatIfs.map((w) => (
              <li key={w.id} className="flex flex-col gap-0.5 rounded-md border p-3">
                <RefLink to={`whatif:${w.id}`}>{w.description}</RefLink>
                <p className="text-xs">
                  This line <Money value={w.old} /> → <Money value={w.new} /> (<Money value={w.new - w.old} signed />) · total tax Fed <Money value={w.fed} signed /> · CA <Money value={w.ca} signed />
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

/** One node of the inputs tree. Children render only when opened: some trees run to hundreds of lines. */
function InputNode({ id, trail }: { id: string; trail: string[] }) {
  const { model, state } = useWorkspace()
  const [open, setOpen] = useState(false)
  const c = model.claims[id]
  const cs = state.claims[id]
  const row = (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <RefLink to={id} />
      <span className="min-w-0 truncate text-muted-foreground" title={c?.label}>{c?.label ?? 'not a v3 line'}</span>
      <ValueText value={cs?.effective ?? c?.value} context={id} className="font-mono" />
      {cs && cs.status !== 'unreviewed' && <StatusPill status={cs.status} />}
      {cs && cs.openBelow > 0 && <span className="text-xs text-red-700 dark:text-red-300">{cs.openBelow} open below</span>}
    </span>
  )
  const inputs = c?.inputs ?? []
  if (!inputs.length || trail.includes(id)) return <li className="py-0.5 pl-5">{row}</li>
  return (
    <li>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="[&>summary]:cursor-pointer">
        <summary className="rounded py-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{row}</summary>
        {open && (
          <ul className="ml-2 flex flex-col gap-0.5 border-l pl-2">
            {inputs.map((k) => <InputNode key={k} id={k} trail={[...trail, id]} />)}
          </ul>
        )}
      </details>
    </li>
  )
}

function WhatIfBuilt({ id }: { id: string }) {
  const { model } = useWorkspace()
  const a = model.packet.what_if.alternatives.find((x) => x.id === id)
  if (!a) return <Empty>Alternative {id} is not in the packet.</Empty>
  const keys = Object.keys(a.federal.base)
  return (
    <div className="flex flex-col gap-6">
      <Section title={`Alternative to ${a.base_version}`}>
        <p className="text-sm">{a.description}</p>
        <p className="text-xs text-muted-foreground">Choices: {Object.entries(a.choices).map(([k, v]) => `${k} = ${v}`).join(', ')}</p>
        <p className="text-sm">
          Total tax change: Fed <Money value={a.federal.total_tax_change} signed />, penalty <Money value={a.federal.penalty_change} signed />, CA <Money value={a.california.total_tax_change} signed />
        </p>
      </Section>
      <Section title="Summary, base → alternative">
        <table className="w-full max-w-xl text-sm">
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="border-t">
                <td className="py-1">Fed {k.replaceAll('_', ' ')}</td>
                <td className="py-1 text-right font-mono"><Money value={a.federal.base[k]} /></td>
                <td className="py-1 text-right font-mono"><Money value={a.federal.alternative[k]} /></td>
              </tr>
            ))}
            {Object.keys(a.california.base).map((k) => (
              <tr key={`ca-${k}`} className="border-t">
                <td className="py-1">CA {k.replaceAll('_', ' ')}</td>
                <td className="py-1 text-right font-mono"><Money value={a.california.base[k]} /></td>
                <td className="py-1 text-right font-mono"><Money value={a.california.alternative[k]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Lines it changes">
        <ul className="grid gap-0.5 text-sm">
          {a.changed_lines.map((l) => (
            <li key={l.key} className="flex flex-wrap items-baseline gap-2">
              <RefLink to={l.key} />
              <Money value={l.old} /> → <Money value={l.new} /> <span className="text-muted-foreground">(<Money value={l.new - l.old} signed />)</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function DiagBuilt({ code }: { code: string }) {
  const { model } = useWorkspace()
  const rows = model.packet.return_versions.map((v) => ({ version: v.version, d: v.diagnostics.find((x) => x.code === code) }))
  return (
    <Section title="Diagnostic by version">
      <ul className="grid gap-2 text-sm">
        {rows.map(({ version, d }) => (
          <li key={version} className="flex flex-col gap-0.5 rounded-md border p-2">
            <span className="font-mono text-xs">{version}</span>
            {d ? (
              <>
                <span>{d.severity}: {d.message}</span>
                <span className="flex flex-wrap gap-2 text-xs">{d.refs.map((r) => <RefLink key={r} to={r} />)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">not raised</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function StepBuilt({ n }: { n: number }) {
  const { state, model } = useWorkspace()
  const s = state.steps[n - 1]
  if (!s) return <Empty>No such step.</Empty>
  return (
    <div className="flex flex-col gap-4">
      <Section title={s.ok ? 'Met' : 'Not met yet'}>
        {s.reasons.length ? (
          <ul className="grid gap-1 text-sm">
            {s.reasons.map((r, i) => <li key={i}>{r.ref ? <RefLink to={r.ref}>{r.text}</RefLink> : r.text}</li>)}
          </ul>
        ) : (
          <Empty>Every item this step needs is in place.</Empty>
        )}
      </Section>
      <Section title="Firm standard">
        <JsonView value={model.packet.firm.starter_standards.required_steps[n - 1]} context={`step:${n}`} />
      </Section>
    </div>
  )
}
