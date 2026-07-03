'use client'
/**
 * Pricing page (spec §1, §3) — the 5-tier matrix from the PLANS config with a monthly/annual toggle
 * (25% off), Most-Popular on Pro, current-plan indicator, top-up packs, and upgrade CTAs that kick
 * off Stripe checkout. Reads live plan from /api/credits/balance.
 */
import { useEffect, useState } from 'react'
import { PLANS, PLAN_ORDER, TOPUP_PACKS, normalizePlan, type PlanId } from '@/lib/plans'
import { Check, Star, Loader2 } from 'lucide-react'

const DARK = '#1a3a1a', LIME = '#dffe95'

const ROWS: { label: string; get: (p: PlanId) => string }[] = [
  { label: 'Monthly credits', get: (p) => PLANS[p].monthlyCredits === null ? 'Custom' : String(PLANS[p].monthlyCredits) },
  { label: 'Brand Spy (tracked brands)', get: (p) => PLANS[p].brandSpy === Infinity ? 'Unlimited' : String(PLANS[p].brandSpy) },
  { label: 'Seats', get: (p) => String(PLANS[p].seats) },
  { label: 'AI Insights (Patterns)', get: (p) => PLANS[p].aiInsights ? '✓' : '—' },
  { label: 'Launch Ads', get: (p) => PLANS[p].launch ? '✓' : '—' },
  { label: 'Campaigns & Reports', get: (p) => PLANS[p].campaigns ? '✓' : '—' },
  { label: 'API / MCP access', get: (p) => PLANS[p].api ? '✓' : '—' },
  { label: 'Exports', get: (p) => PLANS[p].exports ? '✓' : '—' },
  { label: 'Buy credit top-ups', get: (p) => PLANS[p].canBuyCredits ? '✓' : '—' },
]

export default function PricingPage() {
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly')
  const [current, setCurrent] = useState<PlanId>('free')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/credits/balance').then((r) => r.json()).then((j) => setCurrent(normalizePlan(j.plan))).catch(() => {})
  }, [])

  const startCheckout = async (plan: PlanId) => {
    if (plan === 'enterprise') { window.location.href = 'mailto:hello@tryselfmade.ai?subject=Enterprise%20plan'; return }
    if (plan === 'free') return
    setBusy(plan)
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, cycle }) })
      const j = await r.json()
      if (j.url) window.location.href = j.url
      else alert(j.error === 'not_configured' ? 'Billing isn’t fully configured yet (Stripe price IDs).' : (j.message || j.error || 'Could not start checkout.'))
    } finally { setBusy(null) }
  }

  const buyTopup = async (packId: string) => {
    setBusy('topup-' + packId)
    try {
      const r = await fetch('/api/billing/topup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pack: packId }) })
      const j = await r.json()
      if (j.url) window.location.href = j.url
      else alert(j.error === 'plan_limit' ? j.message : j.error === 'not_configured' ? 'Top-ups aren’t configured yet (Stripe).' : (j.message || 'Could not start top-up.'))
    } finally { setBusy(null) }
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: '#111', margin: 0 }}>Plans & Pricing</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 6 }}>Discovery + Brand Spy + Patterns + AI creation + Launch + Analytics — everything in one place.</p>
      </div>

      {/* cycle toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '18px 0 26px' }}>
        <button onClick={() => setCycle('monthly')} style={toggle(cycle === 'monthly')}>Monthly</button>
        <button onClick={() => setCycle('annual')} style={toggle(cycle === 'annual')}>Annual <span style={{ fontSize: 11, background: LIME, color: DARK, borderRadius: 20, padding: '1px 7px', marginLeft: 4 }}>−25%</span></button>
      </div>

      {/* tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {PLAN_ORDER.map((p) => {
          const plan = PLANS[p]
          const price = p === 'enterprise' ? 'Custom' : `$${cycle === 'annual' ? plan.priceAnnualMonthly : plan.priceMonthly}`
          const isCurrent = current === p
          return (
            <div key={p} style={{ background: '#fff', border: plan.mostPopular ? `2px solid ${DARK}` : '1px solid #e2e8f0', borderRadius: 16, padding: 18, position: 'relative', display: 'flex', flexDirection: 'column' }}>
              {plan.mostPopular && <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: DARK, color: LIME, fontSize: 10.5, fontWeight: 800, padding: '3px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}><Star size={11} /> MOST POPULAR</div>}
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{plan.label}</div>
              <div style={{ margin: '6px 0 2px' }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: '#111' }}>{price}</span>
                {p !== 'enterprise' && p !== 'free' && <span style={{ fontSize: 12, color: '#6b7280' }}>/mo</span>}
              </div>
              <div style={{ fontSize: 11.5, color: '#6b7280', minHeight: 16 }}>{cycle === 'annual' && p !== 'enterprise' && p !== 'free' ? `billed $${plan.priceAnnualMonthly * 12}/yr` : plan.monthlyCredits !== null ? `${plan.monthlyCredits} credits/mo` : 'Custom credits'}</div>
              <button onClick={() => startCheckout(p)} disabled={isCurrent || busy === p}
                style={{ margin: '14px 0', padding: '10px', borderRadius: 10, border: isCurrent ? '1px solid #cbd5cb' : 'none', background: isCurrent ? '#f1f5f1' : (plan.mostPopular ? DARK : '#eef5eb'), color: isCurrent ? '#6b7280' : (plan.mostPopular ? LIME : DARK), fontWeight: 700, fontSize: 13, cursor: isCurrent ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', justifyContent: 'center', gap: 6 }}>
                {busy === p ? <Loader2 size={15} className="spin" /> : isCurrent ? 'Current plan' : p === 'enterprise' ? 'Contact us' : p === 'free' ? 'Free' : 'Upgrade'}
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: '#374151' }}>
                {ROWS.map((r) => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ color: '#6b7280' }}>{r.label}</span>
                    <span style={{ fontWeight: 700, color: r.get(p) === '—' ? '#cbd5cb' : '#111' }}>{r.get(p)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* top-ups */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>Need more credits? Top up anytime</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Top-up credits roll over and expire 12 months after purchase. Available on any paid plan.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14, maxWidth: 640 }}>
          {TOPUP_PACKS.map((pk) => (
            <div key={pk.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#111' }}>{pk.credits.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>credits</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: DARK, margin: '8px 0' }}>${pk.priceUsd}</div>
              <button onClick={() => buyTopup(pk.id)} disabled={busy === 'topup-' + pk.id} style={{ width: '100%', padding: 9, borderRadius: 9, border: `1px solid ${DARK}`, background: '#fff', color: DARK, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                {busy === 'topup-' + pk.id ? '…' : 'Buy pack'}
              </button>
            </div>
          ))}
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

const toggle = (on: boolean): React.CSSProperties => ({ padding: '8px 18px', borderRadius: 20, border: `1px solid ${on ? DARK : '#cbd5cb'}`, background: on ? DARK : '#fff', color: on ? LIME : '#374151', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center' })
