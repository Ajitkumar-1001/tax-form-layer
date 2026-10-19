// "Back to staff view" in the client portal: a client is signed in as staff before going to /overview (else ClientGate
// bounces them straight back); staff previewing the portal, and modified clicks, keep plain link navigation.
import { describe, expect, it, vi } from 'vitest'
import { backToStaff } from '@/components/client/portal-bar'
import { staffReturn } from '@/components/workspace/client-gate'
import { identities } from '@/lib/model/viewer'
import { readPacket } from '../records/fixture'

const click = (over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...over,
})

describe('backToStaff', () => {
  it('signs a client in as staff, then goes to /overview', async () => {
    const order: string[] = []
    const e = click()
    await backToStaff('st-01', async (id) => void order.push(`switch:${id}`), (href) => void order.push(`push:${href}`))(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(order).toEqual(['switch:st-01', 'push:/overview'])
  })

  it('leaves staff and modified clicks to the link', async () => {
    const sw = vi.fn(async () => {})
    const push = vi.fn()
    for (const [id, e] of [[null, click()], ['st-01', click({ metaKey: true })], ['st-01', click({ ctrlKey: true })], ['st-01', click({ button: 1 })]] as const) {
      await backToStaff(id, sw, push)(e)
      expect(e.preventDefault).not.toHaveBeenCalled()
    }
    expect(sw).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('returns a client on the real packet to Priya Raman', () => {
    const ids = identities(readPacket())
    const client = ids.find((v) => v.kind === 'client')!
    const id = staffReturn(client, ids, '2026-06-23')
    expect(ids.find((v) => v.id === id)?.name).toBe('Priya Raman')
  })
})
