'use client'
// Background effects are client-only and load after the page: `ssr: false` from a Client Component (Next rejects it in a
// Server Component), no placeholder because nothing here is content. All three share one chunk (./about-fx).
// next/dynamic reads its options at build time, so each call spells them out as an object literal.
import dynamic from 'next/dynamic'

export const HeroBackdrop = dynamic(() => import('./about-fx').then((m) => m.HeroBackdrop), { ssr: false })
export const ChainBeam = dynamic(() => import('./about-fx').then((m) => m.ChainBeam), { ssr: false })
export const ModelBackdrop = dynamic(() => import('./about-fx').then((m) => m.ModelBackdrop), { ssr: false })
