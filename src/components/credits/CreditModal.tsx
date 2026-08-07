'use client'
/**
 * Credits & plan modal (Atria-style account popup).
 *
 * Two views in one modal:
 *  • 'plan'  — current plan + Upgrade, credit balance split into monthly-refreshed (plan) vs
 *              non-expiring (top-up), and a Buy-credits CTA.
 *  • 'buy'   — top-up pack grid → Stripe one-time checkout (/api/billing/topup).
 *
 * Opens from the CreditCounter pill, or globally via the `credits:open` window event
 * (detail: { view?: 'plan' | 'buy', reason?: string }) — fired when an action hits
 * insufficient credits so the user can top up in place instead of a browser confirm().
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Zap, Plus, Check, Loader2, Infinity as InfinityIcon } from 'lucide-react'
import { PLANS, TOPUP_PACKS, normalizePlan } from '@/lib/plans'

const LIME = '#dffe95'
const INK = '#1a3a1a'

export const OPEN_EVENT = 'credits:open'
/** Open the modal from anywhere (e.g. after an insufficient-credits error). */
export function openCredits(view: 'plan' | 'buy' = 'plan', reason?: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { view, reason } }))
}

interface Balance { balance: number; plan_credits: number; topup_credits: number; plan: string; reset_at: string | null; trialing?: boolean; trial_ends_at?: string | null }

