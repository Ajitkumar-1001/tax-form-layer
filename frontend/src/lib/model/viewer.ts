// Identities come from the packet (firm.staff + firm.client_users). The role switcher picks one;
// the server re-resolves role, clearance and active date from here on every request.
import type { Packet } from './packet-types'
import type { Role, Viewer } from './state'

export function identities(p: Packet): Viewer[] {
  return [
    ...p.firm.staff.map((s) => ({
      id: s.id, name: s.name, role: s.role as Role, kind: 'staff' as const,
      clearance: s.sensitive_data_clearance, active_from: s.active_from, credential: s.credential,
    })),
    ...p.firm.client_users.map((c) => ({
      id: c.id, name: c.name, role: 'client' as const, kind: 'client' as const,
      clearance: false, active_from: '2026-01-12',
    })),
  ]
}

export function viewerOf(p: Packet, id: string | undefined): Viewer {
  const all = identities(p)
  return all.find((v) => v.id === id) ?? all.find((v) => v.id === p.firm.assignment_at_start.preparer)!
}
