// A client identity on a staff route is sent to the portal (UX only: the server's authorize() still refuses
// every staff act a client posts). One rule for both places that apply it: switching identity (provider.tsx)
// and opening a staff route directly (app-shell.tsx).
import { describe, expect, it } from 'vitest'
import { staffRedirect, staffReturn } from '@/components/workspace/client-gate'

const client = { kind: 'client' as const }
const staff = { kind: 'staff' as const }

describe('staffRedirect', () => {
  it('sends a client on a staff route to the portal', () => {
    expect(staffRedirect(client, '/overview')).toBe('/client')
    expect(staffRedirect(client, '/r/F1040.26')).toBe('/client')
  })

  it('leaves a client on the portal where they are', () => {
    expect(staffRedirect(client, '/client')).toBeNull()
  })

  it('never moves staff', () => {
    expect(staffRedirect(staff, '/overview')).toBeNull()
    expect(staffRedirect(staff, '/client')).toBeNull()
  })
})

describe('staffReturn', () => {
  const ids = [
    { id: 'st-09', kind: 'staff' as const, active_from: '2027-01-01' },
    { id: 'st-01', kind: 'staff' as const, active_from: '2025-08-01' },
    { id: 'cl-01', kind: 'client' as const, active_from: '2020-01-01' },
  ]

  it('signs a client back in as the first staff identity active on the season clock', () => {
    expect(staffReturn({ id: 'cl-01', kind: 'client' }, ids, '2026-02-01')).toBe('st-01')
  })

  it('keeps a staff viewer previewing the portal as who they are', () => {
    expect(staffReturn({ id: 'st-01', kind: 'staff' }, ids, '2026-02-01')).toBeNull()
  })
})
