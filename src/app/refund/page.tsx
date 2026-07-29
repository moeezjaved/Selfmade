import Link from 'next/link'
import type { Metadata } from 'next'
import { COMPANY } from '@/lib/company'

export const metadata: Metadata = {
  title: { absolute: 'Refund & Cancellation Policy — Selfmade' },
  description: 'Selfmade’s refund and cancellation policy for subscriptions, credits, and pay-as-you-go generations.',
  alternates: { canonical: '/refund' },
}
const LIME = '#dffe95', INK = '#0e1b12', GREEN = '#16a34a'

export default function Refund() {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 24, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '56px 24px 90px', fontSize: 15.5, lineHeight: 1.75, color: '#374151' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '.06em' }}>Legal</div>
        <h1 style={{ fontSize: 'clamp(28px,5vw,40px)', fontWeight: 800, letterSpacing: '-.02em', color: INK, margin: '10px 0 6px' }}>Refund & Cancellation Policy</h1>
        <p style={{ fontSize: 13.5, color: '#9ca3af', margin: '0 0 28px' }}>Last updated 28 July 2026</p>

        <p>This policy explains how refunds and cancellations work for {COMPANY.brand}, operated by {COMPANY.legalName}. By subscribing or purchasing credits you agree to it, together with our <Link href="/terms" style={{ color: GREEN, fontWeight: 600, textDecoration: 'none' }}>Terms</Link> and <Link href="/privacy" style={{ color: GREEN, fontWeight: 600, textDecoration: 'none' }}>Privacy Policy</Link>.</p>

        <H>1. What you’re buying</H>
        <p>{COMPANY.brand} is a digital service. Plans (billed monthly) and pay-as-you-go purchases grant credits used to generate ads, videos, reports, and other AI outputs. Because these are delivered instantly and consumed on use, some purchases are non-refundable once used, as set out below.</p>

        <H>2. Subscriptions</H>
        <ul style={ul}>
          <li><B>Cancel anytime.</B> You can cancel your plan from Settings → Billing at any time. Cancellation stops all future charges; your plan stays active until the end of the current billing period.</li>
          <li><B>Current period.</B> We don’t provide partial or pro-rated refunds for the current billing period once it has started, except where required by law (see §5).</li>
          <li><B>Accidental or duplicate charges.</B> If you were billed in error, contact us within 14 days and we’ll investigate and refund verified errors.</li>
        </ul>

        <H>3. Credits & pay-as-you-go</H>
        <ul style={ul}>
          <li><B>Unused credits</B> from a pay-as-you-go purchase can be refunded within 14 days of purchase if none of that purchase has been used.</li>
          <li><B>Used credits</B> are non-refundable — the AI generation they paid for has already been produced and delivered.</li>
          <li><B>Failed generations are always made good.</B> If a generation fails on our side, the credits are automatically returned to your balance — you are never charged for output you didn’t receive.</li>
        </ul>

        <H>4. How to request a refund</H>
        <p>Email <a href={`mailto:${COMPANY.supportEmail}`} style={{ color: GREEN, fontWeight: 600, textDecoration: 'none' }}>{COMPANY.supportEmail}</a> from the address on your account with your order/date and the reason. We aim to respond within 2 business days and to process approved refunds within 5–10 business days, back to your original payment method.</p>

        <H>5. Your statutory rights</H>
        <p>Nothing in this policy limits any non-waivable rights you have under the consumer-protection laws of your country (for example, EU/UK cooling-off rights for digital purchases, where applicable). Where such rights apply, they take precedence over the terms above.</p>

        <H>6. Contact</H>
        <p style={{ marginBottom: 0 }}>
          {COMPANY.legalName}<br />
          {COMPANY.address && <><span style={{ whiteSpace: 'pre-line' }}>{COMPANY.address}</span><br /></>}
          Email: <a href={`mailto:${COMPANY.supportEmail}`} style={{ color: GREEN, fontWeight: 600, textDecoration: 'none' }}>{COMPANY.supportEmail}</a><br />
          Phone: <a href={`tel:${COMPANY.phone.replace(/[^+\d]/g, '')}`} style={{ color: GREEN, fontWeight: 600, textDecoration: 'none' }}>{COMPANY.phone}</a>
        </p>
      </div>
    </div>
  )
}

const ul: React.CSSProperties = { margin: '0 0 8px', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }
function H({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 19, fontWeight: 800, color: INK, letterSpacing: '-.01em', margin: '30px 0 10px' }}>{children}</h2>
}
function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: INK, fontWeight: 700 }}>{children}</strong>
}
