'use client'
/**
 * Global inline upsell modal for 402 plan_limit responses (brand-spy cap, seats, etc). Mount
 * <UpsellModalHost/> once in the dashboard layout; call showUpsell(payload) from anywhere after a
 * fetch returns { error:'plan_limit', ... }. Animated, on-brand, → /billing.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PLANS, type PlanId } from '@/lib/plans'

const DARK = '#14281a', LIME = '#dffe95', ACCENT = '#3a7000'
const EVT = 'selfmade:upsell'

export interface UpsellPayload { limit?: string; current?: number; max?: number | null; upgradeTo?: PlanId; message?: string }

/** Fire from any client code: if the response is a plan_limit, show the modal. Returns true if shown. */
export function showUpsell(res: UpsellPayload & { error?: string }): boolean {
  if (typeof window === 'undefined' || res?.error !== 'plan_limit') return false
  window.dispatchEvent(new CustomEvent(EVT, { detail: res }))
  return true
}

export default function UpsellModalHost() {
  const [p, setP] = useState<UpsellPayload | null>(null)
  const router = useRouter()

  useEffect(() => {
    const h = (e: Event) => setP((e as CustomEvent).detail as UpsellPayload)
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])

  if (!p) return null
  const need = (p.upgradeTo && PLANS[p.upgradeTo]) ? p.upgradeTo : 'pro'

  return (
    <div onClick={() => setP(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,12,0.55)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'um-fade .2s ease both' }}>
      <style>{`
        @keyframes um-fade{from{opacity:0}to{opacity:1}}
        @keyframes um-pop{0%{opacity:0;transform:translateY(16px) scale(.96)}100%{opacity:1;transform:none}}
        .um-card{animation:um-pop .32s cubic-bezier(.2,.7,.2,1) both}
        .um-cta{transition:transform .14s ease, box-shadow .14s ease}
        .um-cta:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(20,40,26,.3)}
      `}</style>
      <div className="um-card" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: '32px 30px', width: 440, maxWidth: '94vw', textAlign: 'center', boxShadow: '0 30px 80px rgba(0,0,0,0.35)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: DARK, color: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>↑</div>
        <div style={{ display: 'inline-block', background: '#eef5eb', color: ACCENT, fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 100, marginBottom: 12 }}>Plan limit reached</div>
        <h2 style={{ fontSize: 21, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>Time to upgrade</h2>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, margin: '0 0 22px' }}>
          {p.message || `You've hit your plan's ${p.limit || ''} limit${p.max != null ? ` (${p.current}/${p.max})` : ''}. Upgrade to ${PLANS[need].label} for more.`}
        </p>
        <button className="um-cta" onClick={() => { setP(null); router.push('/billing') }} style={{ background: DARK, color: LIME, border: 'none', borderRadius: 100, padding: '13px 28px', fontWeight: 800, fontSize: 14.5, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Upgrade to {PLANS[need].label} <span style={{ fontSize: 16 }}>→</span>
        </button>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setP(null)} style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Maybe later</button>
        </div>
      </div>
    </div>
  )
}
