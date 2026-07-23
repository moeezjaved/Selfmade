/**
 * /home — the previous "Meet Mello" conversion landing (hero grid, comparison, how-it-works,
 * pricing, showcase, FAQ, SEO footer). Preserved and reachable after the root `/` became the
 * keynote/offer-letter experience — pricing + SEO content still live here, linked from the keynote.
 */
import type { Metadata } from 'next'
import HomeLanding from '@/components/HomeLanding'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export const metadata: Metadata = {
  title: { absolute: 'Selfmade — how Mello works, and what it costs' },
  description: 'Meet Mello, your AI marketer: what it does every day, how it works, and pricing. Studies 3M+ winning ads across 611K brands, refreshed daily.',
  alternates: { canonical: '/home' },
  openGraph: { type: 'website', siteName: 'Selfmade', url: `${SITE}/home`, title: 'Selfmade — how Mello works', description: 'What Mello does every day, how it works, and what it costs.' },
}

export default function HomePage() {
  return <HomeLanding />
}
