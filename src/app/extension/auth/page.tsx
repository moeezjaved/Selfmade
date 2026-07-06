'use client'
/**
 * Chrome-extension SSO handshake. The extension opens this via chrome.identity.launchWebAuthFlow
 * with ?redirect_uri=https://<extid>.chromiumapp.org/. Flow:
 *   • not signed in  → bounce to /login?next=<this page> (comes right back after login)
 *   • signed in      → "Connect" → POST /api/extension/token → redirect to
 *                      <redirect_uri>#token=…&email=…  which Chrome captures and hands to the extension.
 * If opened without a redirect_uri (e.g. a human clicked the link) we still mint the token and show
 * it to copy manually — a graceful fallback.
 */
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const LIME = '#dffe95', INK = '#0e1b12'

function Inner() {
  const params = useSearchParams()
  const redirectUri = params.get('redirect_uri') || ''
  const supabase = createClient()
  const [state, setState] = useState<'loading' | 'anon' | 'ready' | 'connecting' | 'done' | 'error'>('loading')
  const [email, setEmail] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { setState('anon'); return }
      setEmail(session.user.email || '')
      setState('ready')
    })
  }, [])

  const signIn = () => {
    const next = `/extension/auth${redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : ''}`
    window.location.href = `/login?next=${encodeURIComponent(next)}`
  }

  const connect = async () => {
    setState('connecting'); setErr('')
    try {
      const r = await fetch('/api/extension/token', { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j.token) throw new Error(j.error || 'Could not create a token')
      if (redirectUri) {
        // Hand the token back to the extension (Chrome captures this redirect).
        window.location.href = `${redirectUri}#token=${encodeURIComponent(j.token)}&email=${encodeURIComponent(j.email || '')}`
        setState('done')
      } else {
        setManualToken(j.token); setState('done')
      }
    } catch (e: any) { setErr(e.message || 'Something went wrong'); setState('error') }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)', margin: '0 auto 20px', display: 'block' }} />
        <div style={{ width: 54, height: 54, borderRadius: 15, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 27 }}>🧩</div>
        <h1 style={S.h1}>Connect the Selfmade extension</h1>

        {state === 'loading' && <p style={S.sub}>Checking your account…</p>}

        {state === 'anon' && (
          <>
            <p style={S.sub}>Sign in to link the browser extension to your Selfmade account.</p>
            <button onClick={signIn} style={S.btn}>Sign in to Selfmade</button>
          </>
        )}

        {(state === 'ready' || state === 'connecting') && (
          <>
            <p style={S.sub}>Signed in as <b>{email}</b>. Connect the extension so “Save” buttons drop ads straight into your boards.</p>
            <button onClick={connect} disabled={state === 'connecting'} style={{ ...S.btn, opacity: state === 'connecting' ? .6 : 1 }}>
              {state === 'connecting' ? 'Connecting…' : 'Connect extension'}
            </button>
          </>
        )}

        {state === 'done' && !manualToken && (
          <p style={S.sub}>✅ Connected! You can close this tab and head back to Instagram or the Facebook Ad Library.</p>
        )}

        {state === 'done' && manualToken && (
          <>
            <p style={S.sub}>✅ Copy this key into the extension popup:</p>
            <code style={S.code}>{manualToken}</code>
          </>
        )}

        {state === 'error' && (
          <>
            <p style={{ ...S.sub, color: '#c0392b' }}>{err}</p>
            <button onClick={connect} style={S.btn}>Try again</button>
          </>
        )}
      </div>
    </div>
  )
}

export default function ExtensionAuthPage() {
  return <Suspense fallback={null}><Inner /></Suspense>
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Inter',-apple-system,sans-serif" },
  card: { width: '100%', maxWidth: 420, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '32px 30px', textAlign: 'center' },
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 8px' },
  sub: { fontSize: 14, color: '#4b5563', lineHeight: 1.6, margin: '0 0 20px' },
  btn: { width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' },
  code: { display: 'block', wordBreak: 'break-all', background: '#f3f5f2', border: '1px solid #e2e6e0', borderRadius: 10, padding: '12px', fontSize: 12, color: '#243d20', fontFamily: 'monospace' },
}
