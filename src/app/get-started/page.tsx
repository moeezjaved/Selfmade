'use client'
/**
 * /get-started — the "next screen" after the landing website form. Keeps the landing to one field, then
 * collects the ads-specific inputs here BEFORE sign-up: the founder's own Facebook Ad Library link (→ their
 * live-ads audit) and one competitor (their Ad Library link or website → spied). Everything is stashed in
 * cookies that ride through sign-up; onboarding reads them (sf_scan_domain / sf_scan_pageid / sf_scan_competitor)
 * and seeds the brand + own-ads page + competitor. Both fields are optional — Skip goes straight to sign-up.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.14)', ORANGE = '#e02f06', PAPER = '#fbf4e2'
const SANS = 'Inter, system-ui, sans-serif'
const SERIF = "'Playfair Display', 'Times New Roman', serif"

function extractPageId(s: string): string {
  const t = (s || '').trim()
  if (/^\d{5,}$/.test(t)) return t
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  return m ? m[1] : ''
}

export default function GetStarted() {
  const router = useRouter()
  const [domain, setDomain] = useState('')
  const [fb, setFb] = useState('')
  const [comp, setComp] = useState('')
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )sf_scan_domain=([^;]+)/)
    if (m) setDomain(decodeURIComponent(m[1]))
  }, [])

  const go = () => {
    try {
      const pid = extractPageId(fb)
      if (pid) document.cookie = `sf_scan_pageid=${pid}; path=/; max-age=2592000; samesite=lax`
      const c = comp.trim()
      if (c) document.cookie = `sf_scan_competitor=${encodeURIComponent(c)}; path=/; max-age=2592000; samesite=lax`
    } catch { /* ignore */ }
    router.push('/signup?ref=site')
  }

  const field = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 100, padding: '14px 20px', fontSize: 15, outline: 'none', fontFamily: SANS, color: INK, background: '#fff', boxSizing: 'border-box' as const }

  return (
    <div style={{ minHeight: '100dvh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: SANS, color: INK }}>
      <div style={{ width: '100%', maxWidth: 540 }}>
        {domain && <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE, marginBottom: 12, textAlign: 'center' }}>Setting up {domain}</div>}
        <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 44, lineHeight: 1.05, letterSpacing: '-0.02em', margin: '0 0 10px', textAlign: 'center' }}>Let&rsquo;s audit your ads</h1>
        <p style={{ color: SUB, fontSize: 15.5, lineHeight: 1.5, margin: '0 0 26px', textAlign: 'center' }}>Two quick things so Mello can pull your live ads and size up a rival. Both optional — you can add them later.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, marginBottom: 7 }}>Your Facebook Ad Library link</label>
            <input value={fb} onChange={(e) => setFb(e.target.value)} placeholder="facebook.com/ads/library/?…view_all_page_id=…" autoComplete="off" spellCheck={false} style={field} />
            <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 7, fontSize: 12.5, color: ORANGE, fontWeight: 700, textDecoration: 'none' }}>Where do I find this? →</a>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, marginBottom: 7 }}>A competitor to watch</label>
            <input value={comp} onChange={(e) => setComp(e.target.value)} placeholder="Competitor’s Ad Library link or website" autoComplete="off" spellCheck={false} style={field} />
            <div style={{ marginTop: 7, fontSize: 12.5, color: SUB }}>We’ll track their live ads next to yours. (An Ad Library link works best.)</div>
          </div>
        </div>

        <button onClick={go} style={{ width: '100%', marginTop: 26, background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '15px 22px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: SANS }}>Continue →</button>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button onClick={() => router.push('/signup?ref=site')} style={{ background: 'none', border: 'none', color: SUB, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: SANS }}>Skip for now →</button>
        </div>
      </div>
    </div>
  )
}
