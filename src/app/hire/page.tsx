/**
 * /hire — the employment-agreement paywall for the ads workspace ("hire your AI marketing team").
 * Separate-from-prod while building: noindex, not linked from production nav.
 */
import type { Metadata } from 'next'
import HireAgreement from '@/components/ads/HireAgreement'

export const metadata: Metadata = {
  title: { absolute: 'Hire your AI marketing team | Selfmade' },
  description: 'Your AI marketing team’s employment agreement — SEO, ads, and more, reporting to you.',
  robots: { index: false, follow: false },
}

export default function HirePage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Mono:wght@400;700&display=swap" />
      <HireAgreement />
    </>
  )
}
