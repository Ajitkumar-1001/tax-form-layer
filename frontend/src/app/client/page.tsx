import type { Metadata } from 'next'
import { ClientPortal } from '@/components/client/client-portal'

export const metadata: Metadata = { title: 'Client portal · Workpaper' }

export default function Page() {
  return <ClientPortal />
}
