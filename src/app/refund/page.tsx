import type { Metadata } from 'next'
import Link from 'next/link'
import LegalShell from '@/components/LegalShell'
import { COMPANY } from '@/lib/company'

export const metadata: Metadata = {
  title: { absolute: 'Refund & Cancellation Policy — Selfmade' },
  description: 'Selfmade’s refund and cancellation policy for subscriptions, credits, and pay-as-you-go generations.',
  alternates: { canonical: '/refund' },
}

export default function Refund() {
  return (
    <LegalShell title="Refund & Cancellation Policy" updated="28 July 2026"
      intro={<>How refunds and cancellations work for {COMPANY.brand} subscriptions, credits, and pay-as-you-go generations.</>}>
      <p>This policy explains how refunds and cancellations work for {COMPANY.brand}, operated by {COMPANY.legalName}. By subscribing or purchasing credits you agree to it, together with our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>

      <h2>1. What you’re buying</h2>
      <p>{COMPANY.brand} is a digital service. Plans (billed monthly) and pay-as-you-go purchases grant credits used to generate ads, videos, reports, and other AI outputs. Because these are delivered instantly and consumed on use, some purchases are non-refundable once used, as set out below.</p>

      <h2>2. Subscriptions</h2>
      <ul>
        <li><b>Cancel anytime.</b> You can cancel your plan from Settings → Billing at any time. Cancellation stops all future charges; your plan stays active until the end of the current billing period.</li>
        <li><b>Current period.</b> We don’t provide partial or pro-rated refunds for the current billing period once it has started, except where required by law (see §5).</li>
        <li><b>Accidental or duplicate charges.</b> If you were billed in error, contact us within 14 days and we’ll investigate and refund verified errors.</li>
      </ul>

      <h2>3. Credits & pay-as-you-go</h2>
      <ul>
        <li><b>Unused credits</b> from a pay-as-you-go purchase can be refunded within 14 days of purchase if none of that purchase has been used.</li>
        <li><b>Used credits</b> are non-refundable — the AI generation they paid for has already been produced and delivered.</li>
        <li><b>Failed generations are always made good.</b> If a generation fails on our side, the credits are automatically returned to your balance — you are never charged for output you didn’t receive.</li>
      </ul>

      <h2>4. How to request a refund</h2>
      <p>Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> from the address on your account with your order/date and the reason. We aim to respond within 2 business days and to process approved refunds within 5–10 business days, back to your original payment method.</p>

      <h2>5. Your statutory rights</h2>
      <p>Nothing in this policy limits any non-waivable rights you have under the consumer-protection laws of your country (for example, EU/UK cooling-off rights for digital purchases, where applicable). Where such rights apply, they take precedence over the terms above.</p>

      <h2>6. Contact</h2>
      <p style={{ marginBottom: 0 }}>
        {COMPANY.legalName}<br />
        {COMPANY.address && <><span style={{ whiteSpace: 'pre-line' }}>{COMPANY.address}</span><br /></>}
        Email: <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a><br />
        Phone: <a href={`tel:${COMPANY.phone.replace(/[^+\d]/g, '')}`}>{COMPANY.phone}</a>
      </p>
    </LegalShell>
  )
}
