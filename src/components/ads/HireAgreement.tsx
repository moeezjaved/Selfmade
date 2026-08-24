'use client'
/**
 * HireAgreement — the paywall, matching the EXISTING landing "Employment Agreement" (the signable paper
 * document: "You're not buying software. You're hiring a company."). Same design + copy as LandingV2's
 * `.hire` section, but wired to the real PayPal checkout for a logged-in user hitting the paywall.
 * Price is the current Creator plan ($49/mo, internal id 'starter') — provisional, tuned with real users.
 */
import { useState, useEffect } from 'react'

const ORANGE = '#ef4a1e', WHITE = '#f8f3e7', INK = '#22281b', INK_SOFT = '#585d47', FOG = '#8b8a72', HAIR = '#dcd2ba', RUST = '#c1663a', FOREST = '#141d15'
const SERIF = "'Instrument Serif', 'Iowan Old Style', Georgia, serif"
const MONO = "'Space Mono', ui-monospace, Menlo, monospace"
const SANS = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"

const ROWS: [string, string][] = [
  ['Employee', 'Mello'],
  ['Position', 'Your AI marketing company'],
  ['Working hours', '24/7 — nights included'],
  ['Reports to', 'You'],
  ['Vacation', 'Never'],
  ['Notice period', 'None — end it any time'],
  ['Salary', '$49 / month'],
  ['Starts', 'Tonight'],
]

export default function HireAgreement() {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => {
    const s = document.cookie.match(/sf_scan_signer=([^;]+)/)?.[1]
    if (s) setName(decodeURIComponent(s))
  }, [])

  const hire = async () => {
    setBusy(true)
    if (name.trim()) document.cookie = `sf_scan_signer=${encodeURIComponent(name.trim())}; path=/; max-age=2592000`
    try {
      const { startPaypalCheckout } = await import('@/lib/paypal/start')
      const res = await startPaypalCheckout({ kind: 'subscription', plan: 'starter', cycle: 'monthly' })
      if ((res as any)?.error) { alert((res as any).message || 'Could not start checkout.'); setBusy(false) }
      // otherwise redirecting to secure checkout
    } catch { setBusy(false) }
  }

  const rowText = 14.5, whoText = 9.5

  return (
    <div style={{ minHeight: '100dvh', background: ORANGE, color: '#fff', fontFamily: SANS, padding: 'clamp(34px,4.5vw,54px) 26px clamp(60px,8vw,96px)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 'clamp(30px,5.4vw,58px)', letterSpacing: '-.035em', maxWidth: '20ch', margin: '0 auto clamp(30px,4.5vw,48px)', lineHeight: 1.04, textWrap: 'balance' }}>
          You’re not buying software.<br /><span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400 }}>You’re hiring a company.</span>
        </div>

        <div style={{ maxWidth: 600, margin: '0 auto', background: WHITE, color: INK, border: '1px solid rgba(20,29,21,.25)', padding: 'clamp(26px,4vw,36px) clamp(22px,4vw,38px)', textAlign: 'left', boxShadow: '16px 18px 0 rgba(20,29,21,.22)' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: RUST, fontWeight: 700 }}>Employment agreement · for your signature</div>
          <div style={{ fontFamily: SERIF, fontSize: 40, letterSpacing: '-.01em', margin: '6px 0 3px', color: INK, lineHeight: 1.05 }}>Employment Agreement</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: FOG, marginBottom: 18 }}>Prepared this morning</div>

          {ROWS.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '11px 0', borderBottom: `1px solid ${HAIR}`, fontSize: rowText }}>
              <span style={{ color: INK_SOFT }}>{k}</span><b style={{ color: INK, fontWeight: 700, textAlign: 'right' }}>{v}</b>
            </div>
          ))}

          <div style={{ fontSize: 13.5, color: INK_SOFT, lineHeight: 1.6, margin: '18px 0 4px' }}>
            I will study your market every night and report every morning. Nothing ships without your approval. Let me go at any time, effective immediately, no questions asked. <b style={{ color: INK }}>— I only ask for the nights.</b>
          </div>

          <div style={{ display: 'flex', gap: 28, margin: '24px 0 6px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ borderBottom: `1.5px solid ${INK}`, paddingBottom: 6, fontFamily: SERIF, fontSize: 26, minHeight: 36 }}>Mello</div>
              <div style={{ fontFamily: MONO, fontSize: whoText, letterSpacing: '.06em', textTransform: 'uppercase', color: FOG, marginTop: 7 }}>Mello · Your marketing manager</div>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ borderBottom: `1.5px solid ${INK}`, paddingBottom: 6, minHeight: 36 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hire()} placeholder="Type your name to sign" style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: SERIF, fontSize: 22, width: '100%', color: INK }} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: whoText, letterSpacing: '.06em', textTransform: 'uppercase', color: FOG, marginTop: 7 }}>You · Employer</div>
            </div>
          </div>

          <button onClick={hire} disabled={busy} style={{ display: 'block', width: '100%', marginTop: 22, background: busy ? '#2b3a2c' : FOREST, color: '#fff', border: 'none', borderRadius: 2, padding: '15px 24px', fontWeight: 700, fontSize: 15.5, cursor: busy ? 'default' : 'pointer', fontFamily: SANS }}>
            {busy ? 'Opening secure checkout…' : 'Hire your company →'}
          </button>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.04em', color: FOG, marginTop: 12, textAlign: 'center' }}>$49 / month · cancel any time · you approve every spend</div>
        </div>
      </div>
    </div>
  )
}
