'use client'
/**
 * /team — manage your organization: members, roles, invites, seat usage. One shared workspace.
 * Invite/remove gated to owner|admin (server-enforced); non-managers see a read-only roster.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#0e1b12', LIME = '#dffe95'
type Member = { id: string; email: string; role: string; isYou: boolean }
type Invite = { id: string; email: string; role: string; link: string }
type Data = { org: { name: string; role: string }; members: Member[]; invites: Invite[]; seats: { used: number; limit: number; planId: string } }

export default function TeamPage() {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [email, setEmail] = useState(''); const [role, setRole] = useState('member')
  const [msg, setMsg] = useState(''); const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/account/team')
      const j = await r.json().catch(() => ({}))
      if (r.ok && !j.error) { setD(j); setErr('') }
      else setErr(j.error || `Failed to load team (HTTP ${r.status})`)
    } catch (e: any) { setErr(e?.message || 'Network error') }
  }, [])
  useEffect(() => { load() }, [load])

  const invite = async () => {
    setMsg('')
    const j = await fetch('/api/account/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, role }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (j.error) { setMsg(j.error); return }
    setEmail('')
    setMsg(j.emailed ? '✓ Invite sent — we emailed them (link also below)'
      : !j.emailEnabled ? '✓ Invite created. Email isn’t configured (set RESEND_API_KEY) — copy the link below to share.'
      : '✓ Invite created, but the email didn’t send (Resend rejected — likely the from-domain isn’t verified). Copy the link below.')
    load()
  }
  const revoke = async (id: string) => { await fetch(`/api/account/team?invite=${id}`, { method: 'DELETE' }); load() }
  const remove = async (id: string) => { if (confirm('Remove this member?')) { await fetch(`/api/account/team?member=${id}`, { method: 'DELETE' }); load() } }
  const copy = (t: string, tag: string) => { navigator.clipboard.writeText(t); setCopied(tag); setTimeout(() => setCopied(''), 1500) }

  if (err) return <div style={{ padding: 28, fontFamily: "'Inter',sans-serif" }}><div style={{ color: '#dc2626', fontWeight: 700, marginBottom: 6 }}>Couldn’t load your team</div><div style={{ color: '#6b7280', fontSize: 14 }}>{err}</div><button onClick={() => { setErr(''); load() }} style={{ marginTop: 12, background: '#0e1b12', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 100, fontWeight: 800, cursor: 'pointer' }}>Retry</button></div>
  if (!d) return <div style={{ padding: 28, color: '#6b7280', fontFamily: "'Inter',sans-serif" }}>Loading team…</div>
  const canManage = d.org.role === 'owner' || d.org.role === 'admin'
  const seatsLeft = Math.max(0, d.seats.limit - d.seats.used)
  const inp: React.CSSProperties = { padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", maxWidth: 780, margin: '0 auto', padding: '28px 24px', color: INK }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px' }}>{d.org.name}</h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: '0 0 20px' }}>One shared workspace — your team shares discovery, saved ads, boards, and Studio. You're the <b>{d.org.role}</b>.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fbfdfa', border: '1px solid #eef0ee', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ fontSize: 26, fontWeight: 800 }}>{d.seats.used}<span style={{ color: '#9ca3af', fontWeight: 600 }}>/{d.seats.limit}</span></div>
        <div style={{ fontSize: 13.5, color: '#6b7280' }}>seats used ({seatsLeft} left on {d.seats.planId})</div>
      </div>

      {canManage && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Invite a teammate</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={{ ...inp, flex: 1, minWidth: 200 }} value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com" type="email" />
            <select style={inp} value={role} onChange={e => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select>
            <button onClick={invite} disabled={seatsLeft <= 0} style={{ background: seatsLeft > 0 ? INK : '#9ca3af', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: seatsLeft > 0 ? 'pointer' : 'not-allowed' }}>Invite</button>
          </div>
          {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.startsWith('✓') ? '#16a34a' : '#dc2626', marginTop: 8 }}>{msg}</div>}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Members</div>
      {d.members.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', border: '1px solid #eef0ee', borderRadius: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{m.email}{m.isYou ? ' (you)' : ''}</div>
          <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: m.role === 'owner' ? '#dcfce7' : m.role === 'admin' ? '#dbeafe' : '#f3f4f6', color: m.role === 'owner' ? '#166534' : m.role === 'admin' ? '#1e40af' : '#374151', textTransform: 'capitalize' }}>{m.role}</span>
          {canManage && m.role !== 'owner' && !m.isYou && <button onClick={() => remove(m.id)} style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Remove</button>}
        </div>
      ))}

      {d.invites.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', margin: '20px 0 10px' }}>Pending invites</div>
          {d.invites.map(i => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', border: '1px dashed #e5e7eb', borderRadius: 10, marginBottom: 8, background: '#fcfdfb' }}>
              <div style={{ flex: 1, fontSize: 14 }}>{i.email} <span style={{ color: '#9ca3af', textTransform: 'capitalize' }}>· {i.role}</span></div>
              <span onClick={() => copy(i.link, i.id)} style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === i.id ? 'copied ✓' : 'copy invite link'}</span>
              {canManage && <button onClick={() => revoke(i.id)} style={{ background: 'none', border: '1px solid #e5e7eb', color: '#6b7280', padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Revoke</button>}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
