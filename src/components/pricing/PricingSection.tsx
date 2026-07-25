'use client'
/**
 * Pricing UI (v2, 2026-07-17) — the customer sees VIDEOS & IMAGES, never credits. Four cards:
 * Free · Pay as you go · Creator · Agency. No trial (subscribe = pay now). Driven by PLANS so the
 * marketing page and billing never drift (Creator = internal `starter`, Agency = internal `business`).
 *   variant="landing"   → CTAs go to /signup  (logged-out)
 *   variant="dashboard" → CTAs start Stripe checkout / open the Add-funds modal / show current plan
 */
import { useEffect, useState } from 'react'
import { ACTION_COSTS, normalizePlan, type PlanId } from '@/lib/plans'
import { openCredits } from '@/components/credits/CreditModal'

const DARK = '#16321a', LIME = '#dffe95', ACCENT = '#3a7000', MUTED = '#6b7a6b'
const IMG_USD = (ACTION_COSTS.image_clone_pro / 100).toFixed(2)   // 1 credit = 1¢
const VID_USD = String(Math.round(ACTION_COSTS.video_clone / 100))

type CardId = 'free' | 'payg' | 'starter' | 'business'
interface Card { id: CardId; tier: string; price: string; per: string; note: string; feats: string[]; cta: string; popular?: boolean }

// One paid plan (2026-07-25, Polsia-simple): Free (75 credits) · Mello full-time $49 · pay-as-you-go
// credits. Agency/business tier retired from display; the $49 plan uses internal `starter` checkout.
const CARDS: Card[] = [
  { id: 'free', tier: 'Free', price: '$0', per: '', note: 'No card needed',
    feats: ['75 free credits (~5 image ads)', 'Browse Discovery + Brand Spy', 'Remake any winning ad', 'Daily brief from Mello'], cta: 'Start free' },
  { id: 'starter', tier: 'Mello, full-time', price: '$49', per: '/ month', note: 'Everything, every morning',
    feats: ['Video ads', 'Unlimited image ads', 'Every competitor watched', 'Fresh creatives every morning'], cta: 'Go full-time', popular: true },
  { id: 'payg', tier: 'Pay as you go', price: `$${VID_USD}`, per: '/ video', note: 'No subscription',
    feats: [`$${VID_USD} per video ad`, `$${IMG_USD} per image ad`, 'Top up any amount, anytime', 'Balance never expires'], cta: 'Buy credits' },
]

const FAQS: { q: string; a: string }[] = [
  { q: 'How does pricing work?', a: `No credits, no math — you pay for what you make. An image ad is $${IMG_USD}, a video ad is $${VID_USD}. Buy as you go, or subscribe for unlimited images plus a monthly batch of videos.` },
  { q: 'Is there a free trial?', a: `The free plan gives you 75 credits (about 5 image ads) to start, no card needed. Want to test a video? Pay as you go — one video is just $${VID_USD}, no subscription.` },
  { q: 'What does "unlimited images" mean?', a: 'On the full-time plan, image-ad remakes are free and unlimited (fair use). Video ads are included every month.' },
  { q: 'What counts as one video ad?', a: 'A short-form ad up to about 30 seconds. Longer videos use a bit more of your monthly allowance.' },
  { q: 'Can I cancel anytime?', a: 'Yes — one click. You keep everything you made, and any pay-as-you-go balance never expires.' },
  { q: 'How much does an agency charge for the same thing?', a: `A UGC video from a freelancer runs $200–300 and takes a week. Here it's $${VID_USD} and about two minutes.` },
]

