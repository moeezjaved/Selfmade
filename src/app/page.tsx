/**
 * Homepage at the root `/`. The landing is a client component (HomeLanding), so this thin SERVER
 * wrapper supplies the real head — keyword title, self-canonical `/`, Open Graph + Twitter (image
 * auto-wired from ./opengraph-image), and Organization + WebSite + SoftwareApplication JSON-LD.
 * (The previous root landing was moved to src/legacy/old-root-landing.tsx.bak — kept, not deleted.)
 */
import type { Metadata } from 'next'
import HireKeynote from './hire/HireKeynote'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Selfmade — The Marketing Co-founder'
const DESC = 'Meet Mello, the marketing co-founder. It studies your market all night — every competitor ad, every winning angle across 3M+ ads and 611K brands — and walks in every morning with the work already done. Nothing ships without your yes.'
const OG_DESC = 'The Marketing Co-founder. Mello studies your market all night and brings you the work every morning — already done. You approve; it ships.'

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
      <HireKeynote />
    </>
  )
}
