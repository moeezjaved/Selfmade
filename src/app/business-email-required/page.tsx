'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const LIME = '#ff5a2c', INK = '#0e1b12'

export default function BusinessEmailRequired() {
  const router = useRouter()
  const supabase = createClient()
  const signOut = async () => { await supabase.auth.signOut(); router.push('/signup') }
  return (
    <div style={{ minHeight: '100vh', background: '#f6f7f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Selfmade" style={{ height: 32, filter: 'brightness(0)', marginBottom: 26 }} />
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '38px 34px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>✉️</div>
        <h1 style={{ fontSize: 23, fontWeight: 800, color: '#111', margin: '0 0 10px', letterSpacing: '-.02em' }}>A business email is required</h1>
        <p style={{ fontSize: 15, color: '#4b5563', lineHeight: 1.6, margin: '0 0 24px' }}>
          Selfmade accounts need a company (work) email — personal addresses like Gmail, Yahoo, or Outlook aren&rsquo;t accepted for new signups. Please sign up again with your business email.
        </p>
        <button onClick={signOut} style={{ width: '100%', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          Sign out &amp; use a work email
        </button>
        <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 16 }}>Think this is a mistake? <a href="mailto:support@tryselfmade.ai" style={{ color: INK, fontWeight: 700 }}>Contact support</a>.</p>
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 20 }}><Link href="/" style={{ color: INK, fontWeight: 700, textDecoration: 'underline' }}>← Back to Selfmade</Link></p>
    </div>
  )
}
