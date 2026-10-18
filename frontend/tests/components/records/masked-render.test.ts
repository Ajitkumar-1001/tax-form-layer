// Regression (review screen:R must-fix 1): act text carrying masked tokens renders as •••-••-NNNN with Reveal on the
// records, documents and compare screens, never as the raw «ssn·…» literal. Server-rendered against the masked packet.
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { Act } from '@/lib/model/acts'
import { authorize } from '@/lib/model/authorize'
import { buildModel } from '@/lib/model/build'
import { project } from '@/lib/model/project'
import { identities, viewerOf } from '@/lib/model/viewer'
import { maskPacket } from '@/lib/server/mask'
import { BUILDERS } from '@/components/records/builders'
import { ClaimTable } from '@/components/records/claim-table'
import { CompareView } from '@/components/records/compare-view'
import { DocumentsView } from '@/components/records/documents-view'
import { actsOf, readPacket } from './fixture'

const nav = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/overview',
}))

const { masked, maskText, secrets } = maskPacket(readPacket())
const model = buildModel(masked)
const THEO = 'household:theo#ssn'
const acts = actsOf(model, [
  ['st-01', { type: 'adjust', target: THEO, body: { field: 'value', to: masked.prior_years.return_2024.dependents[1].ssn, reason: maskText('Transposed: 2024 return shows 666-74-3390', secrets), evidence: ['D06'] } }],
  ['st-01', { type: 'adjust', target: 'F1040.1a', body: { field: 'value', to: 200, reason: maskText('Corrected per the W-2 for 666-74-3309', secrets), evidence: ['D06'] } }],
  ['st-01', { type: 'dispose', target: 'D04', body: { disposition: 'informational', reason: maskText('ID copy, number 666-74-3309', secrets) } }],
  // Long enough that a 117-character cut would land inside the token.
  ['st-01', { type: 'note', target: 'D05', body: { kind: 'memo', text: maskText(`${'Compared the ID copies with the 2024 return'.padEnd(105, '.')}666-74-3309 per D06`, secrets), blocking: false } }],
])

function ws(log: Act[]): Workspace {
  const viewer = viewerOf(masked, 'st-03')
  const state = project(model, log, viewer)
  return {
    model, state, viewer, identities: identities(masked), engagement: 'main', packetSha: 'sha-test',
    post: async () => ({ ok: true, acts: [] }), can: (i) => authorize(model, state, i, viewer),
    reveal: async () => ({ ok: false, reason: 'n/a' }), switchIdentity: async () => {}, lastSeenSeq: 0, markSeen: () => {},
  }
}

const render = (el: ReactElement, query = '', log = acts) => {
  nav.query = query
  return renderToString(h(WorkspaceContext, { value: ws(log) }, el))
}

describe('masked tokens in act text', () => {
  it('fixture: the acts really carry tokens', () => {
    expect(String(acts[0].body.reason)).toContain('«ssn·3390·')
    expect(String(acts[2].body.reason)).toContain('«ssn·3309·')
    expect(String(acts[3].body.text).indexOf('«')).toBeLessThan(117)
    expect(String(acts[3].body.text).indexOf('»')).toBeGreaterThan(117)
  })

  it('records: the prior-preparer change and reason cells show •••-••-3390 with Reveal', () => {
    const w = ws(acts)
    const html = render(h(ClaimTable, { table: BUILDERS['prior-preparer'](model, w.state) }))
    expect(html).not.toContain('«')
    expect(html).toContain('•••-••-3390')
    expect(html).toContain('•••-••-3309')
    expect(html).toContain('Reveal')
  })

  it('documents: the disposition reason is masked', () => {
    const html = render(h(DocumentsView), 'unlanded=1')
    expect(html).toContain('ID copy, number')
    expect(html).toContain('•••-••-3309')
    expect(html).not.toContain('«')
  })

  it('since=me: the act detail column is masked and never cut mid-token', () => {
    const html = render(h(CompareView), 'since=me')
    expect(html).toContain('Compared the ID copies')
    expect(html).toContain('•••-••-3390')
    expect(html).toContain('•••-••-3309')
    expect(html).not.toContain('«')
  })

  it('compare: the adjust reason is masked and sits outside the act link', () => {
    const html = render(h(CompareView)) // defaults to v3 → now once something is adjusted
    expect(html).toMatch(/adjust #2 by [^<]+<\/a>/)
    expect(html).toContain('•••-••-3309')
    expect(html).not.toContain('«')
  })

  it('compare opens on v2 → v3 while nothing is adjusted', () => {
    const html = render(h(CompareView), '', [])
    expect(html).toMatch(/differ between <b>v2<\/b> and <b>v3<\/b>/)
  })

  it('compare stays on v2 → v3 when only a non-line claim is adjusted', () => {
    const html = render(h(CompareView), '', [acts[0]]) // acts[0] adjusts THEO's SSN, a household fact
    expect(html).toMatch(/differ between <b>v2<\/b> and <b>v3<\/b>/)
  })

  it('compare shows the live totals while a side is now, and a basis adjust opens on v3 → now', () => {
    const basis = actsOf(model, [['st-01', { type: 'adjust', target: 'F8949.B.N1', body: { field: 'basis', to: 19100, reason: 'D11 supplement', evidence: ['D11'] } }]])
    expect(render(h(CompareView), 'a=v3&b=now', basis)).toContain('from live adjustments')
    expect(render(h(CompareView), 'a=v2&b=v3', basis)).not.toContain('from live adjustments')
    const html = render(h(CompareView), '', basis)
    expect(html).toMatch(/differ between <b>v3<\/b> and <b>now<\/b>/)
    expect(html).toContain('(basis)')
  })

  it('compare keeps a label adjust on total tax out of the total-tax summary', () => {
    const label = actsOf(model, [['st-01', { type: 'adjust', target: 'F1040.24', body: { field: 'label', to: 'Total tax after credits', reason: 'Label per the printed form', evidence: ['D11'] } }]])
    const html = render(h(CompareView), 'a=v3&b=now', label).replaceAll('<!-- -->', '')
    expect(html).toContain('Total tax (label)')
    expect(html).not.toContain('Federal total tax')
  })
})
