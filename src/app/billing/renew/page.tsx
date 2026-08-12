'use client'
/** /billing/renew — the one-tap re-pay target from the renewal email. Reads the user's current plan
 *  and sends them to the PayPal card checkout for it. If we can't tell the plan, sends to pricing. */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const INK = '#0e1b12', LIME = '#ff5a2c'

export default function RenewPage() {
  const router = useRouter()
  const [msg, setMsg] = useState('Preparing your renewal…')

  useEffect(() => {
    (async () => {
      try {
        const bal = await fetch('/api/credits/balance', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
        const plan = bal?.plan && bal.plan !== 'free' ? bal.plan : 'starter'
        window.location.href = `/billing/card?kind=subscription&plan=${encodeURIComponent(plan)}&cycle=monthly`
      } catch { router.push('/pricing') }
    })()
  }, [router])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter',-apple-system,sans-serif", background: 'radial-gradient(120% 100% at 50% -10%, #eef8dd, #ffffff)', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔄</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: INK, letterSpacing: '-.02em', margin: 0 }}>Renewing your plan</h1>
        <p style={{ fontSize: 15, color: '#4b5563', margin: '12px 0 20px' }}>{msg}</p>
        <button onClick={() => router.push('/pricing')} style={{ background: INK, color: LIME, border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Choose a plan instead →</button>
      </div>
    </div>
  )
}
