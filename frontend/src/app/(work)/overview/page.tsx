import type { Metadata } from 'next'
import { AppLoader } from '@/components/app-loader'

export const metadata: Metadata = { title: 'Overview · Workpaper' }

export default function Page() {
  return <AppLoader screen="overview" />
}
