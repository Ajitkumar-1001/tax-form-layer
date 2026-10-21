import type { Metadata } from 'next'
import dynamic from 'next/dynamic'  
const AppLoader = dynamic(() => import('@/components/app-loader').then(mod => mod.AppLoader))



export const metadata: Metadata = { title: 'Documents · Workpaper' }

export default function Page() {
  return <AppLoader screen="documents" />
}
