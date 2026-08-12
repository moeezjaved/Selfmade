'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

const LIME = '#ff5a2c', INK = '#0e1b12'

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    // Always show the same confirmation (don't reveal whether an account exists).
    if (error && !/rate limit/i.test(error.message)) toast.error(error.message)
    setSent(true)
  }

  return (
    <div style={S.page}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Selfmade" style={{ height: 34, filter: 'brightness(0)', margin: '0 auto 28px', display: 'block' }} />
      <div style={S.card}>
        <h1 style={S.h1}>Reset your password</h1>
        {sent ? (
          <>
            <p style={{ fontSize: 14.5, color: '#374151', lineHeight: 1.6, textAlign: 'center' }}>
              If an account exists for <b>{email.trim()}</b>, we’ve sent a password-reset link. Check your inbox (and spam) and follow the link to set a new password.
            </p>
            <Link href="/login" style={{ ...S.submit, display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 20 }}>Back to log in</Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, textAlign: 'center', margin: '0 0 22px' }}>
              Enter your email and we’ll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={S.input} />
              </div>
              <button type="submit" disabled={loading} style={{ ...S.submit, opacity: loading ? .7 : 1 }}>{loading ? 'Sending…' : 'Send reset link'}</button>
            </form>
            <Link href="/login" style={S.forgot}>Back to log in</Link>
          </>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', -apple-system, sans-serif" },
  card: { width: '100%', maxWidth: 440, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '38px 34px' },
  h1: { fontSize: 24, fontWeight: 800, color: '#111', textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 },
  input: { width: '100%', padding: '12px 13px', border: '1px solid #d7dbd7', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', color: '#111', outline: 'none', background: '#fbfcfb', boxSizing: 'border-box' },
  submit: { width: '100%', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
  forgot: { display: 'block', textAlign: 'center', marginTop: 18, fontSize: 14, color: '#374151', fontWeight: 600, textDecoration: 'none' },
}
