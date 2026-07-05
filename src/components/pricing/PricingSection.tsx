'use client'
/**
 * Shared pricing UI (Atria-style, green/lime brand) used on the public landing page AND the in-app
 * billing page. Tier cards + monthly/annual toggle + full feature-comparison grid + FAQ, all driven
 * by the PLANS config so the marketing page and backend never drift.
 *   variant="landing"   → CTAs go to /signup?plan=…  (logged-out)
 *   variant="dashboard" → CTAs start Stripe checkout / show current plan (logged-in)
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PLANS, PLAN_ORDER, TOPUP_PACKS, normalizePlan, type PlanId } from '@/lib/plans'

const DARK = '#14281a', LIME = '#dffe95', ACCENT = '#3a7000'
const cur = (p: PlanId, cycle: 'monthly' | 'annual') =>
  p === 'enterprise' ? 'Custom' : `$${cycle === 'annual' ? PLANS[p].priceAnnualMonthly : PLANS[p].priceMonthly}`

const CMP: { group: string; rows: { label: string; get: (p: PlanId) => string }[] }[] = [
  { group: 'Discovery & search', rows: [
    { label: 'Ad discovery search', get: (p) => PLANS[p].discoveryPages ? `Capped (${PLANS[p].discoveryPages} pages)` : '✓' },
    { label: 'Filters (perf · niche · hook · emotion · angle · format)', get: (p) => p === 'free' ? 'Basic' : '✓' },
    { label: 'Top Picks (curated)', get: (p) => p === 'free' ? 'Preview' : '✓' },
    { label: 'Saved ads / boards', get: (p) => p === 'free' ? '25 saves' : p === 'pro' || p === 'business' || p === 'enterprise' ? 'Team boards' : '✓' },
  ]},
  { group: 'Brand Spy', rows: [
    { label: 'Brands tracked', get: (p) => PLANS[p].brandSpy === Infinity ? 'Unlimited' : String(PLANS[p].brandSpy) },
  ]},
  { group: 'Intelligence', rows: [
    { label: 'Patterns / AI insights', get: (p) => PLANS[p].aiInsights ? '✓' : '—' },
  ]},
  { group: 'Creation — available on every tier, gated by credits', rows: [
    { label: 'Monthly credits', get: (p) => PLANS[p].monthlyCredits === null ? 'Custom' : PLANS[p].monthlyCredits!.toLocaleString() + (p === 'free' && PLANS[p].welcomeCredits ? ` (+${PLANS[p].welcomeCredits} welcome)` : '') },
    { label: 'Ask Mello · Scripts · Transcribe', get: () => '✓' },
    { label: 'Image Clone (2K, Nano Banana Pro)', get: () => '✓' },
    { label: 'Video Clone', get: () => '✓' },
    { label: 'Buy top-up credits', get: (p) => PLANS[p].canBuyCredits ? '✓' : '—' },
  ]},
  { group: 'Launch & analytics', rows: [
    { label: 'Launch ads', get: (p) => PLANS[p].launch ? '✓' : '—' },
    { label: 'Campaigns · Scale · Deep Reports', get: (p) => PLANS[p].campaigns ? '✓' : '—' },
  ]},
  { group: 'Team & API', rows: [
    { label: 'Seats', get: (p) => PLANS[p].seats + (p === 'enterprise' ? '+' : '') },
    { label: 'API / MCP', get: (p) => PLANS[p].api ? '✓' : '—' },
  ]},
]

const FAQS: { q: string; a: string }[] = [
  { q: 'Is there a free trial?', a: 'Yes — 7 days on any paid plan, no card needed. Or start on the free plan forever.' },
  { q: 'How do credits work?', a: 'One shared currency for AI actions (scripts, transcribe, Mello, Image Clone). Your plan refills monthly.' },
  { q: 'Do unused credits roll over?', a: 'Plan credits reset each month (use them or lose them). Purchased top-up credits roll over for 12 months.' },
  { q: 'Can I buy more credits?', a: 'Yes — top-up packs (250/$19, 750/$49, 2,000/$119) on any paid plan.' },
  { q: 'What counts as a brand in Brand Spy?', a: 'Each advertiser you actively track. Your plan sets the limit (15 → 50 → 150 → unlimited).' },
  { q: 'Can I change plans anytime?', a: 'Yes — upgrade instantly (prorated), downgrade at period end.' },
]

export default function PricingSection({ variant = 'landing' }: { variant?: 'landing' | 'dashboard' }) {
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly')
  const [current, setCurrent] = useState<PlanId | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [faq, setFaq] = useState<number | null>(0)

  useEffect(() => {
    if (variant !== 'dashboard') return
    fetch('/api/credits/balance').then((r) => r.json()).then((j) => setCurrent(normalizePlan(j.plan))).catch(() => {})
  }, [variant])

  const cta = async (p: PlanId) => {
    if (p === 'enterprise') { window.location.href = 'mailto:hello@tryselfmade.ai?subject=Enterprise%20plan'; return }
    if (variant === 'landing') { window.location.href = p === 'free' ? '/signup' : `/signup?plan=${p}&cycle=${cycle}`; return }
    if (p === 'free' || current === p) return
    setBusy(p)
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: p, cycle }) })
      const j = await r.json()
      if (j.url) window.location.href = j.url
      else alert(j.error === 'not_configured' ? 'Billing isn’t fully configured yet (Stripe price IDs).' : (j.message || j.error || 'Could not start checkout.'))
    } finally { setBusy(null) }
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', color: '#0a0a0a' }}>
      {/* toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 30 }}>
        <button onClick={() => setCycle('monthly')} style={toggle(cycle === 'monthly')}>Monthly</button>
        <button onClick={() => setCycle('annual')} style={toggle(cycle === 'annual')}>
          Annual <span style={{ fontSize: 11, background: LIME, color: DARK, borderRadius: 100, padding: '2px 8px', marginLeft: 6, fontWeight: 800 }}>−25%</span>
        </button>
      </div>

      {/* tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        {PLAN_ORDER.map((p) => {
          const plan = PLANS[p]
          const isCurrent = variant === 'dashboard' && current === p
          return (
            <div key={p} style={{
              background: '#fff', borderRadius: 20, padding: '24px 20px', position: 'relative', display: 'flex', flexDirection: 'column',
              border: plan.mostPopular ? `2px solid ${DARK}` : '1px solid rgba(0,0,0,0.09)',
              boxShadow: plan.mostPopular ? '0 20px 60px rgba(20,40,26,0.14)' : '0 2px 12px rgba(0,0,0,0.04)',
            }}>
              {plan.mostPopular && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: DARK, color: LIME, fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 100, whiteSpace: 'nowrap' }}>Most popular</div>}
              <div style={{ fontSize: 13, fontWeight: 800, color: ACCENT, letterSpacing: '.06em', textTransform: 'uppercase' }}>{plan.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, margin: '8px 0 2px' }}>
                <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.03em' }}>{cur(p, cycle)}</span>
                {p !== 'enterprise' && p !== 'free' && <span style={{ fontSize: 14, color: '#999', fontWeight: 600 }}>/mo</span>}
              </div>
              <div style={{ fontSize: 12, color: '#999', minHeight: 16 }}>
                {p === 'enterprise' ? 'Let’s talk' : p === 'free' ? 'Free forever' : cycle === 'annual' ? `billed $${plan.priceAnnualMonthly * 12}/yr` : `${plan.monthlyCredits} credits/mo`}
              </div>
              <button onClick={() => cta(p)} disabled={isCurrent || busy === p} style={{
                margin: '16px 0 14px', padding: '11px', borderRadius: 100, border: 'none', cursor: isCurrent ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13.5,
                background: isCurrent ? '#eef2ec' : plan.mostPopular ? DARK : LIME, color: isCurrent ? '#6b7280' : plan.mostPopular ? LIME : DARK,
              }}>
                {busy === p ? '…' : isCurrent ? 'Current plan' : p === 'enterprise' ? 'Contact us' : p === 'free' ? (variant === 'landing' ? 'Start free' : 'Free') : (variant === 'landing' ? 'Start trial' : 'Upgrade')}
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: '#333' }}>
                {[
                  plan.monthlyCredits === null ? 'Custom credits' : `${plan.monthlyCredits.toLocaleString()} credits/mo`,
                  plan.brandSpy === Infinity ? 'Unlimited brand spy' : `${plan.brandSpy} tracked brands`,
                  `${plan.seats} seat${plan.seats > 1 ? 's' : ''}`,
                  plan.aiInsights ? 'AI Insights + Patterns' : 'AI creation (credits)',
                  plan.campaigns ? 'Campaigns + Reports' : plan.launch ? 'Launch ads' : 'Discovery + Spy',
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ background: LIME, color: DARK, borderRadius: '50%', width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>✓</span>
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* comparison grid */}
      <h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '56px 0 18px', textAlign: 'center' }}>Compare features</h3>
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.08)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#f5f8f2' }}>
              <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: '#555' }}></th>
              {PLAN_ORDER.map((p) => (
                <th key={p} style={{ padding: '12px 8px', fontWeight: 800, color: PLANS[p].mostPopular ? ACCENT : '#333', textAlign: 'center' }}>{PLANS[p].label}{PLANS[p].mostPopular ? ' ★' : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CMP.map((sec) => (
              <>
                <tr key={sec.group}><td colSpan={6} style={{ padding: '12px 16px 6px', fontWeight: 800, color: ACCENT, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em', background: '#fafcf8' }}>{sec.group}</td></tr>
                {sec.rows.map((r) => (
                  <tr key={r.label} style={{ borderTop: '1px solid #f1f4ee' }}>
                    <td style={{ padding: '9px 16px', color: '#444' }}>{r.label}</td>
                    {PLAN_ORDER.map((p) => {
                      const v = r.get(p)
                      return <td key={p} style={{ padding: '9px 8px', textAlign: 'center', fontWeight: v === '✓' ? 800 : 600, color: v === '—' ? '#cbd0c8' : v === '✓' ? ACCENT : '#333' }}>{v}</td>
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* top-ups strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 24, fontSize: 13, color: '#555' }}>
        <span style={{ fontWeight: 700, color: DARK }}>Top-ups:</span>
        {TOPUP_PACKS.map((pk) => <span key={pk.id}>{pk.credits.toLocaleString()} credits — ${pk.priceUsd}</span>).reduce((acc: any[], el, i) => i ? [...acc, <span key={'d' + i} style={{ color: '#ccc' }}>·</span>, el] : [el], [])}
      </div>

      {/* FAQ */}
      <h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '52px 0 18px', textAlign: 'center' }}>Frequently asked questions</h3>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {FAQS.map((f, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
            <button onClick={() => setFaq(faq === i ? null : i)} style={{ width: '100%', textAlign: 'left', padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, color: '#111', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {f.q}<span style={{ color: ACCENT, transform: faq === i ? 'rotate(45deg)' : 'none', transition: 'transform .15s' }}>+</span>
            </button>
            {faq === i && <div style={{ padding: '0 20px 16px', fontSize: 13.5, color: '#555', lineHeight: 1.6 }}>{f.a}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

const toggle = (on: boolean): React.CSSProperties => ({ padding: '9px 20px', borderRadius: 100, border: on ? `1.5px solid ${DARK}` : '1.5px solid rgba(0,0,0,0.12)', background: on ? DARK : '#fff', color: on ? LIME : '#555', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center' })
