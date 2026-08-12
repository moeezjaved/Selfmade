'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

const INK = '#0e1b12', GREEN = '#16a34a', LIME = '#ff5a2c'

function Success() {
  const params = useSearchParams()
  const router = useRouter()
  const basket = params.get('basket')
  const [state, setState] = useState<'checking' | 'paid' | 'pending'>('checking')

  useEffect(() => {
    if (!basket) { setState('pending'); return }
    let tries = 0
    const tick = async () => {
      tries++
      const r = await fetch(`/api/billing/paypal/status?basket=${basket}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => ({}))
      if (r?.status === 'paid') { setState('paid'); return }
      if (tries >= 8) { setState('pending'); return }
      setTimeout(tick, 1500)   // give the webhook/capture a moment to land
    }
    tick()
  }, [basket])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter',-apple-system,sans-serif", background: 'radial-gradient(120% 100% at 50% -10%, #eef8dd, #ffffff)', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>{state === 'paid' ? '🎉' : '⏳'}</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: INK, margin: 0 }}>
          {state === 'paid' ? 'Payment confirmed' : state === 'checking' ? 'Confirming your payment…' : 'Payment received'}
        </h1>
        <p style={{ fontSize: 15, color: '#4b5563', lineHeight: 1.65, margin: '12px 0 24px' }}>
          {state === 'paid' ? 'Your credits and plan are active. Mello is ready.'
            : state === 'checking' ? 'One moment while we confirm with PayPal.'
            : 'It can take a minute to reflect. Your balance updates automatically once confirmed.'}
        </p>
        <button onClick={() => router.push('/brief')} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 28px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer' }}>Go to my brief →</button>
      </div>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={null}><Success /></Suspense>
}
