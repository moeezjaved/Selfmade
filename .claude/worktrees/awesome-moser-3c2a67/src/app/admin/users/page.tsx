'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface User {
  id: string; email: string; full_name: string; subscription_status: string;
  created_at: string; last_sign_in_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: '#16a34a', trialing: '#2563eb', canceled: '#dc2626', past_due: '#d97706', incomplete: '#9ca3af',
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/users?search=${encodeURIComponent(search)}`)
      .then(r => r.json())
      .then(d => { setUsers(d.users || []); setLoading(false) })
  }, [search])

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111', margin: '0 0 6px' }}>Users</h1>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px' }}>{users.length} users</p>

      <input
        placeholder="Search by name or email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '320px', padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '13px', outline: 'none', marginBottom: '20px', boxSizing: 'border-box' }}
      />

      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
              {['Name', 'Email', 'Plan', 'Signup Date', 'Last Active'].map(h => (
                <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontWeight: '600', color: '#888', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#aaa' }}>Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#aaa' }}>No users found</td></tr>
            ) : users.map(u => (
              <tr
                key={u.id}
                onClick={() => router.push(`/admin/users/${u.id}`)}
                style={{ borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '12px 16px', fontWeight: '500', color: '#111' }}>{u.full_name || '—'}</td>
                <td style={{ padding: '12px 16px', color: '#555' }}>{u.email}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600', background: `${STATUS_COLOR[u.subscription_status] || '#9ca3af'}18`, color: STATUS_COLOR[u.subscription_status] || '#9ca3af', textTransform: 'capitalize' }}>
                    {u.subscription_status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', color: '#777' }}>{fmt(u.created_at)}</td>
                <td style={{ padding: '12px 16px', color: '#777' }}>{fmt(u.last_sign_in_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
