'use client'
/**
 * AdsAuditLanding — the "Audit your ads" front door (the ADS counterpart to the SEO /audit theater).
 * Enter a domain → we stash it (sf_scan_domain, same cookie the app claims on login) and hand off into
 * the ads workspace (/ads-studio) with the store already attached, so users never see "No store
 * connected". Separate-from-prod while building (noindex, not linked from nav).
 */
import { useState } from 'react'

const INK = '#1a1410', ORANGE = '#e02f06', CREAM = '#fff7f4'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

export default function AdsAuditLanding() {
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)

  const go = () => {
    const d = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
    if (!d || !d.includes('.')) return
    setBusy(true)
    document.cookie = `sf_scan_domain=${encodeURIComponent(d)}; path=/; max-age=2592000`
    window.location.href = `/ads-studio?domain=${encodeURIComponent(d)}`
  }

  return (
    <div style={{ minHeight: '100dvh', background: ORANGE, color: '#fff', fontFamily: SANS, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 22px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 720, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid rgba(255,255,255,.4)', borderRadius: 100, padding: '6px 14px', fontSize: 12.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 26 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: '#fff', color: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 800, fontSize: 15 }}>S</span>
          Your AI ads team
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(36px, 6vw, 60px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.02em', margin: '0 0 18px', textWrap: 'balance' }}>Audit your ads.<br />Then let AI run them.</h1>
        <p style={{ fontSize: 'clamp(16px, 2.4vw, 19px)', lineHeight: 1.55, color: 'rgba(255,255,255,.94)', maxWidth: 560, margin: '0 auto 32px' }}>
          From just your website, we map your real competitors and their live ads, learn your brand, and generate on-brand ads in seconds — no Shopify, no setup.
        </p>
        <div style={{ display: 'flex', gap: 10, background: '#fff', borderRadius: 16, padding: 8, maxWidth: 520, margin: '0 auto', boxShadow: '0 26px 60px -30px rgba(0,0,0,.55)', flexWrap: 'wrap' }}>
          <input
            value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="yourstore.com" autoFocus
            style={{ flex: 1, minWidth: 180, border: 'none', outline: 'none', fontSize: 16.5, color: INK, background: 'transparent', padding: '12px 14px', fontFamily: SANS }}
          />
          <button onClick={go} disabled={busy || !domain.trim()} style={{ background: busy || !domain.trim() ? '#f0b6a8' : ORANGE, color: '#fff', border: 'none', borderRadius: 11, padding: '13px 22px', fontSize: 15.5, fontWeight: 800, cursor: busy || !domain.trim() ? 'default' : 'pointer', fontFamily: SANS, whiteSpace: 'nowrap' }}>
            {busy ? 'Opening…' : 'Audit my ads →'}
          </button>
        </div>
        <div style={{ marginTop: 20, fontSize: 13.5, color: 'rgba(255,255,255,.82)' }}>Free to start · No credit card · Works from your website alone</div>

        <div style={{ display: 'flex', gap: 22, justifyContent: 'center', flexWrap: 'wrap', marginTop: 40 }}>
          {[['Your competitors', 'their live ads, decoded'], ['Your brand kit', 'learned from your site'], ['On-brand ads', 'generated in seconds']].map(([a, b]) => (
            <div key={a} style={{ background: CREAM, color: INK, borderRadius: 14, padding: '14px 18px', minWidth: 180, textAlign: 'left' }}>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>{a}</div>
              <div style={{ fontSize: 13, color: '#6f665a', marginTop: 2 }}>{b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
