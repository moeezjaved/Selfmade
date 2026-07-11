'use client'
/**
 * /team — manage your organization: members, roles, invites, seat usage. One shared workspace.
 * Invite/remove gated to owner|admin (server-enforced); non-managers see a read-only roster.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#0e1b12', LIME = '#dffe95'
type Member = { id: string; user_id: string; email: string; role: string; isYou: boolean; accounts: string[] | null; allAccounts: boolean }
type Invite = { id: string; email: string; role: string; link: string }
type Account = { account_id: string; account_name: string | null }
type Data = { org: { name: string; role: string }; members: Member[]; invites: Invite[]; seats: { used: number; limit: number; planId: string; included: number; extra: number }; accountPool: Account[] }

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
  const [acctFor, setAcctFor] = useState<string | null>(null)   // user_id whose account editor is open
  const [acctSel, setAcctSel] = useState<string[]>([])          // working selection (empty = all)
  const [seatModal, setSeatModal] = useState(false)             // in-app seats modal (replaces window.prompt)
  const [seatCount, setSeatCount] = useState('1')
  const [seatBusy, setSeatBusy] = useState(false)
  const openAccts = (m: Member) => { setAcctFor(m.user_id); setAcctSel(m.allAccounts ? [] : (m.accounts || [])) }
  const toggleAcct = (id: string) => setAcctSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const saveAccts = async (userId: string) => {
    await fetch('/api/account/team', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, accountIds: acctSel }) })
    setAcctFor(null); load()
  }
  // Open the in-app seats modal (was a browser window.prompt — feels broken + can't style/validate).
  const buySeats = () => { setSeatCount(String((d?.seats.extra ?? 0) + 1)); setMsg(''); setSeatModal(true) }
  const confirmSeats = async () => {
    const extra = Math.max(0, Math.floor(Number(seatCount)))
    if (!Number.isFinite(extra)) { setMsg('Enter a valid number of seats.'); return }
    setSeatBusy(true); setMsg('Setting up seats…')
    const j = await fetch('/api/billing/seats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extra }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (j.url) { window.location.href = j.url; return }        // first purchase → Stripe Checkout
    setSeatBusy(false); setSeatModal(false)
    // Never surface internal error strings (e.g. the "Set STRIPE_PRICE_SEAT…" env hint) to users.
    if (j.error) { setMsg(j.error === 'not_configured' ? 'Extra paid seats aren’t available yet — email hello@tryselfmade.ai and we’ll add them for you.' : (j.message || 'Couldn’t update seats. Please try again.')); return }
    setMsg(`✓ Seats updated — ${j.extra} paid seat${j.extra === 1 ? '' : 's'}.`); load()
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
        <div style={{ flex: 1, fontSize: 13.5, color: '#6b7280' }}>
          seats used ({seatsLeft} left on {d.seats.planId})
          {d.seats.extra > 0 && <span style={{ color: '#166534' }}> · {d.seats.included} plan + {d.seats.extra} paid</span>}
        </div>
        {canManage && (d.seats.planId === 'free'
          ? <a href="/pricing" style={{ background: INK, color: '#fff', padding: '8px 16px', borderRadius: 100, fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>Upgrade plan</a>
          : <button onClick={buySeats} style={{ background: seatsLeft <= 0 ? INK : 'none', color: seatsLeft <= 0 ? '#fff' : INK, border: seatsLeft <= 0 ? 'none' : `1px solid ${INK}`, padding: '8px 16px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{d.seats.extra > 0 ? 'Manage seats' : '+ Add seats'}</button>)}
      </div>

      {canManage && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Invite a teammate</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={{ ...inp, flex: 1, minWidth: 200 }} value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com" type="email" />
            <select style={inp} value={role} onChange={e => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select>
            <button onClick={invite} disabled={seatsLeft <= 0} style={{ background: seatsLeft > 0 ? INK : '#9ca3af', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: seatsLeft > 0 ? 'pointer' : 'not-allowed' }}>Invite</button>
          </div>
          {seatsLeft <= 0 && d.seats.planId === 'free' && (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginTop: 8 }}>
              You’ve used your 1 seat on the Free plan. <a href="/pricing" style={{ color: INK, fontWeight: 800, textDecoration: 'underline' }}>Upgrade your plan</a> to invite teammates.
            </div>
          )}
          {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.startsWith('✓') ? '#16a34a' : '#dc2626', marginTop: 8 }}>{msg}</div>}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Members</div>
      {d.members.map(m => {
        // Account scoping applies only to plain members (owner/admin always see all), and only when
        // the org actually has connected accounts to divvy up.
        const scopable = m.role === 'member' && d.accountPool.length > 0
        const acctLabel = m.allAccounts ? 'All accounts' : `${m.accounts?.length || 0} of ${d.accountPool.length}`
        const editing = acctFor === m.user_id
        return (
        <div key={m.id} style={{ border: '1px solid #eef0ee', borderRadius: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px' }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{m.email}{m.isYou ? ' (you)' : ''}</div>
            {scopable && <span title="Ad accounts this member can see" style={{ fontSize: 11.5, fontWeight: 700, color: m.allAccounts ? '#6b7280' : '#1e40af', background: m.allAccounts ? '#f3f4f6' : '#dbeafe', padding: '2px 9px', borderRadius: 20 }}>📊 {acctLabel}</span>}
            <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: m.role === 'owner' ? '#dcfce7' : m.role === 'admin' ? '#dbeafe' : '#f3f4f6', color: m.role === 'owner' ? '#166534' : m.role === 'admin' ? '#1e40af' : '#374151', textTransform: 'capitalize' }}>{m.role}</span>
            {canManage && scopable && <button onClick={() => editing ? setAcctFor(null) : openAccts(m)} style={{ background: 'none', border: '1px solid #d1d5db', color: '#374151', padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{editing ? 'Close' : 'Accounts'}</button>}
            {canManage && m.role !== 'owner' && !m.isYou && <button onClick={() => remove(m.id)} style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Remove</button>}
          </div>
          {editing && (
            <div style={{ borderTop: '1px solid #eef0ee', padding: '12px 14px', background: '#fbfdfa' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Pick the Meta ad accounts this member can see in Insights, Reports & Campaigns. <b>Leave all unchecked = access to every account.</b></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {d.accountPool.map(a => (
                  <label key={a.account_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={acctSel.includes(a.account_id)} onChange={() => toggleAcct(a.account_id)} />
                    {a.account_name || a.account_id} <span style={{ color: '#9ca3af', fontSize: 12 }}>({a.account_id})</span>
                  </label>
                ))}
              </div>
              <button onClick={() => saveAccts(m.user_id)} style={{ background: INK, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Save access</button>
              <span style={{ marginLeft: 10, fontSize: 12, color: '#9ca3af' }}>{acctSel.length === 0 ? 'All accounts' : `${acctSel.length} selected`}</span>
            </div>
          )}
        </div>
      )})}

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

      {/* In-app "Add paid seats" modal (replaces the old window.prompt). */}
      {seatModal && (
        <div onClick={() => !seatBusy && setSeatModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,18,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(420px,96vw)', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: INK }}>Add paid seats</div>
            <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
              Your <b style={{ color: INK }}>{d.seats.planId}</b> plan includes {d.seats.included} seat{d.seats.included === 1 ? '' : 's'}
              {d.seats.extra > 0 ? ` (+${d.seats.extra} paid)` : ''}. Each extra seat is billed monthly beyond your plan.
            </div>
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>Total paid extra seats</label>
              <input type="number" min={0} value={seatCount} autoFocus
                onChange={e => setSeatCount(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmSeats() }}
                style={{ ...inp, width: '100%', marginTop: 6, boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button onClick={() => setSeatModal(false)} disabled={seatBusy} style={{ background: 'none', border: '1px solid #e5e7eb', color: '#374151', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={confirmSeats} disabled={seatBusy} style={{ background: INK, color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: seatBusy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: seatBusy ? 0.7 : 1 }}>{seatBusy ? 'Working…' : 'Continue'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
