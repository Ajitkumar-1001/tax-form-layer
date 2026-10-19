// A client identity on a staff route is sent to the portal (UX only: the server's authorize() still refuses
// every staff act a client posts). One rule for both places that apply it: switching identity (provider.tsx)
// and opening a staff route directly (app-shell.tsx).
import { describe, expect, it } from 'vitest'
import { staffRedirect } from '@/components/workspace/client-gate'

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
