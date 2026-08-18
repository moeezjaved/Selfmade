'use client'
/**
 * Client-side feature gate for paid pages (Patterns / Launch / Campaigns). Reads the user's plan
 * from /api/credits/balance; if the plan lacks the feature it renders an animated on-brand upsell
 * (locked hero → "Upgrade your plan" CTA → /billing). Server routes still enforce independently.
 */
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { planEntitlements, firstPlanWith, PLANS, type PlanEntitlements, type PlanId } from '@/lib/plans'

const DARK = '#14281a', LIME = '#ff5a2c', ACCENT = '#3a7000'

// One-plan model: every gated feature unlocks on Creator ($49). Perks describe what Creator turns on.
const CREATOR_PERKS = ['The full Meta cockpit — Launch, Campaigns, Scale & Insights', 'Winning-ad Patterns & AI Insights + Ask Mello', '10 video ads/mo + free unlimited image ads', 'Deep reports, exports & API access']
const PERKS: Record<string, string[]> = {
  aiInsights: CREATOR_PERKS,
  launch: CREATOR_PERKS,
  campaigns: CREATOR_PERKS,
  api: CREATOR_PERKS,
}

export default function UpgradeGate({ feature, name, children }: {
  feature: 'aiInsights' | 'launch' | 'campaigns' | 'api'
  name: string
  children: React.ReactNode
}) {
  const [ent, setEnt] = useState<PlanEntitlements | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)   // balance couldn't be read → DON'T show the paid wall
  const router = useRouter()

  // Read the (owner-resolved) plan. A team member draws the OWNER's plan, so this must reflect the
  // billing owner — which /api/credits/balance already resolves server-side. Critical: never fall back
  // to 'free' on a transient failure — that shows a PAYING user the upgrade wall (the team-member bug).
  // cache:'no-store' so a stale cached response from before an upgrade can't gate them either.
  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch('/api/credits/balance', { cache: 'no-store' })
        if (!r.ok) throw new Error(`balance ${r.status}`)
        const j = await r.json()
        if (!j || typeof j.plan !== 'string') throw new Error('no plan in balance')
        setEnt(planEntitlements(j.plan)); setLoading(false); return
      } catch {
        if (attempt === 0) { await new Promise((res) => setTimeout(res, 700)); continue }
        setFailed(true); setLoading(false); return
      }
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <div style={{ padding: 40, color: '#9ca3af' }}>Loading…</div>
  // Couldn't read the plan — show a retry, NEVER the upgrade wall (a paying user must never be told to
  // upgrade because of a network blip or a stale cache).
  if (failed) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
      <div style={{ marginBottom: 12, fontSize: 14 }}>Couldn’t load your plan. Check your connection and try again.</div>
      <button onClick={() => void load()} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
    </div>
  )
  if (ent && (ent as any)[feature]) return <>{children}</>

  const need: PlanId = firstPlanWith(feature)

  return (
    <div style={{ padding: 28, position: 'relative', minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes ug-in{0%{opacity:0;transform:translateY(18px) scale(.98)}100%{opacity:1;transform:none}}
        @keyframes ug-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes ug-ring{0%{transform:scale(.9);opacity:.5}70%{transform:scale(1.5);opacity:0}100%{opacity:0}}
        @keyframes ug-shine{0%{background-position:-200% 0}100%{background-position:200% 0}}
        .ug-card{animation:ug-in .5s cubic-bezier(.2,.7,.2,1) both}
        .ug-lock{animation:ug-float 3s ease-in-out infinite}
        .ug-cta{transition:transform .15s ease, box-shadow .15s ease}
        .ug-cta:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(20,40,26,.28)}
        .ug-cta:active{transform:translateY(0)}
        .ug-perk{animation:ug-in .5s cubic-bezier(.2,.7,.2,1) both}
      `}</style>

      <div className="ug-card" style={{ maxWidth: 560, width: '100%', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 22, padding: '38px 34px', textAlign: 'center', boxShadow: '0 24px 70px rgba(20,40,26,0.12)' }}>
        {/* animated lock */}
        <div style={{ position: 'relative', width: 66, height: 66, margin: '0 auto 20px' }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${LIME}`, animation: 'ug-ring 2.4s ease-out infinite' }} />
          <div className="ug-lock" style={{ width: 66, height: 66, borderRadius: '50%', background: '#ef4a1e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🔒</div>
        </div>

        <div style={{ display: 'inline-block', background: '#f3eee3', color: ACCENT, fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 100, marginBottom: 12 }}>{PLANS[need].label} feature</div>
        <h1 style={{ fontSize: 25, fontWeight: 800, color: '#111', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Unlock {name}</h1>
        <p style={{ fontSize: 14.5, color: '#6b7280', lineHeight: 1.6, margin: '0 0 22px' }}>
          {name} is on the <b style={{ color: DARK }}>{PLANS[need].label}</b> plan. Upgrade to turn it on — your credits and saved work carry over.
        </p>

        {/* perks unlocked */}
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340, margin: '0 auto 26px' }}>
          {(PERKS[feature] || []).map((perk, i) => (
            <div key={perk} className="ug-perk" style={{ animationDelay: `${0.12 + i * 0.08}s`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: '#333' }}>
              <span style={{ background: '#ef4a1e', color: '#fff', borderRadius: '50%', width: 19, height: 19, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>✓</span>
              {perk}
            </div>
          ))}
        </div>

        <button className="ug-cta" onClick={() => router.push('/billing')} style={{
          background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '14px 30px', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          Upgrade to {PLANS[need].label} <span style={{ fontSize: 17 }}>→</span>
        </button>
        <div style={{ marginTop: 14 }}>
          <button onClick={() => router.push('/billing')} style={{ background: 'transparent', border: 'none', color: '#6b7280', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>See all plans</button>
        </div>
      </div>
    </div>
  )
}
