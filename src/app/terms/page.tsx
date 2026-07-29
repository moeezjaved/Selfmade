import type { Metadata } from 'next'
import Link from 'next/link'
import LegalShell from '@/components/LegalShell'
import { COMPANY } from '@/lib/company'

export const metadata: Metadata = {
  title: { absolute: 'Terms of Service — Selfmade' },
  description: 'The terms that govern your use of Selfmade.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="July 2026"
      intro="The terms that govern your use of Selfmade. By creating an account, you agree to them.">
      <p>These Terms govern your use of {COMPANY.brand} (tryselfmade.ai), operated by {COMPANY.legalName}. By creating an account or using the service, you agree to them.</p>

      <h2>1. The service</h2>
      <p>{COMPANY.brand} is an AI-powered ad-intelligence and creative platform: discover competitor ads, remake them with your own product, generate scripts and creatives, track brands, and (where connected) analyze and manage Meta campaigns.</p>

      <h2>2. Accounts & eligibility</h2>
      <p>You must provide accurate information, keep your credentials secure, and be responsible for activity under your account. You must be at least 18. We may suspend accounts that violate these Terms or applicable law.</p>

      <h2>3. Acceptable use</h2>
      <p>Don’t misuse the service — no scraping our systems, reverse-engineering, reselling access, infringing others’ IP, or generating unlawful, deceptive, or infringing ad content. You’re responsible for the creatives and campaigns you produce and run.</p>

      <h2>4. Meta / third-party platforms</h2>
      <p>Where you connect Meta or other platforms, you must comply with their terms and advertising policies. We integrate via their official APIs and are not responsible for their decisions, outages, or your campaign performance.</p>

      <h2>5. Credits, billing & subscriptions</h2>
      <p>Paid plans and AI credits are billed per your selected plan. Subscription fees are separate from any ad spend, which is billed directly to you by Meta. Cancellations and refunds are handled under our <Link href="/refund">Refund &amp; Cancellation Policy</Link>.</p>

      <h2>6. Intellectual property</h2>
      <p>You retain rights to the content and creatives you upload and generate. You grant us a limited license to process them to provide the service. The {COMPANY.brand} platform, brand, and software remain ours.</p>

      <h2>7. Disclaimers & limitation of liability</h2>
      <p>The service is provided “as is.” We don’t guarantee ad results or business outcomes. To the maximum extent permitted by law, {COMPANY.brand} is not liable for ad spend, lost profits, or indirect damages arising from your use of the service.</p>

      <h2>8. Changes & termination</h2>
      <p>We may update these Terms or the service; continued use means acceptance. You may stop using the service and delete your account at any time.</p>

      <h2>9. Contact</h2>
      <p style={{ marginBottom: 0 }}>Questions? Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.</p>
    </LegalShell>
  )
}
