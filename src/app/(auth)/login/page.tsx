'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

const INK = '#0e1b12', ORANGE = '#ef4a1e'

/* ─────────────────────────────────────────────────────────────────────────────
 * TRUST PANEL — EDIT THIS BLOCK. Everything here is a factual claim shown to real
 * users, so it must be TRUE before it goes live.
 *  · BADGES: only set soc2:true once you actually hold the certification.
 *  · RATING: set a real number + real source, or leave rating:null to hide it.
 *  · TESTIMONIALS: these are PLACEHOLDERS — replace with real, approved quotes from
 *    real customers before launch. Do not ship invented reviews as genuine.
 *  · LOGOS: drop files in /public/logos/… and reference them below; a plain text
 *    wordmark shows until a file exists. Only list companies that are actually true.
 * ──────────────────────────────────────────────────────────────────────────── */
const TRUST = {
  video: '/login-bg.mp4',          // drop your background video here (public/login-bg.mp4)
  poster: '/login-bg.jpg',         // optional first-frame image while the video loads
  rating: null as null | { score: string; source: string },   // off (per request)
  soc2: true,                      // SOC 2 badge on
  trustedByLabel: '',              // add once you drop the "trusted by" brand logos below
  trustedLogos: [] as { name: string; src?: string }[],   // e.g. [{ name: 'Kitsch', src: '/logos/kitsch.svg' }]
  builtByLabel: 'Built by engineers from',
  // Real brand logos render once you drop the files (public/logos/…); a clean text wordmark shows until then.
  builtByLogos: [
    { name: 'Meta', src: '/logos/meta.svg' },
    { name: 'TikTok', src: '/logos/tiktok.svg' },
    { name: 'Amazon', src: '/logos/amazon.svg' },
    { name: 'Microsoft', src: '/logos/microsoft.svg' },
  ] as { name: string; src?: string }[],
  testimonials: [
    { quote: 'Selfmade replaced my whole freelance stack. It writes, designs, and ships ads while I sleep — and the morning brief tells me exactly what to approve.', name: 'Sarah M.', role: 'Founder, DTC skincare' },
    { quote: 'It clones a competitor’s winning ad onto my product in minutes. What used to take my agency a week now happens overnight.', name: 'Daniel R.', role: 'Ecommerce owner' },
    { quote: 'The competitor spy is unreal — I wake up already knowing every ad my rivals launched. It’s a growth team that never sleeps.', name: 'Priya K.', role: 'Head of Growth' },
  ] as { quote: string; name: string; role: string }[],
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [ti, setTi] = useState(0)

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  // Rotate testimonials.
  useEffect(() => {
    if (TRUST.testimonials.length < 2) return
    const t = setInterval(() => setTi(i => (i + 1) % TRUST.testimonials.length), 5500)
    return () => clearInterval(t)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) { toast.error(error.message); setLoading(false) }
    else router.push('/brief')
  }
  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
  }

  const t = TRUST.testimonials[ti]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff' }}>
      {/* ── LEFT — video + trust (hidden on narrow) ── */}
      {!narrow && (
        <div style={{ flex: '1 1 52%', position: 'relative', overflow: 'hidden', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '40px 44px' }}>
          {/* video background + legibility scrim */}
          <video autoPlay muted loop playsInline poster={TRUST.poster}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}>
            <source src={TRUST.video} type="video/mp4" />
          </video>
          <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(160deg, rgba(14,27,18,.55) 0%, rgba(14,27,18,.35) 45%, rgba(239,74,30,.35) 100%)' }} />

          {/* top: logo + rating/badge */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0) invert(1)' }} />
            {(TRUST.rating || TRUST.soc2) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {TRUST.rating && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#ffcf4d', fontSize: 15, letterSpacing: 1 }}>★★★★★</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{TRUST.rating.score}</span>
                    <span style={{ fontSize: 12.5, opacity: .8 }}>· {TRUST.rating.source}</span>
                  </div>
                )}
                {TRUST.soc2 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.25)', borderRadius: 100, padding: '4px 12px' }}>
                    <span style={{ fontSize: 12 }}>🛡️</span><span style={{ fontSize: 12.5, fontWeight: 700 }}>SOC 2 certified</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* middle: rotating testimonial */}
          <div style={{ position: 'relative', zIndex: 2, maxWidth: 520 }}>
            {t && (
              <>
                <p style={{ fontSize: 22, lineHeight: 1.4, fontWeight: 600, letterSpacing: '-.01em', margin: 0, textShadow: '0 2px 12px rgba(0,0,0,.35)' }}>“{t.quote}”</p>
                <div style={{ marginTop: 16, fontSize: 14 }}><b>{t.name}</b><span style={{ opacity: .82 }}> — {t.role}</span></div>
                <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
                  {TRUST.testimonials.map((_, i) => (
                    <span key={i} onClick={() => setTi(i)} style={{ width: i === ti ? 22 : 7, height: 7, borderRadius: 6, background: i === ti ? '#fff' : 'rgba(255,255,255,.5)', cursor: 'pointer', transition: 'width .2s' }} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* bottom: logo walls */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {TRUST.trustedByLabel && TRUST.trustedLogos.length > 0 && <LogoRow label={TRUST.trustedByLabel} logos={TRUST.trustedLogos} />}
            {TRUST.builtByLabel && TRUST.builtByLogos.length > 0 && <LogoRow label={TRUST.builtByLabel} logos={TRUST.builtByLogos} />}
          </div>
        </div>
      )}

      {/* ── RIGHT — the login form (auth logic unchanged) ── */}
      <div style={{ flex: narrow ? '1 1 100%' : '1 1 48%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 22px', background: '#fff' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {narrow && (/* eslint-disable-next-line @next/next/no-img-element */
            <img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)', margin: '0 auto 26px', display: 'block' }} />
          )}
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#111', textAlign: 'center', margin: '0 0 26px', letterSpacing: '-.02em' }}>Log in</h1>

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
          <p style={S.legal}>Don&rsquo;t have an account? <Link href="/signup" style={S.link}>Sign up</Link></p>
          <p style={{ ...S.legal, marginTop: 6 }}>By logging in, you agree to our <Link href="/terms" style={S.link}>Terms</Link> &amp; <Link href="/privacy" style={S.link}>Privacy Policy</Link></p>
        </div>
      </div>
    </div>
  )
}

// A labelled logo strip. Uses a real image when `src` is set, else a clean text wordmark placeholder.
function LogoRow({ label, logos }: { label: string; logos: { name: string; src?: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', opacity: .7, marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {logos.map(l => l.src
          ? (/* eslint-disable-next-line @next/next/no-img-element */ <img key={l.name} src={l.src} alt={l.name} style={{ height: 22, opacity: .92, filter: 'brightness(0) invert(1)' }} />)
          : <span key={l.name} style={{ fontSize: 14, fontWeight: 800, opacity: .9 }}>{l.name}</span>)}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
}

const S: Record<string, React.CSSProperties> = {
  google: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff', border: '1px solid #dcdfdc', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 700, color: '#111', cursor: 'pointer', fontFamily: 'inherit' },
  divider: { display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' },
  line: { flex: 1, height: 1, background: '#ececec' },
  or: { fontSize: 12.5, color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 },
  input: { width: '100%', padding: '12px 13px', border: '1px solid #d7dbd7', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', color: '#111', outline: 'none', background: '#fbfcfb', boxSizing: 'border-box' },
  eye: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 },
  submit: { width: '100%', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
  forgot: { display: 'block', textAlign: 'center', marginTop: 18, fontSize: 14, color: '#374151', fontWeight: 600, textDecoration: 'none' },
  legal: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 22 },
  link: { color: INK, fontWeight: 700, textDecoration: 'underline' },
}
