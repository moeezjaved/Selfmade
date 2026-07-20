/**
 * Homepage at the root `/`. The landing is a client component (HomeLanding), so this thin SERVER
 * wrapper supplies the real head — keyword title, self-canonical `/`, Open Graph + Twitter (image
 * auto-wired from ./opengraph-image), and Organization + WebSite + SoftwareApplication JSON-LD.
 * (The previous root landing was moved to src/legacy/old-root-landing.tsx.bak — kept, not deleted.)
 */
import type { Metadata } from 'next'
import HomeLanding from '@/components/HomeLanding'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Selfmade — Know What’s Winning on Meta. Make It Yours.'
const DESC = 'Selfmade is the winning-ads intelligence platform: it decodes 3M+ winning Meta ads across 611K brands, refreshed daily — then turns any of them into your ad in minutes. Market-wide creative intelligence, with a make button. No spend tax, ever.'
const OG_DESC = 'Know what’s winning on Meta. Make it yours. 3M+ winning ads decoded across 611K brands — one click from your next ad.'

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
