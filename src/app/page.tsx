/**
 * Homepage at the root `/`. The landing is a client component (HomeLanding), so this thin SERVER
 * wrapper supplies the real head — keyword title, self-canonical `/`, Open Graph + Twitter (image
 * auto-wired from ./opengraph-image), and Organization + WebSite + SoftwareApplication JSON-LD.
 * (The previous root landing was moved to src/legacy/old-root-landing.tsx.bak — kept, not deleted.)
 */
import type { Metadata } from 'next'
import HomeLanding from '@/components/HomeLanding'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Selfmade — Find Winning Meta Ads & Launch in Minutes'
const DESC = 'Selfmade turns 3M+ proven Meta ads into your next winner. Spy on what’s working, clone or generate your own with AI, and launch — the whole ad workflow in one place.'
const OG_DESC = 'Spy on 3M+ proven Meta ads, clone or generate your own with AI, and launch in minutes.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', siteName: 'Selfmade', url: SITE, title: TITLE, description: OG_DESC },
  twitter: { card: 'summary_large_image', title: TITLE, description: OG_DESC },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'Selfmade', url: SITE, logo: `${SITE}/logo.png` },
    { '@type': 'WebSite', '@id': `${SITE}/#website`, url: SITE, name: 'Selfmade', publisher: { '@id': `${SITE}/#org` } },
    {
      '@type': 'SoftwareApplication', name: 'Selfmade',
      applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: SITE,
      description: 'AI-powered Meta ads platform to discover winning ads, clone or generate creatives, and launch in minutes.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
}

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeLanding />
    </>
  )
}
