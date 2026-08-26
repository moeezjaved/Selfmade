/**
 * Homepage at the root `/`. The landing is a client component (HireStory — "you hired a marketing
 * company"), so this thin SERVER wrapper supplies the real head — keyword title, self-canonical `/`,
 * Open Graph + Twitter (image auto-wired from ./opengraph-image), and Organization + WebSite +
 * SoftwareApplication JSON-LD. The prior landing (HireKeynote) is kept on disk at ./hire/HireKeynote
 * for rollback, not deleted; /story renders the same HireStory as a noindex preview.
 */
import type { Metadata } from 'next'
import LandingV2 from './LandingV2'
import AmbientAudio from './AmbientAudio'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Selfmade — Ecommerce, version two'
const DESC = 'The growth team your store could never afford — now AI. Ads, SEO, conversion, and website design, on autopilot. Selfmade learns your brand, does the marketing, and brings you the work already done. Nothing ships without your yes.'
const OG_DESC = 'Ecommerce, version two. The growth team your store could never afford — now AI. Ads, SEO, conversion & website design on autopilot. You approve; it ships.'

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
      <LandingV2 />
      <AmbientAudio />
    </>
  )
}
