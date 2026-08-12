'use client'
/**
 * /join?token=… — accept a team invite. If logged in, joins the org and lands in the shared workspace.
 * If not, prompts to log in / sign up first (then reopen the link).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const INK = '#0e1b12', LIME = '#ff5a2c'

export default function JoinPage() {
  const [state, setState] = useState<'working' | 'ok' | 'authneeded' | 'error'>('working')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) { setState('error'); setMsg('Missing invite token.'); return }
    fetch('/api/account/team/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async r => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }))
      .then(({ ok, status, j }) => {
        if (ok) { setState('ok'); setMsg(j.org || 'the team'); setTimeout(() => { window.location.href = '/discovery' }, 1600) }
        else if (status === 401) setState('authneeded')
        else { setState('error'); setMsg(j.error || 'Could not accept the invite.') }
      })
      .catch(() => { setState('error'); setMsg('Something went wrong.') })
  }, [])

  const wrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter',sans-serif", background: '#0a0d0c', color: '#f4f7f4', padding: 24 }
  const card: React.CSSProperties = { maxWidth: 440, textAlign: 'center', background: '#121614', border: '1px solid rgba(255,255,255,.08)', borderRadius: 20, padding: '40px 32px' }

  return (
    <div style={wrap}><div style={card}>
      {state === 'working' && <div style={{ fontSize: 17, color: '#9aa39c' }}>Accepting your invite…</div>}
      {state === 'ok' && <>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>You're in 🎉</div>
        <p style={{ color: '#9aa39c', margin: 0 }}>Joined <b style={{ color: LIME }}>{msg}</b>. Taking you to the workspace…</p>
      </>}
      {state === 'authneeded' && <>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Almost there</div>
        <p style={{ color: '#9aa39c', margin: '0 0 20px' }}>Log in or create your account, then reopen this invite link to join the team.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link href="/login" style={{ border: '1px solid rgba(255,255,255,.2)', color: '#f4f7f4', padding: '10px 20px', borderRadius: 100, fontWeight: 800, textDecoration: 'none' }}>Log in</Link>
          <Link href="/signup" style={{ background: LIME, color: '#0a0d0c', padding: '10px 20px', borderRadius: 100, fontWeight: 800, textDecoration: 'none' }}>Sign up</Link>
        </div>
      </>}
      {state === 'error' && <>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Invite problem</div>
        <p style={{ color: '#9aa39c', margin: '0 0 20px' }}>{msg}</p>
        <Link href="/" style={{ color: LIME, textDecoration: 'none', fontWeight: 700 }}>← Back to Selfmade</Link>
      </>}
    </div></div>
  )
}
