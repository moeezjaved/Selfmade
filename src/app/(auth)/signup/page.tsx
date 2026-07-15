'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { isFreeEmail, emailDomain } from '@/lib/email-domains'
import BusinessEmailModal from '@/components/BusinessEmailModal'
import toast from 'react-hot-toast'

const LIME = '#dffe95', INK = '#0e1b12'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' })
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bizModal, setBizModal] = useState<string | null>(null)   // email → show business-email popup
  const [verifySent, setVerifySent] = useState(false)             // 'Confirm email' on → show check-inbox screen

  // A blocked Google sign-in (personal email) bounces here with ?error=business_email — pop the modal.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('error') === 'business_email') setBizModal(p.get('email') || '')
  }, [])

  const emailErr = form.email && !emailDomain(form.email) ? 'Enter a valid email'
    : form.email && isFreeEmail(form.email) ? 'Please use a permanent email — temporary/disposable inboxes aren’t accepted.'
    : ''

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailDomain(form.email)) { toast.error('Enter a valid email'); return }
    if (isFreeEmail(form.email)) { setBizModal(form.email); return }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { full_name: `${form.firstName} ${form.lastName}`.trim() },
        // Where Supabase's verification link lands once 'Confirm email' is enabled (PKCE → our
        // callback exchanges the code + sends the session cookie, then routes to onboarding).
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    })
    if (error) { toast.error(error.message); setLoading(false); return }
    // Fire the welcome email (best-effort, non-blocking).
    fetch('/api/auth/welcome', { method: 'POST' }).catch(() => {})
    // If 'Confirm email' is ON in Supabase, signUp returns NO session → show a check-your-inbox
    // screen instead of pushing into an app the user can't access yet. If OFF (current state),
    // a session is returned → straight to onboarding (unchanged behaviour).
    if (!data.session) { setVerifySent(true); setLoading(false); return }
    router.push('/onboarding')
  }
  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
  }

  if (verifySent) return (
    <div style={S.page}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Selfmade" style={{ height: 34, filter: 'brightness(0)', margin: '0 auto 24px', display: 'block' }} />
      <div style={{ ...S.card, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📬</div>
        <h1 style={S.h1}>Check your inbox</h1>
        <p style={{ ...S.sub, marginBottom: 4 }}>We sent a verification link to</p>
        <p style={{ fontWeight: 800, color: INK, marginBottom: 16 }}>{form.email.trim()}</p>
        <p style={S.sub}>Click it to confirm your email and start remaking ads. Didn&apos;t get it? Check spam, or wait a minute and try again.</p>
        <p style={{ ...S.legal, marginTop: 20 }}>Wrong email? <button onClick={() => setVerifySent(false)} style={{ ...S.link, background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>Go back</button></p>
      </div>
    </div>
  )

  return (
    <div style={S.page}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Selfmade" style={{ height: 34, filter: 'brightness(0)', margin: '0 auto 24px', display: 'block' }} />
      <div style={S.card}>
        <h1 style={S.h1}>Create your account</h1>
        <p style={S.sub}>Free to start — 600 credits, no card.</p>

        <button onClick={handleGoogle} style={S.google}><GoogleIcon /> Continue with Google</button>

        <div style={S.divider}><span style={S.line} /><span style={S.or}>Or sign up with email</span><span style={S.line} /></div>

        <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={S.label}>First name</label>
              <input required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="Alex" style={S.input} />
            </div>
            <div>
              <label style={S.label}>Last name</label>
              <input required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Johnson" style={S.input} />
            </div>
          </div>
          <div>
            <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> Business email</label>
            <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@company.com"
              style={{ ...S.input, borderColor: emailErr ? '#f0a3a3' : '#d7dbd7' }} />
            {emailErr && <div style={S.err}>{emailErr}</div>}
          </div>
          <div>
            <label style={S.label}><span style={{ color: '#e11d48' }}>*</span> Password</label>
            <div style={{ position: 'relative' }}>
              <input type={show ? 'text' : 'password'} required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Min. 8 characters" style={S.input} />
              <button type="button" onClick={() => setShow(s => !s)} style={S.eye} aria-label="Toggle password">{show ? '🙈' : '👁'}</button>
            </div>
          </div>
          <button type="submit" disabled={loading || !!emailErr} style={{ ...S.submit, opacity: (loading || !!emailErr) ? .6 : 1 }}>{loading ? 'Creating account…' : 'Create account'}</button>
        </form>
      </div>
      <p style={S.legal}>Already have an account? <Link href="/login" style={S.link}>Log in</Link></p>
      <p style={{ ...S.legal, marginTop: 6 }}>By signing up, you agree to our <Link href="/terms" style={S.link}>Terms</Link> &amp; <Link href="/privacy" style={S.link}>Privacy Policy</Link></p>
      {bizModal !== null && <BusinessEmailModal email={bizModal} onClose={() => setBizModal(null)} />}
    </div>
  )
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', -apple-system, sans-serif" },
  card: { width: '100%', maxWidth: 460, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '34px 32px' },
  h1: { fontSize: 25, fontWeight: 800, color: '#111', textAlign: 'center', margin: '0 0 6px', letterSpacing: '-.02em' },
  sub: { fontSize: 13.5, color: '#6b7280', textAlign: 'center', margin: '0 0 22px' },
  google: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff', border: '1px solid #dcdfdc', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 700, color: '#111', cursor: 'pointer', fontFamily: 'inherit' },
  divider: { display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' },
  line: { flex: 1, height: 1, background: '#ececec' },
  or: { fontSize: 12.5, color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 },
  input: { width: '100%', padding: '12px 13px', border: '1px solid #d7dbd7', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', color: '#111', outline: 'none', background: '#fbfcfb', boxSizing: 'border-box' },
  err: { fontSize: 12, color: '#c0392b', marginTop: 5 },
  eye: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 },
  submit: { width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
  legal: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 20 },
  link: { color: INK, fontWeight: 700, textDecoration: 'underline' },
}
