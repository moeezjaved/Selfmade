'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import PricingSection from '@/components/pricing/PricingSection'
import { PLANS, normalizePlan } from '@/lib/plans'

interface Profile {
  subscription_status: string
  trial_ends_at: string | null
  stripe_customer_id: string | null
  plan_id?: string | null
}

const FEATURES = [
  'Live KPI Dashboard',
  'AI Recommendations',
  'M4 Campaign Wizard',
  'Campaign Manager',
  'Creative Studio',
  'Reports & Insights',
  'Scale & Optimise',
  'Activity Log',
]

export default function BillingPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [plan, setPlan] = useState<'monthly' | 'annual'>('monthly')
  const [loading, setLoading] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()
  const expired = searchParams.get('expired') === '1'

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('user_profiles')
        .select('subscription_status, trial_ends_at, stripe_customer_id, plan_id')
        .eq('user_id', user.id).single()
        .then(({ data }) => setProfile(data))
    })
  }, [])

  const redeemCode = async () => {
    if (!inviteCode.trim()) return
    setInviteLoading(true)
    setInviteMsg(null)
    const res = await fetch('/api/invite/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: inviteCode.trim() }),
    })
    const { ok, message, error } = await res.json()
    if (ok) {
      setInviteMsg({ ok: true, text: message })
      setInviteCode('')
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      setInviteMsg({ ok: false, text: error || 'Something went wrong.' })
    }
    setInviteLoading(false)
  }

  const checkout = async (action: 'checkout' | 'portal' = 'checkout') => {
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, action }),
    })
    const { url, error } = await res.json()
    if (error) { alert(error); setLoading(false); return }
    window.location.href = url
  }

  // Cancel the PayFast subscription — access continues until period end, then downgrades to Free.
  const cancelPlan = async () => {
    if (!confirm('Cancel your subscription? You’ll keep full access until the end of your current billing period, then move to Free.')) return
    setLoading(true)
    try {
      const r = await fetch('/api/billing/cancel', { method: 'POST' }).then((x) => x.json()).catch(() => ({}))
      if (r?.ok) { alert('Your subscription is cancelled — access continues until the end of this period.'); window.location.reload() }
      else { alert(r?.error || 'Could not cancel — please contact support.'); setLoading(false) }
    } catch { alert('Could not cancel — please try again.'); setLoading(false) }
  }

  const status = profile?.subscription_status || 'trialing'
  const trialEnds = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null
  const trialDaysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86400000)) : 0
  const trialEnded = trialEnds ? trialEnds < new Date() : false
  const isActive = status === 'active'
  const isPastDue = status === 'past_due'
  const isCanceled = status === 'canceled'
  const isLocked = isPastDue || isCanceled || (status === 'trialing' && trialEnded) || expired

  return (
    <div style={{ padding: '32px 28px', maxWidth: 1120, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a1a', marginBottom: 4 }}>Billing & plans</h1>
      <p style={{ fontSize: 13, color: '#7a9a7a', marginBottom: 28 }}>Choose a plan, buy top-ups, or manage your subscription.</p>

      {/* Full pricing (shared with the landing page — one source of truth). */}
      <div style={{ marginBottom: 40 }}>
        <PricingSection variant="dashboard" />
      </div>

      <div style={{ maxWidth: 680 }}>

      {/* Trial expired / access locked banner */}
      {isLocked && (
        <div style={{ background: 'linear-gradient(135deg, #fff5f5 0%, #fef2f2 100%)', border: '1.5px solid #fecaca', borderRadius: 16, padding: '20px 24px', marginBottom: 24, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 28 }}>🔒</div>
          <div>
            <div style={{ fontWeight: 800, color: '#dc2626', fontSize: 16, marginBottom: 4 }}>
              {isPastDue ? 'Payment failed — access paused' : isCanceled ? 'Subscription cancelled' : 'Your free trial has ended'}
            </div>
            <div style={{ fontSize: 13, color: '#9a3a3a', lineHeight: 1.5 }}>
              {isPastDue
                ? 'Your last payment failed. Update your payment method to restore access.'
                : isCanceled
                ? 'Your subscription was cancelled. Subscribe again to regain access to all features.'
                : 'Your 7-day trial is over. Subscribe to keep using Selfmade — no data is lost.'}
            </div>
          </div>
        </div>
      )}

      {/* Active subscription card */}
      {isActive && (
        <div style={{ background: '#152928', border: '1px solid rgba(223,254,149,0.22)', borderRadius: 20, padding: 28, marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: '1.5px', background: 'linear-gradient(90deg,transparent,#dffe95,transparent)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(223,254,149,0.6)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>Your subscription</div>
              <div style={{ fontSize: 34, fontWeight: 900, color: '#dffe95', lineHeight: 1 }}>Selfmade {PLANS[normalizePlan(profile?.plan_id)].label}</div>
            </div>
            <span style={{ background: '#dffe9520', border: '1px solid #dffe9540', color: '#dffe95', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 100 }}>✓ Active</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              onClick={() => checkout('portal')}
              disabled={loading}
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', padding: '10px 20px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {loading ? 'Loading…' : 'Manage subscription →'}
            </button>
            <button
              onClick={cancelPlan}
              disabled={loading}
              style={{ background: 'transparent', border: '1px solid rgba(220,38,38,0.35)', color: '#f87171', padding: '10px 20px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >
              Cancel subscription
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 10, marginBottom: 0 }}>
            Cancelling stops future renewals — your plan stays active until the end of the current period.
          </p>
        </div>
      )}

      {/* Trial banner removed 2026-07-30: there is NO free trial in the pricing model (Free plan +
          paid $49, charged immediately). The old "Free trial active — N days, no charge" was false. */}

      {/* NOTE: the plan grid above (PricingSection) is the single source of pricing. A legacy
          hardcoded "$49/mo (no name)" selector used to render here too — it contradicted the real
          plan cards (Starter $39 / Pro $99 / …), so it was removed. */}

      {/* Invite code */}
      {!isActive && (
        <div style={{ marginTop: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 4 }}>Have an invite code?</div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Enter your code to unlock free access</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="SM-XXXXXXXX"
              onKeyDown={e => e.key === 'Enter' && redeemCode()}
              style={{ flex: 1, padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '.05em', outline: 'none' }}
            />
            <button
              onClick={redeemCode}
              disabled={inviteLoading || !inviteCode.trim()}
              style={{ padding: '10px 20px', background: '#152928', color: '#dffe95', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: inviteLoading || !inviteCode.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: !inviteCode.trim() ? 0.5 : 1 }}
            >
              {inviteLoading ? 'Checking…' : 'Apply'}
            </button>
          </div>
          {inviteMsg && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: inviteMsg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${inviteMsg.ok ? '#bbf7d0' : '#fecaca'}`, fontSize: 13, color: inviteMsg.ok ? '#15803d' : '#dc2626', fontWeight: 500 }}>
              {inviteMsg.ok ? '✓ ' : '✕ '}{inviteMsg.text}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