export function CreditModal() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'plan' | 'buy'>('plan')
  const [reason, setReason] = useState<string | null>(null)
  const [bal, setBal] = useState<Balance | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const load = async () => {
    try {
      const r = await fetch('/api/credits/balance')
      if (r.ok) setBal(await r.json())
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail || {}
      setView(d.view === 'buy' ? 'buy' : 'plan')
      setReason(d.reason || null)
      setOpen(true)
      load()
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!mounted || !open) return null

  const planId = normalizePlan(bal?.plan)
  const ent = PLANS[planId]
  const monthlyLimit = ent.monthlyCredits
  const planCredits = bal?.plan_credits ?? 0
  const topupCredits = bal?.topup_credits ?? 0
  const total = bal?.balance ?? planCredits + topupCredits
  const canBuy = ent.canBuyCredits
  const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const resetDate = fmtDate(bal?.reset_at)
  const trialEndDate = fmtDate(bal?.trial_ends_at)

  const buy = async (packId: string) => {
    setBusy(packId)
    try {
      // Payment rail chosen by NEXT_PUBLIC_PAYMENTS_PROVIDER: paypal | payfast | (else) Stripe.
      const provider = process.env.NEXT_PUBLIC_PAYMENTS_PROVIDER
      if (provider === 'paypal') {
        const { startPaypalCheckout } = await import('@/lib/paypal/start')
        const res = await startPaypalCheckout({ kind: 'topup', pack: packId })
        if ((res as any)?.error === 'canBuyCredits' || (res as any)?.feature) { setView('plan'); setReason('Top-ups are a paid-plan feature — upgrade to buy credits.'); setBusy(null); return }
        if (res?.error) { setReason(res.message || res.error); setBusy(null) }
        return   // redirecting to PayPal
      }
      if (provider === 'payfast') {
        const { startPayfastCheckout } = await import('@/lib/payfast/start')
        const res = await startPayfastCheckout({ kind: 'topup', pack: packId })
        if ((res as any)?.error === 'canBuyCredits' || (res as any)?.feature) { setView('plan'); setReason('Top-ups are a paid-plan feature — upgrade to buy credits.'); setBusy(null); return }
        if (res?.error) { setReason(res.message || res.error); setBusy(null) }
        return   // redirecting to PayFast
      }
      const r = await fetch('/api/billing/topup', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pack: packId }),
      })
      const j = await r.json()
      if (j.url) { window.location.href = j.url; return }
      if (r.status === 402) { setView('plan'); setReason('Top-ups are a paid-plan feature — upgrade to buy credits.'); setBusy(null); return }
      setReason(j.message || j.error || 'Could not start checkout — try again.'); setBusy(null)
    } catch { setReason('Network error — try again.'); setBusy(null) }
  }

  // End the trial now → charge the saved card → unlock the full plan credit pool.
  const unlockNow = async () => {
    setUnlocking(true); setReason(null)
    try {
      const r = await fetch('/api/billing/end-trial', { method: 'POST' })
      const j = await r.json()
      if (r.ok && j.ok) {
        window.dispatchEvent(new Event('credits:refresh'))  // update the sidebar pill
        await load()                                          // refresh the modal figures
        setReason('✓ Your full plan credits are now unlocked.')
      } else {
        setReason(j.message || j.error || 'Could not process payment — please check your card in Billing.')
      }
    } catch { setReason('Network error — try again.') }
    finally { setUnlocking(false) }
  }

  return createPortal(
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,15,0.55)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 18, boxShadow: '0 24px 80px rgba(0,0,0,0.4)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #eef2ee' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: INK }}>{view === 'buy' ? 'Buy credits' : 'Credits & plan'}</div>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex' }}><X size={20} /></button>
        </div>

        {reason && (
          <div style={{ margin: '14px 22px 0', background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{reason}</div>
        )}

        {/* Trial banner — full plan credits are held back until the trial converts (anti-abuse). */}
        {bal?.trialing && (
          <div style={{ margin: '14px 22px 0', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>🎁 You're on a free trial</div>
            <div style={{ fontSize: 12.5, color: '#3f6b4a', marginTop: 4, lineHeight: 1.5 }}>
              Your full {ent.label} credits{monthlyLimit != null ? ` (${monthlyLimit.toLocaleString()}/mo)` : ''} unlock when your trial ends
              {trialEndDate ? <> on <b>{trialEndDate}</b></> : ''}. Want them now?
            </div>
            <button onClick={unlockNow} disabled={unlocking}
              style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, background: INK, color: LIME, border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: unlocking ? 'default' : 'pointer', fontFamily: 'inherit', opacity: unlocking ? 0.7 : 1 }}>
              {unlocking ? <><Loader2 size={14} className="spin" /> Unlocking…</> : <><Zap size={14} /> Pay now &amp; unlock credits</>}
            </button>
            <div style={{ fontSize: 11, color: '#6b8f6b', marginTop: 7 }}>Ends your trial early and charges your saved card today. Cancel anytime.</div>
          </div>
        )}

        {view === 'plan' ? (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Current plan */}
            <div style={{ border: '1px solid #e5e9e5', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9ca3af' }}>Current plan</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: INK, marginTop: 2 }}>{ent.label}</div>
              </div>
              {/* Only Free can upgrade — Creator ($49) is the top public plan, so a paid user has
                  nothing to upgrade to. Manage/cancel lives on Billing. */}
              {planId === 'free' && (
                <a href="/billing" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: INK, color: LIME, padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>
                  <Zap size={14} /> Upgrade
                </a>
              )}
            </div>

            {/* Credit balance */}
            <div style={{ border: '1px solid #e5e9e5', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>AI credits</div>
                {canBuy && (
                  <button onClick={() => { setView('buy'); setReason(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0fdf4', border: '1px solid #bbf7d0', color: INK, padding: '6px 12px', borderRadius: 100, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Plus size={13} /> Buy credits
                  </button>
                )}
              </div>
              <div style={{ fontSize: 34, fontWeight: 800, color: INK, lineHeight: 1 }}>{total.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#6b8f6b', marginTop: 2 }}>total credits</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <div style={{ flex: 1, background: '#f8fcf6', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: '#6b8f6b', fontWeight: 600 }}>Monthly-refreshed</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginTop: 2 }}>
                    {planCredits.toLocaleString()}{monthlyLimit != null ? <span style={{ color: '#9ca3af', fontWeight: 600 }}> / {monthlyLimit.toLocaleString()}</span> : ''}
                  </div>
                  {resetDate && <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>Resets {resetDate}</div>}
                </div>
                <div style={{ flex: 1, background: '#f8fcf6', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: '#6b8f6b', fontWeight: 600 }}>Non-expiring</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginTop: 2 }}>{topupCredits.toLocaleString()}</div>
                  <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>From top-ups</div>
                </div>
              </div>
              {!canBuy && (
                <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
                  Upgrade to a paid plan to buy top-up credits that never expire.
                </div>
              )}
            </div>

            <a href="/billing" style={{ textAlign: 'center', fontSize: 12.5, color: '#6b8f6b', fontWeight: 600, textDecoration: 'none' }}>Billing &amp; invoices →</a>
          </div>
        ) : (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 14, color: '#374151' }}>Choose a credit pack. <span style={{ color: '#6b8f6b', fontWeight: 600 }}>Top-ups never expire.</span></div>
            {(() => {
              // Best value = most credits per dollar (usually the largest pack).
              const perDollar = (p: typeof TOPUP_PACKS[number]) => p.credits / p.priceUsd
              const bestId = [...TOPUP_PACKS].sort((a, b) => perDollar(b) - perDollar(a))[0]?.id
              const midId = TOPUP_PACKS.length >= 3 ? TOPUP_PACKS[1].id : undefined
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  {TOPUP_PACKS.map((p) => {
                    const best = p.id === bestId
                    const popular = p.id === midId && !best
                    const badge = best ? 'Best value' : popular ? 'Popular' : null
                    const loading = busy === p.id
                    return (
                      <button key={p.id} onClick={() => buy(p.id)} disabled={!!busy}
                        style={{ position: 'relative', border: `2px solid ${best ? INK : '#e5e9e5'}`, borderRadius: 16, padding: '22px 12px 16px', background: best ? 'linear-gradient(180deg,#f4fbe8,#ffffff)' : '#fff', cursor: busy ? 'default' : 'pointer', textAlign: 'center', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, boxShadow: best ? '0 8px 24px rgba(26,58,26,0.12)' : 'none', transition: 'transform .12s, box-shadow .12s, border-color .12s', opacity: busy && !loading ? 0.5 : 1 }}
                        onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(26,58,26,0.16)'; e.currentTarget.style.borderColor = INK } }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = best ? '0 8px 24px rgba(26,58,26,0.12)' : 'none'; e.currentTarget.style.borderColor = best ? INK : '#e5e9e5' }}>
                        {badge && (
                          <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: best ? INK : '#6b8f6b', background: best ? LIME : '#eef7dc', border: `1px solid ${best ? '#cde87a' : '#dcecc0'}`, padding: '3px 10px', borderRadius: 100 }}>{badge}</span>
                        )}
                        <span style={{ fontSize: 20, color: best ? '#5a7d16' : '#9cbf5a', lineHeight: 1 }}>◆</span>
                        <div style={{ fontSize: 26, fontWeight: 900, color: INK, lineHeight: 1.1 }}>{p.credits.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>credits</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#3f6b4a', marginTop: 6 }}>${p.priceUsd}</div>
                        <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 1 }}>{Math.round(perDollar(p))} credits / $1</div>
                        {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.7)', borderRadius: 14 }}><Loader2 size={20} className="spin" style={{ color: INK }} /></div>}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af' }}>
              <Check size={13} style={{ color: '#6b8f6b' }} /> Secure Stripe checkout · credits added instantly after payment
            </div>
            <button onClick={() => { setView('plan'); setReason(null) }} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#6b8f6b', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Back to plan</button>
          </div>
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>,
    document.body,
  )
}