export default function PricingSection({ variant = 'landing' }: { variant?: 'landing' | 'dashboard' }) {
  const [current, setCurrent] = useState<PlanId | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [faq, setFaq] = useState<number | null>(0)

  useEffect(() => {
    if (variant !== 'dashboard') return
    fetch('/api/credits/balance').then((r) => r.json()).then((j) => setCurrent(normalizePlan(j.plan))).catch(() => {})
  }, [variant])

  const cta = async (c: Card) => {
    if (variant === 'landing') {
      window.location.href = c.id === 'starter' || c.id === 'business' ? `/signup?plan=${c.id}` : '/signup'
      return
    }
    // dashboard
    if (c.id === 'free') return
    if (c.id === 'payg') { openCredits('buy'); return }
    if (current === c.id) return
    setBusy(c.id)
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: c.id, cycle: 'monthly' }) })
      const j = await r.json()
      if (j.url) window.location.href = j.url
      else alert(j.error === 'not_configured' ? 'Billing isn’t fully configured yet (Stripe price IDs).' : (j.message || j.error || 'Could not start checkout.'))
    } finally { setBusy(null) }
  }

  const label = (c: Card) => {
    if (busy === c.id) return '…'
    if (variant === 'dashboard' && current === c.id) return 'Current plan'
    return c.cta
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', color: '#16261a' }}>
      {/* the one thing to remember */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginBottom: 30 }}>
        <div style={chip}><span style={{ fontSize: 19 }}>🖼️</span><span style={{ fontSize: 14, color: MUTED, fontWeight: 600 }}>Image ad</span><b style={{ fontSize: 21, letterSpacing: '-.02em' }}>${IMG_USD}</b></div>
        <div style={chip}><span style={{ fontSize: 19 }}>🎬</span><span style={{ fontSize: 14, color: MUTED, fontWeight: 600 }}>Video ad</span><b style={{ fontSize: 21, letterSpacing: '-.02em' }}>${VID_USD}</b></div>
      </div>

      {/* four cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(215px,100%), 1fr))', gap: 14, alignItems: 'stretch' }}>
        {CARDS.map((c) => (
          <div key={c.id} style={{
            background: '#fff', borderRadius: 18, padding: '22px 20px', position: 'relative', display: 'flex', flexDirection: 'column',
            border: c.popular ? `2px solid ${DARK}` : '1px solid rgba(0,0,0,0.09)',
            boxShadow: c.popular ? '0 18px 44px rgba(20,40,26,0.16)' : '0 2px 12px rgba(0,0,0,0.04)',
          }}>
            {c.popular && <div style={{ position: 'absolute', top: -11, left: 20, background: LIME, color: DARK, fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '.05em' }}>Most popular</div>}
            <div style={{ fontSize: 13, fontWeight: 800, color: ACCENT, letterSpacing: '.06em', textTransform: 'uppercase' }}>{c.tier}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '8px 0 2px' }}>
              <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.03em' }}>{c.price}</span>
              {c.per && <span style={{ fontSize: 14, color: '#999', fontWeight: 600 }}>{c.per}</span>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, minHeight: 16, marginBottom: 4 }}>{c.note}</div>
            <button onClick={() => cta(c)} disabled={busy === c.id || (variant === 'dashboard' && current === c.id)} style={{
              margin: '14px 0', padding: '11px', borderRadius: 100, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5,
              background: (variant === 'dashboard' && current === c.id) ? '#eef2ec' : c.popular ? LIME : (c.id === 'business' || c.id === 'payg') ? DARK : '#f2f6ee',
              color: (variant === 'dashboard' && current === c.id) ? '#6b7280' : (c.id === 'business' || c.id === 'payg') ? LIME : DARK,
            }}>{label(c)}</button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13, color: '#333' }}>
              {c.feats.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ background: LIME, color: DARK, borderRadius: '50%', width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* agency anchor */}
      <div style={{ marginTop: 28, padding: '18px 22px', borderRadius: 16, background: '#f2f8f0', border: '1px solid #d8e6d4', textAlign: 'center', fontSize: 16, fontWeight: 700, color: '#16261a' }}>
        A UGC video from a freelancer: <span style={{ color: MUTED, fontWeight: 500 }}>$200–300 and a week.</span> &nbsp;Here: ${VID_USD} and 2 minutes.
      </div>
      <p style={{ marginTop: 12, fontSize: 12.5, color: MUTED, textAlign: 'center' }}>1 video ad = a short-form ad up to ~30s; longer videos use a bit more. Unlimited images are fair-use. Prices in USD.</p>

      {/* FAQ */}
      <h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '48px 0 18px', textAlign: 'center' }}>Frequently asked questions</h3>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {FAQS.map((f, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
            <button onClick={() => setFaq(faq === i ? null : i)} style={{ width: '100%', textAlign: 'left', padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, color: '#111', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {f.q}<span style={{ color: ACCENT, transform: faq === i ? 'rotate(45deg)' : 'none', transition: 'transform .3s cubic-bezier(0,0,.2,1)' }}>+</span>
            </button>
            {/* Smooth open/close via grid-rows 0fr→1fr (animates to the answer's real height — the old
                conditional render just popped in instantly). */}
            <div style={{ display: 'grid', gridTemplateRows: faq === i ? '1fr' : '0fr', transition: 'grid-template-rows .32s cubic-bezier(0,0,.2,1)' }}>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0 20px 16px', fontSize: 13.5, color: '#555', lineHeight: 1.6, opacity: faq === i ? 1 : 0, transition: 'opacity .25s ease' }}>{f.a}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const chip: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 10, background: '#fff', border: '1px solid #e2e8e0', borderRadius: 14, padding: '13px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }
