'use client'
/**
 * /billing/card — embedded PayPal card checkout (Advanced Card Payments / ACDC). The card fields are
 * PayPal's secure iframes, so no card data touches our servers. On submit PayPal runs 3-D Secure; we
 * then capture + grant. Subscriptions vault the card for monthly auto-charge. No PayPal account needed.
 *
 * Query: ?kind=subscription&plan=starter[&cycle=monthly]  OR  ?kind=topup&pack=medium
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PLANS, TOPUP_PACKS, type PlanId } from '@/lib/plans'

const INK = '#0e1b12', GREEN = '#16a34a', LIME = '#dffe95'
const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ''

function CardCheckout() {
  const params = useSearchParams()
  const router = useRouter()
  const kind = params.get('kind') === 'topup' ? 'topup' : 'subscription'
  const plan = (params.get('plan') || 'starter') as PlanId
  const cycle = params.get('cycle') === 'annual' ? 'annual' : 'monthly'
  const pack = params.get('pack') || 'medium'

  const [status, setStatus] = useState<'loading' | 'ready' | 'paying' | 'error'>('loading')
  const [error, setError] = useState('')
  const basketRef = useRef<string>('')
  const cardFieldRef = useRef<any>(null)

  // What we're charging (for the summary).
  const pl = PLANS[plan]
  const tp = TOPUP_PACKS.find((x) => x.id === pack)
  const amount = kind === 'subscription' ? (cycle === 'annual' ? pl.priceAnnualMonthly * 12 : pl.priceMonthly) : (tp?.priceUsd || 0)
  const title = kind === 'subscription' ? `${pl.label} — $${amount}/mo` : `${tp?.credits.toLocaleString()} credits — $${amount}`

  useEffect(() => {
    if (!CLIENT_ID) { setStatus('error'); setError('Card checkout isn’t configured yet (NEXT_PUBLIC_PAYPAL_CLIENT_ID).'); return }
    let cancelled = false
    const scriptId = 'paypal-sdk-cardfields'

    const init = () => {
      const paypal = (window as any).paypal
      if (!paypal?.CardFields) { setStatus('error'); setError('Could not load the card form. Refresh and try again.'); return }
      const cardField = paypal.CardFields({
        // Slim PayPal's hosted inputs so each field iframe matches our 48px boxes (default is ~78px).
        style: {
          input: { 'font-size': '15px', 'font-family': 'Inter, -apple-system, sans-serif', color: '#0e1b12', padding: '10px 12px' },
          '.invalid': { color: '#b91c1c' },
          ':focus': { color: '#0e1b12' },
        },
        createOrder: async () => {
          const r = await fetch('/api/billing/paypal/card/create-order', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind, plan, cycle, pack }),
          })
          const j = await r.json()
          if (!j.orderId) throw new Error(j.message || j.error || 'Could not start checkout')
          basketRef.current = j.basket
          return j.orderId
        },
        onApprove: async (data: any) => {
          const r = await fetch('/api/billing/paypal/card/capture', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            // PayPal's SDK sends orderID (capital ID); also stored server-side as a fallback.
            body: JSON.stringify({ orderId: data.orderID || data.orderId, basket: basketRef.current }),
          })
          const j = await r.json()
          if (j.ok) { window.location.href = `/billing/success?basket=${basketRef.current}&provider=paypal` }
          else { setStatus('error'); setError(j.message || 'Your card was declined. Try another card.') }
        },
        onError: (err: any) => { setStatus('error'); setError(String(err?.message || 'Payment error — try again.')) },
      })
      if (!cardField.isEligible()) { setStatus('error'); setError('Card payments aren’t available for this account.'); return }
      cardField.NumberField().render('#pp-card-number')
      cardField.ExpiryField().render('#pp-card-expiry')
      cardField.CVVField().render('#pp-card-cvv')
      cardField.NameField().render('#pp-card-name')
      cardFieldRef.current = cardField
      if (!cancelled) setStatus('ready')
    }

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing && (window as any).paypal?.CardFields) { init(); return }
    const s = document.createElement('script')
    s.id = scriptId
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CLIENT_ID)}&components=card-fields&currency=USD`
    s.onload = () => { if (!cancelled) init() }
    s.onerror = () => { if (!cancelled) { setStatus('error'); setError('Could not load PayPal. Check your connection and retry.') } }
    document.body.appendChild(s)
    return () => { cancelled = true }
  }, [kind, plan, cycle, pack])

  const pay = async () => {
    if (!cardFieldRef.current || status === 'paying') return
    setStatus('paying'); setError('')
    try { await cardFieldRef.current.submit() }
    catch (e: any) { setStatus('error'); setError(String(e?.message || 'Your card could not be processed.')) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter',-apple-system,sans-serif", background: 'radial-gradient(120% 100% at 50% -10%, #eef8dd, #ffffff)', padding: 24 }}>
      <div style={{ width: 'min(440px, 96vw)', background: '#fff', borderRadius: 18, boxShadow: '0 24px 70px rgba(0,0,0,0.12)', padding: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: GREEN }}>Secure checkout</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: INK, margin: '6px 0 2px' }}>{title}</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>
          {kind === 'subscription' ? 'Billed monthly. Cancel anytime in one click.' : 'One-time payment. Credits never expire.'} Pay by card — no PayPal account needed.
        </p>

        {status === 'error' && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        <div style={{ display: status === 'loading' ? 'none' : 'block' }}>
          <label style={lbl}>Name on card</label>
          <div id="pp-card-name" style={field} />
          <label style={lbl}>Card number</label>
          <div id="pp-card-number" style={field} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Expiry</label><div id="pp-card-expiry" style={field} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>CVC</label><div id="pp-card-cvv" style={field} /></div>
          </div>

          <button onClick={pay} disabled={status !== 'ready'}
            style={{ width: '100%', marginTop: 18, background: status === 'ready' ? INK : '#9ca3af', color: LIME, border: 'none', borderRadius: 100, padding: '14px', fontSize: 15, fontWeight: 800, cursor: status === 'ready' ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {status === 'paying' ? 'Processing…' : `Pay $${amount}`}
          </button>
        </div>

        {status === 'loading' && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: '24px 0' }}>Loading secure card form…</div>}

        {/* Secondary: let customers who prefer it pay via their PayPal account (redirect flow). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px' }}>
          <div style={{ flex: 1, height: 1, background: '#eef2ec' }} /><span style={{ fontSize: 11, color: '#9ca3af' }}>or</span><div style={{ flex: 1, height: 1, background: '#eef2ec' }} />
        </div>
        <button onClick={async () => {
          const r = await fetch('/api/billing/paypal/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'topup' ? { kind, pack } : { kind, plan, cycle }) }).then((x) => x.json()).catch(() => ({}))
          if (r?.url) window.location.href = r.url; else { setStatus('error'); setError(r?.message || 'Could not open PayPal.') }
        }} style={{ width: '100%', background: '#ffc439', color: '#003087', border: 'none', borderRadius: 100, padding: '11px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Pay with PayPal account</button>

        <button onClick={() => router.push('/billing')} style={{ width: '100%', marginTop: 12, background: 'transparent', color: '#6b7280', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: '#9ca3af' }}>🔒 Card details are encrypted by PayPal. We never see your card number.</div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', margin: '12px 0 5px' }
// height:auto (minHeight only) so the container grows to PayPal's iframe height instead of letting it
// overflow and overlap the next field. overflow:hidden keeps the rounded corners clean.
const field: React.CSSProperties = { minHeight: 48, border: '1.5px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }

export default function Page() {
  return <Suspense fallback={null}><CardCheckout /></Suspense>
}
