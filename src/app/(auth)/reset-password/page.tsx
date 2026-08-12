'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

const LIME = '#ff5a2c', INK = '#0e1b12'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState<boolean | null>(null)   // null = checking the recovery session

  // The reset email link opens this page with a recovery token; the supabase client turns it into a
  // session. Confirm we actually have one so we don't show the form to someone who landed here directly.
  useEffect(() => {
    let cancelled = false
    const onRecovery = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) setReady(!!data.session) })
    return () => { cancelled = true; onRecovery.data.subscription.unsubscribe() }
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { toast.error('Password must be at least 8 characters.'); return }
    if (password !== confirm) { toast.error('Passwords don’t match.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { toast.error(error.message); return }
    toast.success('Password updated — you’re logged in.')
    router.push('/dashboard')
  }

  return (
    <div style={S.page}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Selfmade" style={{ height: 34, filter: 'brightness(0)', margin: '0 auto 28px', display: 'block' }} />
      <div style={S.card}>
        <h1 style={S.h1}>Set a new password</h1>
        {ready === false ? (
          <>
            <p style={{ fontSize: 14.5, color: '#374151', lineHeight: 1.6, textAlign: 'center' }}>
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <Link href="/forgot-password" style={{ ...S.submit, display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 20 }}>Request a new link</Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>
            <div>
              <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> New password</label>
              <div style={{ position: 'relative' }}>
                <input type={show ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" style={S.input} />
                <button type="button" onClick={() => setShow(s => !s)} style={S.eye} aria-label="Toggle password">{show ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div>
              <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> Confirm password</label>
              <input type={show ? 'text' : 'password'} required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter your password" style={S.input} />
            </div>
            <button type="submit" disabled={loading || ready !== true} style={{ ...S.submit, opacity: (loading || ready !== true) ? .7 : 1 }}>{loading ? 'Updating…' : ready === null ? 'Verifying link…' : 'Update password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', -apple-system, sans-serif" },
  card: { width: '100%', maxWidth: 440, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '38px 34px' },
  h1: { fontSize: 24, fontWeight: 800, color: '#111', textAlign: 'center', margin: 0, letterSpacing: '-.02em' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 },
  input: { width: '100%', padding: '12px 13px', border: '1px solid #d7dbd7', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', color: '#111', outline: 'none', background: '#fbfcfb', boxSizing: 'border-box' },
  eye: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 },
  submit: { width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
}
