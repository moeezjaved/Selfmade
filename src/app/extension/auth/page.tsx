/**
 * Chrome-extension SSO handshake — SERVER component (no client hydration needed). The extension
 * opens this via chrome.identity.launchWebAuthFlow with ?redirect_uri=https://<extid>.chromiumapp.org/.
 *
 * Why server-rendered with a native <form>: this page has to work even when a user's OTHER browser
 * extensions sabotage React hydration (a documented issue on this site — injectors calling
 * attachShadow break the client runtime, so a 'use client' page would freeze on a spinner). A plain
 * server page + native form submit needs zero client JS: the button POSTs to /api/extension/connect,
 * which mints the token and 303-redirects to <redirect_uri>#token=… for Chrome to capture.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const LIME = '#ff5a2c', INK = '#0e1b12'

export default async function ExtensionAuthPage({
  searchParams,
}: { searchParams: { redirect_uri?: string } }) {
  const redirectUri = searchParams.redirect_uri || ''

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const next = `/extension/auth${redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : ''}`
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)', margin: '0 auto 20px', display: 'block' }} />
        <div style={S.badge}>🧩</div>
        <h1 style={S.h1}>Connect the Selfmade extension</h1>
        <p style={S.sub}>Signed in as <b>{user!.email}</b>. Connect the extension so the “Save” buttons drop ads straight into your boards.</p>
        <form action="/api/extension/connect" method="POST">
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <button type="submit" style={S.btn}>Connect extension</button>
        </form>
        <p style={S.fine}>You can revoke this anytime from Settings.</p>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Inter',-apple-system,sans-serif" },
  card: { width: '100%', maxWidth: 420, background: '#fff', border: '1px solid #ececec', borderRadius: 20, boxShadow: '0 10px 40px rgba(14,27,18,.06)', padding: '32px 30px', textAlign: 'center' },
  badge: { width: 54, height: 54, borderRadius: 15, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 27 },
  h1: { fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 8px' },
  sub: { fontSize: 14, color: '#4b5563', lineHeight: 1.6, margin: '0 0 20px' },
  btn: { width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' },
  fine: { fontSize: 12, color: '#9ca3af', margin: '14px 0 0' },
}
