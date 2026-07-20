/**
 * Homepage at the root `/`. The landing is a client component (HomeLanding), so this thin SERVER
 * wrapper supplies the real head — keyword title, self-canonical `/`, Open Graph + Twitter (image
 * auto-wired from ./opengraph-image), and Organization + WebSite + SoftwareApplication JSON-LD.
 * (The previous root landing was moved to src/legacy/old-root-landing.tsx.bak — kept, not deleted.)
 */
import type { Metadata } from 'next'
import HomeLanding from '@/components/HomeLanding'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Selfmade — Clone Winning Meta Ads With Your Product'
const DESC = 'Selfmade finds the Meta ads already winning in your niche and remakes them with your product — in minutes, for $0.15 an ad instead of a $1,500 shoot. Spy on 3M+ proven ads, clone the winners, launch. No spend tax, ever.'
const OG_DESC = 'Clone any winning Meta ad with your product — $0.15. Spy on 3M+ proven ads, remake the winners, launch in minutes.'

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
      description: 'AI-powered Meta ads platform to discover winning ads, remake or generate creatives, and launch in minutes.',
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
