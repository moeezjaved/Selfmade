/**
 * /audit — the public SEO scan theater (Ryze-style). PREVIEW/BRANCH ONLY: noindex, not linked from
 * production nav. Enter a domain → live scan → gated report → offer. No login.
 */
import type { Metadata } from 'next'
import AuditTheater from '@/components/audit/AuditTheater'

export const metadata: Metadata = {
  title: { absolute: 'Free SEO X-ray — is your store invisible on Google & AI? | Selfmade' },
  description: 'Scan your website in ~30 seconds: search health, catalog, and whether ChatGPT even mentions you. No login.',
  robots: { index: false, follow: false },
}

export default function AuditPage() {
  return <AuditTheater />
}
