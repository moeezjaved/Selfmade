import type { Metadata } from 'next'
import LegalShell from '@/components/LegalShell'
import { COMPANY } from '@/lib/company'

export const metadata: Metadata = {
  title: { absolute: 'Contact Selfmade' },
  description: 'Get in touch with the Selfmade team — support, sales, and partnership enquiries.',
  alternates: { canonical: '/contact' },
}
const INK = '#0e1b12', GREEN = '#16a34a'

export default function Contact() {
  const channels: [string, string, string][] = [
    ['Support', 'Help with your account, credits, or a generation.', COMPANY.supportEmail],
    ['Sales', 'Plans, teams, and Enterprise.', 'sales@tryselfmade.ai'],
    ['Partnerships', 'Integrations, affiliates, and press.', 'hello@tryselfmade.ai'],
  ]
  return (
    <LegalShell eyebrow="Contact" title="Get in touch" intro="We usually reply within one business day.">
      <div style={{ display: 'grid', gap: 12 }}>
        {channels.map(([t, d, e]) => (
          <a key={t} href={`mailto:${e}`} style={{ display: 'block', border: '1px solid #eef0ee', borderRadius: 16, padding: '18px 20px', textDecoration: 'none', background: '#fff', boxShadow: '0 1px 2px rgba(14,27,18,.04), 0 14px 40px -26px rgba(14,27,18,.18)', transition: 'transform .15s, box-shadow .15s' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{t}</div>
            <div style={{ fontSize: 14, color: '#6b7280', margin: '4px 0 8px' }}>{d}</div>
            <span style={{ color: GREEN, fontWeight: 700, fontSize: 15 }}>{e} →</span>
          </a>
        ))}
      </div>

      {/* ── Business details — required by payment providers ── */}
      <div style={{ border: '1px solid #eef0ee', borderRadius: 16, padding: '22px 24px', marginTop: 20, background: 'linear-gradient(180deg,#fafcf7,#ffffff)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: GREEN, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 14 }}>Business details</div>
        <dl style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: '#374151' }}>
          <dt style={{ fontWeight: 800, color: INK }}>Registered business</dt>
          <dd style={{ margin: '2px 0 14px' }}>{COMPANY.legalName}</dd>
          {COMPANY.address && (<>
            <dt style={{ fontWeight: 800, color: INK }}>Address</dt>
            <dd style={{ margin: '2px 0 14px', whiteSpace: 'pre-line' }}>{COMPANY.address}</dd>
          </>)}
          <dt style={{ fontWeight: 800, color: INK }}>Customer support</dt>
          <dd style={{ margin: '2px 0 4px' }}><a href={`mailto:${COMPANY.supportEmail}`} style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>{COMPANY.supportEmail}</a></dd>
          <dd style={{ margin: 0 }}>Phone: <a href={`tel:${COMPANY.phone.replace(/[^+\d]/g, '')}`} style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>{COMPANY.phone}</a></dd>
        </dl>
      </div>
    </LegalShell>
  )
}
