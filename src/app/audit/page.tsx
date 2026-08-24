/**
 * /audit — the public SEO scan theater (Ryze-style, ads-audit look: orange + hero film + Fraunces).
 * PREVIEW/BRANCH ONLY: noindex, not linked from production nav. Enter a domain → live scan → gated report
 * → offer → signup (ref=seo-scan) → paywall → /mission/seo. No login to scan.
 */
import type { Metadata } from 'next'
import AuditTheater from '@/components/audit/AuditTheater'

export const metadata: Metadata = {
  title: { absolute: 'Audit your SEO — is your store invisible on Google & AI? | Selfmade' },
  description: 'Scan your website in ~30 seconds: search health, catalog, and whether ChatGPT even mentions you. No login.',
  robots: { index: false, follow: false },
}

export default function AuditPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&display=swap" />
      <AuditTheater />
    </>
  )
}
