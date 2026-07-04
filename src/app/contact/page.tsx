import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Contact Selfmade' },
  description: 'Get in touch with the Selfmade team — support, sales, and partnership enquiries.',
  alternates: { canonical: '/contact' },
}
const LIME = '#dffe95', INK = '#0e1b12', GREEN = '#16a34a'

export default function Contact() {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 24, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '56px 24px 80px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '.06em' }}>Contact</div>
        <h1 style={{ fontSize: 'clamp(28px,5vw,40px)', fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 16px' }}>Get in touch</h1>
        <p style={{ fontSize: 16.5, color: '#374151', lineHeight: 1.7, margin: '0 0 24px' }}>We usually reply within one business day.</p>
        {[['Support', 'Help with your account, credits, or a generation.', 'support@tryselfmade.ai'],
          ['Sales', 'Plans, teams, and Enterprise.', 'sales@tryselfmade.ai'],
          ['Partnerships', 'Integrations, affiliates, and press.', 'hello@tryselfmade.ai']].map(([t, d, e]) => (
          <div key={t} style={{ border: '1px solid #eef0ee', borderRadius: 14, padding: '18px 20px', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{t}</div>
            <div style={{ fontSize: 14, color: '#6b7280', margin: '4px 0 8px' }}>{d}</div>
            <a href={`mailto:${e}`} style={{ color: GREEN, fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>{e}</a>
          </div>
        ))}
      </div>
    </div>
  )
}
