// The disclosed e-file simulation. It stands in for the IRS e-file database with one rule that reads data
// (effective household facts vs the last accepted return), never finding status, so an override cannot fool it.
import 'server-only'
import type { Act, AgencyResultBody } from '@/lib/model/acts'
import type { Model } from '@/lib/model/build'
import { sameValue } from '@/lib/model/mask-token'
import type { State } from '@/lib/model/state'
import type { NewAct } from './acts-repo'

export const EFILE_RULE =
  "Simulated e-file: federal is rejected when any dependent's effective SSN differs from that dependent's SSN " +
  'on the last accepted return (py:/return_2024/dependents); California is held when federal is rejected; ' +
  'otherwise each jurisdiction is accepted.'

export interface EfileOutcome extends AgencyResultBody {
  refs: string[]
}

/** Agency answers for a file{submit} of `jurisdictions`, given the state after the file act. */
export function simulateEfile(model: Model, state: State, jurisdictions: ('federal' | 'california')[]): EfileOutcome[] {
  const p = model.packet
  const efile = p.tax_agency_records.efile
  const fedAt = efile.findIndex((e) => e.jurisdiction === 'federal' && e.errors?.length)
  const caAt = efile.findIndex((e) => e.jurisdiction === 'california' && e.errors?.length)
  // The rejection is modelled on the packet's own federal rejection; the packet is sealed, so it is always there.
  const template = efile[fedAt]?.errors?.[0]
  if (!template) throw new Error('Simulated e-file: the packet has no federal e-file rejection to model the answer on')

  const mismatches = p.prior_years.return_2024.dependents.flatMap((d, i) => {
    const person = p.household.people.find((x) => x.role === 'dependent' && x.name === d.name)
    const ref = person && `household:${person.id}#ssn`
    if (!ref || sameValue(state.claims[ref]?.effective ?? person.ssn, d.ssn)) return []
    const message = template.message.replace(/\(dependent \d+: [^)]*\)/, `(dependent ${i + 1}: ${d.name})`)
    return [{ ref, error: { code: template.code, message } }]
  })
  const fedRejected = jurisdictions.includes('federal') && mismatches.length > 0

  return jurisdictions.map((j): EfileOutcome => {
    if (j === 'federal' && fedRejected) {
      return {
        jurisdiction: j, status: 'rejected', errors: mismatches.map((m) => m.error), rule: EFILE_RULE,
        refs: [`agency:/efile/${fedAt}`, ...mismatches.map((m) => m.ref)],
      }
    }
    if (j === 'california' && fedRejected) {
      return { jurisdiction: j, status: 'held', errors: efile[caAt]?.errors ?? [], rule: EFILE_RULE, refs: [`agency:/efile/${caAt}`] }
    }
    return { jurisdiction: j, status: 'accepted', errors: [], rule: EFILE_RULE, refs: [] }
  })
}

/** The `system` agency_result rows for a stored file{submit} act. Records are kept 7 years after acceptance. */
export function agencyActs(model: Model, state: State, file: Act, jurisdictions: ('federal' | 'california')[]): NewAct[] {
  return simulateEfile(model, state, jurisdictions).map(({ refs, ...body }) => {
    const retain = new Date(file.season_at)
    retain.setUTCFullYear(retain.getUTCFullYear() + 7)
    return {
      engagement: file.engagement,
      recorded_at: new Date().toISOString(),
      season_at: file.season_at,
      actor: 'system',
      actor_role: 'system',
      type: 'agency_result',
      target: `act:${file.seq}`,
      refs: [`act:${file.seq}`, ...refs],
      body: { ...body },
      derived: body.status === 'accepted' ? { retain_until: retain.toISOString() } : {},
      batch_id: null,
    }
  })
}
