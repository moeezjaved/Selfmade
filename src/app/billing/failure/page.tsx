'use client'
import { Suspense } from 'react'
import { useRouter } from 'next/navigation'

const INK = '#0e1b12', LIME = '#dffe95'

function Failure() {
  const router = useRouter()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter',-apple-system,sans-serif", background: '#fff', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>😕</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: INK, margin: 0 }}>Payment didn’t go through</h1>
        <p style={{ fontSize: 15, color: '#4b5563', lineHeight: 1.65, margin: '12px 0 24px' }}>
          No charge was made. You can try again, or use a different card.
        </p>
        <button onClick={() => router.push('/pricing')} style={{ background: INK, color: LIME, border: 'none', borderRadius: 100, padding: '13px 28px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer' }}>Back to pricing →</button>
      </div>
    </div>
  )
}

export default function Page() {
  return <Suspense fallback={null}><Failure /></Suspense>
}
