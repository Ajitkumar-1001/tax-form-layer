'use client'
// The universal claim pane for any ref (spec §3.2). Full page at /r/[...ref]; compact beside the queue
// (header, findings and evidence only, with a link to the full trace).
import { type ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { refHref } from '@/components/atoms/format'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspace } from '@/components/workspace/context'
import type { Claim } from '@/lib/model/claims'
import { cn } from '@/lib/utils'
import { BuiltTab } from './built'
import { EvidenceTab } from './evidence'
import { FindingsList } from './findings'
import { ActionBar, ClaimHeader } from './header'
import { HistoryTab } from './history'
import { claimFindingIds, pageRefForms, resolveRef } from './resolve'
import { ActView, AreaView, BatchView, DataView, EntryView, EvView, FindingView, NotFound, PageView } from './views'

export function ClaimPane({ claimRef, compact = false }: { claimRef: string; compact?: boolean }) {
  const { model } = useWorkspace()
  const r = resolveRef(model, claimRef)
  let view: ReactNode
  switch (r.kind) {
    case 'claim':
      view = <ClaimView claim={r.claim} compact={compact} />
      break
    case 'ev':
      view = <EvView ev={r.ev} compact={compact} />
      break
    case 'page':
      view = <PageView refId={r.ref} doc={r.doc} page={r.page} compact={compact} />
      break
    case 'finding':
      view = <FindingView finding={r.finding} compact={compact} />
      break
    case 'act':
      view = <ActView refId={r.ref} seq={r.seq} compact={compact} />
      break
    case 'entry':
      view = <EntryView refId={r.ref} findings={r.findings} earlier={r.earlier} compact={compact} />
      break
    case 'data':
      view = <DataView refId={r.ref} title={r.title} value={r.value} compact={compact} />
      break
    case 'area':
      view = <AreaView refId={r.ref} area={r.area} compact={compact} />
      break
    case 'batch':
      view = <BatchView refId={r.ref} id={r.id} />
      break
    default:
      view = <NotFound refId={r.ref} />
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-5', compact ? 'p-3' : 'mx-auto w-full max-w-6xl p-4 md:p-6')}>
      {compact && r.kind !== 'unknown' && (
        <Link href={refHref(claimRef)} className="self-end text-xs text-primary underline-offset-2 hover:underline">
          Open full trace
        </Link>
      )}
      {view}
    </div>
  )
}

function ClaimView({ claim, compact }: { claim: Claim; compact: boolean }) {
  const { model, state } = useWorkspace()
  const cs = state.claims[claim.id]
  const findingIds = claimFindingIds(model, claim)
  const pageRefs = claim.kind === 'doc' ? (model.docs[claim.id]?.pages ?? []).flatMap((p) => pageRefForms(claim.id, p.page)) : []
  return (
    <>
      <ClaimHeader claim={claim} cs={cs} />
      <ActionBar target={claim.id} kind={claim.kind} />
      <FindingsList ids={findingIds} />
      {compact ? (
        <EvidenceTab claim={claim} />
      ) : (
        <TraceTabs
          evidence={<EvidenceTab claim={claim} />}
          built={<BuiltTab claim={claim} />}
          history={<HistoryTab refs={[claim.id, ...findingIds, ...pageRefs]} claim={claim} value={cs?.effective} />}
        />
      )}
    </>
  )
}

const TABS = [
  { value: 'evidence', label: 'Evidence' },
  { value: 'built', label: 'Built' },
  { value: 'history', label: 'History' },
] as const
type Tab = (typeof TABS)[number]['value']

/** Evidence / Built / History, each one keystroke (1, 2, 3) when focus is not in a field or dialog. */
function TraceTabs(panels: Record<Tab, ReactNode>) {
  const [tab, setTab] = useState<Tab>('evidence')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return
      const next = TABS[Number(e.key) - 1]
      if (next) setTab(next.value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList>
        {TABS.map((t, i) => (
          <TabsTrigger key={t.value} value={t.value} className="px-3">
            {t.label} <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">{i + 1}</kbd>
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-3">
          {panels[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  )
}
