/**
 * Homepage at the root `/`. The landing is a client component (HireStory — "you hired a marketing
 * company"), so this thin SERVER wrapper supplies the real head — keyword title, self-canonical `/`,
 * Open Graph + Twitter (image auto-wired from ./opengraph-image), and Organization + WebSite +
 * SoftwareApplication JSON-LD. The prior landing (HireKeynote) is kept on disk at ./hire/HireKeynote
 * for rollback, not deleted; /story renders the same HireStory as a noindex preview.
 */
import type { Metadata } from 'next'
import HireStory from './hire/HireStory'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Selfmade — The One-Person Company'
const DESC = 'You just hired a marketing company. No employees, no agency, no freelancers. Research, Creative, Media Buying and Customer care — a whole team run by Mello. They study your market every night across 3M+ ads and 611K brands and bring you the work every morning, already done. Nothing ships without your yes.'
const OG_DESC = 'Hire a marketing company, not software. Your team works every night and brings you the work every morning — already done. You approve; it ships.'

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
      <HireStory />
    </>
  )
}
