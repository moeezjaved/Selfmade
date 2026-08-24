/**
 * /ads-audit — the "Audit your ads" front door (ads counterpart to /audit). Enter a domain → hand off
 * into the ads workspace (/ads-studio) with the store attached. Separate-from-prod: noindex, not linked
 * from nav while building.
 */
import type { Metadata } from 'next'
import AdsAuditLanding from '@/components/ads/AdsAuditLanding'

export const metadata: Metadata = {
  title: { absolute: 'Audit your ads — your AI ads team | Selfmade' },
  description: 'Map your competitors’ live ads, learn your brand from your website, and generate on-brand ads in seconds. No Shopify, no setup.',
  robots: { index: false, follow: false },
}

export default function AdsAuditPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700&display=swap" />
      <AdsAuditLanding />
    </>
  )
}
