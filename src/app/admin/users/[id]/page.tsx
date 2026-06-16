'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UserDetail {
  id: string; email: string; full_name: string; subscription_status: string;
  created_at: string; last_sign_in_at: string | null; business_type: string;
  niche: string; experience_level: string; trial_ends_at: string | null;
  ad_plan_clicked: boolean; campaign_launched: boolean; scale_clicked: boolean;
  campaigns_count: number;
  campaigns: { id: string; name: string; status: string; created_at: string }[];
  errors: { id: string; error_message: string; page_url: string | null; created_at: string }[];
}

const STATUS_COLOR: Record<string, string> = {
  active: '#16a34a', trialing: '#2563eb', canceled: '#dc2626', past_due: '#d97706', incomplete: '#9ca3af',
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Check({ yes }: { yes: boolean }) {
  return <span style={{ fontSize: '15px' }}>{yes ? '✅' : '❌'}</span>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', padding: '24px', marginBottom: '20px' }}>
      <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#111', margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
      <span style={{ fontSize: '13px', color: '#888' }}>{label}</span>
      <span style={{ fontSize: '13px', color: '#111', fontWeight: '500' }}>{value}</span>
    </div>
  )
}

export default function UserProfile({ params }: { params: { id: string } }) {
  const [user, setUser] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const [extending, setExtending] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/users/${params.id}`)
      .then(r => r.json())
      .then(d => { setUser(d); setLoading(false) })
  }, [params.id])

  async function extendTrial(days: number) {
    if (!days || days < 1) return
    setExtending(true)
    try {
      const res = await fetch(`/api/admin/users/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extend_trial', days }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      // refresh user data
      const fresh = await fetch(`/api/admin/users/${params.id}`).then(r => r.json())
      setUser(fresh)
      alert(`✅ Trial extended by ${days} days — now ends ${new Date(j.trial_ends_at).toLocaleDateString()}`)
    } catch (e: any) {
      alert(`Failed to extend trial: ${e.message}`)
    } finally {
      setExtending(false)
    }
  }

  if (loading) return <div style={{ color: '#aaa', fontSize: '14px' }}>Loading…</div>
  if (!user) return <div style={{ color: '#ef4444' }}>User not found</div>

  return (
    <div>
      <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#888', fontSize: '13px', cursor: 'pointer', padding: '0 0 20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        ← Back to Users
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '700', fontSize: '18px' }}>
          {(user.full_name || user.email || 'U')[0].toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#111', margin: 0 }}>{user.full_name || user.email}</h1>
          <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{user.email}</div>
        </div>
        <span style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', background: `${STATUS_COLOR[user.subscription_status] || '#9ca3af'}18`, color: STATUS_COLOR[user.subscription_status] || '#9ca3af', textTransform: 'capitalize' }}>
          {user.subscription_status}
        </span>
      </div>

      {/* Extend trial */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#111' }}>Extend Trial</div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Currently ends {fmt(user.trial_ends_at)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {[7, 14, 30].map(d => (
            <button key={d} disabled={extending} onClick={() => extendTrial(d)}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #d1d5db', background: extending ? '#f3f4f6' : '#fff', color: '#111', fontSize: '13px', fontWeight: '600', cursor: extending ? 'not-allowed' : 'pointer' }}>
              +{d} days
            </button>
          ))}
          <button disabled={extending} onClick={() => { const v = prompt('Extend trial by how many days?', '60'); const n = v ? parseInt(v, 10) : 0; if (n > 0) extendTrial(n) }}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #2563eb', background: extending ? '#f3f4f6' : '#2563eb', color: extending ? '#9ca3af' : '#fff', fontSize: '13px', fontWeight: '600', cursor: extending ? 'not-allowed' : 'pointer' }}>
            {extending ? 'Extending…' : 'Custom…'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Account Info */}
        <Section title="Account Info">
          <Row label="Email" value={user.email} />
          <Row label="Plan" value={<span style={{ textTransform: 'capitalize' }}>{user.subscription_status}</span>} />
          <Row label="Signup Date" value={fmt(user.created_at)} />
          <Row label="Last Login" value={fmt(user.last_sign_in_at)} />
          <Row label="Trial Ends" value={fmt(user.trial_ends_at)} />
          <Row label="Business Type" value={user.business_type || '—'} />
          <Row label="Niche" value={user.niche || '—'} />
          <Row label="Experience" value={user.experience_level || '—'} />
        </Section>

        {/* Funnel Progress */}
        <Section title="Funnel Progress">
          <Row label="Signed Up" value={<Check yes={true} />} />
          <Row label="Clicked Ad Plan (M4)" value={<Check yes={user.ad_plan_clicked} />} />
          <Row label="Launched Campaign" value={<Check yes={user.campaign_launched} />} />
          <Row label="Clicked Scale" value={<Check yes={user.scale_clicked} />} />
          <Row label="Campaigns Created" value={user.campaigns_count} />
        </Section>
      </div>

      {/* Campaigns */}
      {user.campaigns.length > 0 && (
        <Section title={`Campaigns (${user.campaigns.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                {['Name', 'Status', 'Created'].map(h => (
                  <th key={h} style={{ padding: '6px 0', textAlign: 'left', color: '#999', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {user.campaigns.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f8f8f8' }}>
                  <td style={{ padding: '10px 0', color: '#333' }}>{c.name}</td>
                  <td style={{ padding: '10px 0' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600', background: c.status === 'ACTIVE' ? '#dcfce7' : '#f5f5f5', color: c.status === 'ACTIVE' ? '#16a34a' : '#777' }}>{c.status}</span>
                  </td>
                  <td style={{ padding: '10px 0', color: '#888' }}>{fmt(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Error Logs */}
      {user.errors.length > 0 && (
        <Section title={`Error Logs (${user.errors.length})`}>
          {user.errors.map(err => (
            <div key={err.id} style={{ padding: '12px', background: '#fff5f5', borderRadius: '8px', marginBottom: '8px', border: '1px solid #fecaca' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#dc2626', marginBottom: '4px' }}>{err.error_message}</div>
              <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', gap: '16px' }}>
                <span>{err.page_url || '—'}</span>
                <span>{fmt(err.created_at)}</span>
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}
