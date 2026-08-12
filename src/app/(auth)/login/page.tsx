'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

const LIME = '#ff5a2c', INK = '#0e1b12'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) { toast.error(error.message); setLoading(false) }
    else router.push('/brief')   // land on the Morning Brief (home), not the Ads page with a stale search
  }
  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
  }

  return (
    <div style={S.page}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Selfmade" style={{ height: 34, filter: 'brightness(0)', margin: '0 auto 28px', display: 'block' }} />
      <div style={S.card}>
        <h1 style={S.h1}>Log in</h1>

        <button onClick={handleGoogle} style={S.google}><GoogleIcon /> Continue with Google</button>

        <div style={S.divider}><span style={S.line} /><span style={S.or}>Or log in with email</span><span style={S.line} /></div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={S.input} />
          </div>
          <div>
            <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> Password</label>
            <div style={{ position: 'relative' }}>
              <input type={show ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={S.input} />
              <button type="button" onClick={() => setShow(s => !s)} style={S.eye} aria-label="Toggle password">{show ? '🙈' : '👁'}</button>
            </div>
          </div>
          <button type="submit" disabled={loading} style={{ ...S.submit, opacity: loading ? .7 : 1 }}>{loading ? 'Logging in…' : 'Log in'}</button>
        </form>

        <Link href="/forgot-password" style={S.forgot}>Forgot password?</Link>
      </div>
      <p style={S.legal}>Don&rsquo;t have an account? <Link href="/signup" style={S.link}>Sign up</Link></p>
      <p style={{ ...S.legal, marginTop: 6 }}>By logging in, you agree to our <Link href="/terms" style={S.link}>Terms</Link> &amp; <Link href="/privacy" style={S.link}>Privacy Policy</Link></p>
    </div>
  )
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', -apple-system, sans-serif" },
  card: { width: '100%', maxWidth: 440, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '38px 34px' },
  h1: { fontSize: 26, fontWeight: 800, color: '#111', textAlign: 'center', margin: '0 0 24px', letterSpacing: '-.02em' },
  google: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff', border: '1px solid #dcdfdc', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 700, color: '#111', cursor: 'pointer', fontFamily: 'inherit' },
  divider: { display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' },
  line: { flex: 1, height: 1, background: '#ececec' },
  or: { fontSize: 12.5, color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 },
  input: { width: '100%', padding: '12px 13px', border: '1px solid #d7dbd7', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', color: '#111', outline: 'none', background: '#fbfcfb', boxSizing: 'border-box' },
  eye: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 },
  submit: { width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
  forgot: { display: 'block', textAlign: 'center', marginTop: 18, fontSize: 14, color: '#374151', fontWeight: 600, textDecoration: 'none' },
  legal: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 22 },
  link: { color: INK, fontWeight: 700, textDecoration: 'underline' },
}
