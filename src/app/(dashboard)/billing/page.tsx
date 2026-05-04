'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Profile {
  subscription_status: string
  trial_ends_at: string | null
  stripe_customer_id: string | null
}

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
        .select('subscription_status, trial_ends_at, stripe_customer_id')
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

  const status = profile?.subscription_status || 'trialing'
  const trialEnds = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null
  const trialDaysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86400000)) : 0
  const trialEnded = trialEnds ? trialEnds < new Date() : false
  const isActive = status === 'active'
  const isPastDue = status === 'past_due'
  const isCanceled = status === 'canceled'
  const isLocked = isPastDue || isCanceled || (status === 'trialing' && trialEnded) || expired

  /* ── Active subscription view ── */
  if (isActive) {
    return (
      <div style={{ padding: '32px 28px', maxWidth: 600, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a1a', marginBottom: 4 }}>Billing</h1>
        <p style={{ fontSize: 13, color: '#7a9a7a', marginBottom: 24 }}>Manage your Selfmade subscription</p>

        <div style={{ background: '#152928', border: '1px solid rgba(223,254,149,0.22)', borderRadius: 20, padding: 28, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: '1.5px', background: 'linear-gradient(90deg,transparent,#dffe95,transparent)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(223,254,149,0.6)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>Selfmade Pro — Active</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: '#dffe95' }}>$49</span>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>/month</span>
              </div>
            </div>
            <span style={{ background: '#dffe9520', border: '1px solid #dffe9540', color: '#dffe95', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 100 }}>✓ Active</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={() => checkout('portal')} disabled={loading}
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', padding: '10px 20px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {loading ? 'Loading…' : 'Manage subscription →'}
            </button>
            <button onClick={() => checkout('portal')} disabled={loading}
              style={{ background: 'transparent', border: '1px solid rgba(220,38,38,0.35)', color: '#f87171', padding: '10px 20px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel subscription
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 10, marginBottom: 0 }}>
            Cancelling opens the Stripe portal — access continues until end of billing period.
          </p>
        </div>
      </div>
    )
  }

  /* ── Non-active: two-column layout so pricing is always visible ── */
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '24px 24px', maxWidth: 1100 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a3a1a', marginBottom: 2 }}>Billing</h1>
      <p style={{ fontSize: 13, color: '#7a9a7a', marginBottom: 20 }}>Manage your Selfmade subscription</p>

      {/* Locked banner */}
      {isLocked && (
        <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 14, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 800, color: '#dc2626', fontSize: 14 }}>
              {isPastDue ? 'Payment failed — access paused' : isCanceled ? 'Subscription cancelled' : 'Your free trial has ended'}
            </div>
            <div style={{ fontSize: 12, color: '#9a3a3a', marginTop: 2 }}>
              {isPastDue ? 'Update your payment method to restore access.' : isCanceled ? 'Subscribe again to regain access.' : 'Subscribe below to keep using Selfmade — no data is lost.'}
            </div>
          </div>
        </div>
      )}

      {/* Trial active banner */}
      {status === 'trialing' && !trialEnded && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#15803d', fontSize: 13 }}>Free trial active</div>
            <div style={{ fontSize: 12, color: '#166534', marginTop: 1 }}>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining — no charge yet</div>
          </div>
          <span style={{ fontSize: 20 }}>⏳</span>
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

        {/* LEFT — marketing content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Hero */}
          <div style={{ background: '#0f1f0a', borderRadius: 18, padding: '24px 24px 20px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -50, right: -50, width: 180, height: 180, background: 'radial-gradient(circle, rgba(223,254,149,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', lineHeight: 1.3, marginBottom: 6 }}>
              Run Profitable Facebook Ads<br />
              <span style={{ color: '#dffe95' }}>Without Being an Expert</span>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Selfmade finds winning ads, builds campaigns, and scales them — automatically.
            </p>
            <div style={{ display: 'flex', gap: 20 }}>
              {[['$49/mo', 'All features'], ['7 days', 'Free trial'], ['Cancel', 'Anytime']].map(([val, label]) => (
                <div key={label}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#dffe95' }}>{val}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Value comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', letterSpacing: '.08em', marginBottom: 10, textTransform: 'uppercase' }}>Without Selfmade</div>
              {['Agency → $500–$2,000/mo', 'Months of trial & error', 'Wasting money on wrong creatives'].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7, fontSize: 12, color: '#555' }}>
                  <span style={{ color: '#dc2626', fontWeight: 700, flexShrink: 0 }}>✕</span>{item}
                </div>
              ))}
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#15803d', letterSpacing: '.08em', marginBottom: 10, textTransform: 'uppercase' }}>With Selfmade</div>
              {['Finds winning ads automatically', 'Builds campaigns for you', 'Scales what works, pauses losers'].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7, fontSize: 12, color: '#333' }}>
                  <span style={{ color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>✓</span>{item}
                </div>
              ))}
            </div>
          </div>

          {/* Steps + Features side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111', marginBottom: 12 }}>How it works</div>
              {[
                ['1', 'Enter your product'],
                ['2', 'We find your audiences & competitors'],
                ['3', 'We generate and launch your ads'],
                ['4', 'We scale what\'s working automatically'],
              ].map(([n, t], i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#152928', color: '#dffe95', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</div>
                  <span style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{t}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '16px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111', marginBottom: 12 }}>Everything included</div>
              {['AI Ad Strategy Builder', 'Winning Audience Targeting', 'Competitor Ad Intelligence', 'One-click Campaign Launch', 'Automatic Scaling System', 'Built for beginners & experts'].map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 12, color: '#444' }}>
                  <span style={{ background: '#dffe95', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#10211f', flexShrink: 0 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — pricing (sticky so it stays visible while scrolling left) */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 16 }}>
              {isLocked ? 'Restore your access' : 'Start your free trial'}
            </div>

            {/* Plan toggle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {(['monthly', 'annual'] as const).map(p => (
                <div key={p} onClick={() => setPlan(p)}
                  style={{ border: `2px solid ${plan === p ? '#152928' : '#e5e7eb'}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', position: 'relative', background: plan === p ? '#f0fdf4' : '#fff', transition: 'all .15s' }}>
                  {p === 'annual' && (
                    <div style={{ position: 'absolute', top: -9, right: 8, background: '#dffe95', color: '#10211f', fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 100 }}>Save 20%</div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{p === 'monthly' ? 'Monthly' : 'Annual'}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: '#111' }}>{p === 'monthly' ? '$49' : '$39'}</span>
                    <span style={{ fontSize: 12, color: '#888' }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>{p === 'monthly' ? 'Billed monthly' : '$470 billed yearly'}</div>
                  {plan === p && <div style={{ position: 'absolute', top: 10, right: 10, width: 16, height: 16, borderRadius: '50%', background: '#152928', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#dffe95', fontWeight: 900 }}>✓</div>}
                </div>
              ))}
            </div>

            <button onClick={() => checkout('checkout')} disabled={loading}
              style={{ width: '100%', padding: '13px', background: '#152928', color: '#dffe95', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginBottom: 8 }}>
              {loading ? 'Redirecting to Stripe…' : isLocked ? `Restore access — $${plan === 'monthly' ? '49' : '39'}/mo` : `Start Free Trial — $${plan === 'monthly' ? '49' : '39'}/mo`}
            </button>
            <p style={{ fontSize: 11, color: '#aaa', textAlign: 'center', margin: '0 0 16px' }}>Secure payment via Stripe · Cancel anytime</p>

            {/* Invite code */}
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>Have an invite code?</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="SM-XXXXXXXX"
                  onKeyDown={e => e.key === 'Enter' && redeemCode()}
                  style={{ flex: 1, padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '.04em', outline: 'none', minWidth: 0 }}
                />
                <button onClick={redeemCode} disabled={inviteLoading || !inviteCode.trim()}
                  style={{ padding: '8px 14px', background: '#152928', color: '#dffe95', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: inviteLoading || !inviteCode.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: !inviteCode.trim() ? 0.5 : 1, flexShrink: 0 }}>
                  {inviteLoading ? '…' : 'Apply'}
                </button>
              </div>
              {inviteMsg && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: inviteMsg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${inviteMsg.ok ? '#bbf7d0' : '#fecaca'}`, fontSize: 12, color: inviteMsg.ok ? '#15803d' : '#dc2626', fontWeight: 500 }}>
                  {inviteMsg.ok ? '✓ ' : '✕ '}{inviteMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
