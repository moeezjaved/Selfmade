'use client'
/**
 * HireAgreement — the paywall, reframed as an EMPLOYMENT AGREEMENT for your AI marketing team (the
 * "hire an AI company" north star, not a cold "choose a plan"). Roles being hired, reports-to-you,
 * compensation vs the human equivalent, first-win guarantee, and "Sign & hire" → the existing PayPal
 * checkout. Prices are the current plans (Creator $49 / Agency $149) — provisional, to be tuned with
 * real users. Shown at the first paid action in the workspace, or standalone at /hire.
 */
import { useState, useEffect } from 'react'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', ORANGE = '#e02f06', PAPER = '#fbf7ef', CREAM = '#fff'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

type PlanId = 'starter' | 'business'
const PLANS: { id: PlanId; role: string; price: number; brands: string; blurb: string; recommended?: boolean }[] = [
  { id: 'starter', role: 'Full-time', price: 49, brands: '1 brand', blurb: 'The whole team, working every day on one store.', recommended: true },
  { id: 'business', role: 'Agency', price: 149, brands: 'up to 10 brands', blurb: 'Pooled across clients, with seats and white-label reports.' },
]

const ROLES = [
  { title: 'SEO Lead', duty: 'Finds & fixes every search gap, writes and publishes content.', status: 'live' },
  { title: 'Ads Creative Director — Mello', duty: 'Spies competitors, learns your brand, generates & launches on-brand ads.', status: 'live' },
  { title: 'Web Designer', duty: 'Builds and optimizes your Shopify pages.', status: 'soon' },
  { title: 'Outreach Rep', duty: 'Finds and messages prospects, books the meetings.', status: 'soon' },
]

export default function HireAgreement() {
  const [plan, setPlan] = useState<PlanId>('starter')
  const [busy, setBusy] = useState(false)
  const [signer, setSigner] = useState('')
  useEffect(() => {
    const s = document.cookie.match(/sf_scan_signer=([^;]+)/)?.[1]
    if (s) setSigner(decodeURIComponent(s))
  }, [])

  const hire = async () => {
    setBusy(true)
    try {
      const { startPaypalCheckout } = await import('@/lib/paypal/start')
      const res = await startPaypalCheckout({ kind: 'subscription', plan, cycle: 'monthly' })
      if ((res as any)?.error) { alert((res as any).message || 'Could not start checkout.'); setBusy(false) }
      // otherwise redirecting to PayPal
    } catch { setBusy(false) }
  }

  const chosen = PLANS.find((p) => p.id === plan)!
  const HUMAN = 12400

  return (
    <div style={{ minHeight: '100dvh', background: PAPER, fontFamily: SANS, color: INK, padding: '48px 22px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE, marginBottom: 12 }}>Employment Agreement</div>
          <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(30px,5vw,46px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.08, margin: 0, textWrap: 'balance' }}>Hire your AI marketing team</h1>
          <p style={{ color: SUB, fontSize: 16, lineHeight: 1.55, maxWidth: 520, margin: '14px auto 0' }}>You’ve seen them work for free. Sign below and the whole team starts today — reporting to you, on your approval.</p>
        </div>

        {/* the "contract" */}
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 20, padding: 'clamp(22px,4vw,36px)', boxShadow: '0 30px 70px -44px rgba(0,0,0,.4)' }}>
          <div style={{ fontSize: 14.5, color: '#43403a', lineHeight: 1.6, marginBottom: 22 }}>
            This agreement is between <b style={{ color: INK }}>you</b> (the Employer{signer ? `, ${signer}` : ''}) and <b style={{ color: INK }}>your AI marketing team</b> (the Employees), effective <b style={{ color: INK }}>today</b>.
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: SUB, marginBottom: 12 }}>The team you’re hiring</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 26 }}>
            {ROLES.map((r) => (
              <div key={r.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', opacity: r.status === 'soon' ? 0.62 : 1 }}>
                <span style={{ width: 22, height: 22, borderRadius: 100, background: r.status === 'live' ? '#e8f6ee' : PAPER, color: r.status === 'live' ? '#1f8f4e' : SUB, border: r.status === 'soon' ? `1px solid ${LINE}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, flex: 'none', marginTop: 1 }}>{r.status === 'live' ? '✓' : '·'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{r.title} {r.status === 'soon' && <span style={{ fontSize: 10.5, fontWeight: 800, color: ORANGE, background: '#ffe7df', borderRadius: 100, padding: '2px 8px', marginLeft: 4 }}>STARTING SOON</span>}</div>
                  <div style={{ fontSize: 13.5, color: SUB, marginTop: 1 }}>{r.duty}</div>
                </div>
              </div>
            ))}
          </div>

          {/* terms */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 26 }}>
            {[
              ['Reports to', 'You — every spend & publish needs your sign-off.'],
              ['Start date', 'Today, the moment you sign.'],
              ['Guarantee', 'Your first win in 30 days — or they keep working free.'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: PAPER, borderRadius: 12, padding: '13px 15px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB }}>{k}</div>
                <div style={{ fontSize: 13.5, color: INK, marginTop: 3, lineHeight: 1.4 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* compensation / plan pick */}
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: SUB, marginBottom: 12 }}>Compensation</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
            {PLANS.map((p) => {
              const on = plan === p.id
              return (
                <button key={p.id} onClick={() => setPlan(p.id)} style={{ textAlign: 'left', border: `1.5px solid ${on ? ORANGE : LINE}`, borderRadius: 14, background: on ? '#fff7f4' : CREAM, padding: 16, cursor: 'pointer', fontFamily: SANS, position: 'relative' }}>
                  {p.recommended && <span style={{ position: 'absolute', top: -10, right: 14, fontSize: 10.5, fontWeight: 800, color: '#fff', background: ORANGE, borderRadius: 100, padding: '3px 10px' }}>RECOMMENDED</span>}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 800 }}>${p.price}</span><span style={{ fontSize: 13, color: SUB }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginTop: 4 }}>{p.role} · {p.brands}</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 3, lineHeight: 1.4 }}>{p.blurb}</div>
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 22 }}>A human team doing this costs about <b style={{ color: INK }}>${HUMAN.toLocaleString()}/mo</b>. You pay <b style={{ color: INK }}>${chosen.price}</b>.</div>

          {/* sign */}
          <button onClick={hire} disabled={busy} style={{ width: '100%', background: busy ? '#e7a897' : ORANGE, color: '#fff', border: 'none', borderRadius: 14, padding: '16px 22px', fontSize: 16.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: SANS }}>
            {busy ? 'Opening secure checkout…' : `Sign & hire the team — $${chosen.price}/mo`}
          </button>
          <div style={{ textAlign: 'center', fontSize: 12.5, color: SUB, marginTop: 12 }}>Cancel anytime · Secure checkout · You approve every spend</div>
        </div>
      </div>
    </div>
  )
}
