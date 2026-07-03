'use client'
/**
 * Client-side feature gate for paid pages (Patterns / Launch / Campaigns). Reads the user's plan
 * from /api/credits/balance; if the plan doesn't include the feature it renders an on-brand upsell
 * instead of the page content. Server routes still enforce independently (never trust the client).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { planEntitlements, firstPlanWith, PLANS, type PlanEntitlements } from '@/lib/plans'

const DARK = '#1a3a1a', LIME = '#dffe95'

export default function UpgradeGate({ feature, name, children }: {
  feature: 'aiInsights' | 'launch' | 'campaigns' | 'api'
  name: string
  children: React.ReactNode
}) {
  const [ent, setEnt] = useState<PlanEntitlements | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/credits/balance').then((r) => r.json()).then((j) => setEnt(planEntitlements(j.plan))).catch(() => setEnt(planEntitlements('free'))).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 40, color: '#9ca3af' }}>Loading…</div>
  if (ent && (ent as any)[feature]) return <>{children}</>

  const need = firstPlanWith(feature)
  return (
    <div style={{ padding: 28 }}>
      <div style={{ maxWidth: 560, margin: '40px auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 32, textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#eef5eb', color: DARK, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22 }}>🔒</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>{name} is a {PLANS[need].label} feature</h1>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, margin: '0 0 20px' }}>
          Upgrade to <b style={{ color: DARK }}>{PLANS[need].label}</b> to unlock {name.toLowerCase()} — plus everything below it. Your credits and saved work carry over.
        </p>
        <button onClick={() => router.push('/billing')} style={{ background: DARK, color: LIME, border: 'none', borderRadius: 100, padding: '12px 26px', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          Upgrade to {PLANS[need].label}
        </button>
      </div>
    </div>
  )
}
