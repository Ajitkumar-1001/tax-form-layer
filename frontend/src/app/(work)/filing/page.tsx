import type { Metadata } from 'next'
import { AppLoader } from '@/components/app-loader'

export const metadata: Metadata = { title: 'Filing · Workpaper' }

export default function Page() {
  return <AppLoader screen="filing" />
}
