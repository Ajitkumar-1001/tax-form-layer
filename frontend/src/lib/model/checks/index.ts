// Registry of every check, one file per family group (each file owned by one implementer).
import type { Check, CheckContext, Finding } from './types'
import { checks as printed } from './printed-vs-extracted'
import { checks as sums } from './sum-vs-detail'
import { checks as dups } from './duplicates'
import { checks as coverage } from './coverage'
import { checks as cross } from './cross-document'
import { checks as agency } from './agency'
import { checks as answers } from './client-answers'
import { checks as swings } from './swings'
import { checks as carry } from './carryovers'
import { checks as recompute } from './recompute'
import { checks as state } from './state-sourcing'
import { checks as process } from './process'

export const ALL_CHECKS: Check[] = [
  ...printed, ...sums, ...dups, ...coverage, ...cross, ...agency,
  ...answers, ...swings, ...carry, ...recompute, ...state, ...process,
]

/** Run every check. A check that throws becomes one visible finding instead of breaking the workpaper. */
export function runChecks(ctx: CheckContext): Finding[] {
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const c of ALL_CHECKS) {
    let found: Finding[]
    try {
      found = c.run(ctx)
    } catch (e) {
      found = [{
        id: `chk:${c.id}:crashed`, check: c.id, family: c.family, severity: 'warning', signal: 'computed',
        title: `${c.id} ${c.name} could not run`, why: String(e), claims: ['step:9'], evidence: [], knownSince: '2026-01-12T17:06:00Z',
      }]
    }
    for (const f of found) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push({ ...f, claims: f.claims.filter((id) => ctx.claims[id]) })
    }
  }
  return out
}
