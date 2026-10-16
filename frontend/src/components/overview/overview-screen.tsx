'use client'
// The Overview, home of every staff role (spec §4): one sentence on where the return stands, then headed sections.
// One DOM order serves every width (§4.3): the main column, then the side column, so keyboard order is screen order.
// Season replay (§5.4): with a valid ?at=<seq>&eng=<engagement>, the sentence and every section come from the log as
// it stood after that change, with act controls and reveals off (ReplayContext) and Recent activity hidden. The h1,
// the Replay control and its banner stay live, as do the rail and the top bar.
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useWorkspace } from '@/components/workspace/context'
import { project } from '@/lib/model/project'
import { ActivitySection } from './activity'
import { BlockersSection } from './blockers'
import { MoneySection } from './money'
import { NextStepsSection } from './next-steps'
import { summarize } from './overview-model'
import { ReplayBar, parseReplayCursor, writeReplayCursor } from './replay-bar'
import { ReplayContext } from './replay-safe'
import { TeamSection } from './team'
import { WhereSection } from './where-we-are'

export function OverviewScreen() {
  const { model, state, viewer, engagement } = useWorkspace()
  const params = useSearchParams()
  const heading = useRef<HTMLHeadingElement>(null)
  const cursor = parseReplayCursor(params, state.acts, engagement)
  const stray = cursor === null && (params.has('at') || params.has('eng'))
  useEffect(() => {
    if (stray) writeReplayCursor(null)
  }, [stray])

  // The thumb while dragging, tied to the point it was dragged from and retired once the URL moves. Next applies
  // replaceState in a transition, so clearing it on release would flash the old point until that lands.
  const [drag, setDrag] = useState<{ index: number; from: number } | null>(null)
  const dragging = cursor !== null && drag !== null && drag.from === cursor.seq ? drag.index : null
  const at = cursor === null ? null : (dragging ?? cursor.index)
  // The bar follows the pointer at once; the replayed summary (about 6 ms a step) follows when React has time.
  const shownAt = useDeferredValue(at)
  // Live again only when both have caught up: a stale replayed frame must never mount an act control.
  const replaying = at !== null || shownAt !== null
  const overview = summarize(model, shownAt === null ? state : project(model, state.acts.slice(0, shownAt), viewer, engagement), viewer)

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          {/* tabIndex -1: "Back to live" focuses it when the Replay button is hidden (below sm) or absent (empty log). */}
          <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold">
            Overview
          </h1>
          <p className="max-w-prose text-sm leading-relaxed text-pretty">{overview.sentence}</p>
        </div>
        {/* The Replay button at the header's right; while replaying, the bar and its banner wrap to a full row below. */}
        <ReplayBar
          cursor={cursor}
          drag={dragging}
          onDrag={(i) => setDrag(i === null || cursor === null ? null : { index: i, from: cursor.seq })}
          heading={heading}
        />
      </header>
      <ReplayContext value={replaying}>
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
            <NextStepsSection next={overview.next} />
            <BlockersSection blockers={overview.blockers} />
            <MoneySection money={overview.money} />
            <TeamSection team={overview.team} />
          </div>
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
            <WhereSection where={overview.where} />
            {!replaying && <ActivitySection />}
          </div>
        </div>
      </ReplayContext>
    </div>
  )
}
