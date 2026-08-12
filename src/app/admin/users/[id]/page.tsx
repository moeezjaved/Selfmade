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
  follows: { page_id: string; brand_name: string | null; email_alerts: boolean; created_at: string }[];
  creatives: { id: string; type: string; tier: string; media_type: string | null; status: string | null; prompt: string | null; image_url: string | null; brand_name: string | null; source_ad_id: string | null; created_at: string }[];
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

const money = (n: number, cur: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0)} ${cur}` } }

// Admin view of a user's connected Meta ad accounts + how each is performing (same audit the founder
// sees). Lazy — only fetches when this section mounts, so the user page stays fast.
function MetaAdsSection({ userId }: { userId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`/api/admin/users/${userId}/meta`).then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [userId])

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: 24, marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Facebook Ads {data?.connected ? <span style={{ color: '#1877F2' }}>· {data.accounts.length} account{data.accounts.length === 1 ? '' : 's'}</span> : ''}
      </h3>
      {loading ? <div style={{ fontSize: 13, color: '#aaa' }}>Loading live performance…</div>
        : !data?.connected ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Not connected — this user hasn&rsquo;t linked a Facebook ad account.</div>
        : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(data.performance || []).map((p: any) => (
            <div key={p.accountId} style={{ border: '1px solid #eef0ee', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#111', fontSize: 14 }}>{p.name}</span>
                {p.isPrimary && <span style={{ fontSize: 10, fontWeight: 800, color: '#1877F2', background: '#1877F218', borderRadius: 20, padding: '2px 8px' }}>PRIMARY</span>}
                <span style={{ fontSize: 11, color: '#9ca3af' }}>{p.currency}</span>
              </div>
              {p.error ? <div style={{ fontSize: 12, color: '#dc2626' }}>Couldn&rsquo;t load: {p.error}</div> : (<>
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
                  {[['Spend · 30d', money(p.spend, p.currency)], ['Spent today', money(p.spendToday, p.currency)], ['Avg ROAS', `${p.avgRoas}x`], ['Campaigns', p.campaigns], ['Scale/Watch/Pause', `${p.counts?.scale || 0} / ${p.counts?.watch || 0} / ${p.counts?.pause || 0}`]].map(([k, v]) => (
                    <div key={String(k)}><div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{v as any}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>{k as any}</div></div>
                  ))}
                </div>
                {(p.topAds || []).length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ color: '#9ca3af', textAlign: 'left' }}>
                        {['Ad', 'Campaign', 'Spend', 'ROAS', 'CTR', 'Impr.', 'Clicks'].map(h => <th key={h} style={{ padding: '4px 8px', fontWeight: 700 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {p.topAds.map((a: any, i: number) => (
                          <tr key={i} style={{ borderTop: '1px solid #f2f4f2' }}>
                            <td style={{ padding: '5px 8px', color: '#111', fontWeight: 600 }}>{a.name}</td>
                            <td style={{ padding: '5px 8px', color: '#555' }}>{a.campaignName || '—'}</td>
                            <td style={{ padding: '5px 8px' }}>{money(a.spend, p.currency)}</td>
                            <td style={{ padding: '5px 8px', color: a.roas >= 1 ? '#16a34a' : '#111' }}>{a.roas ? a.roas.toFixed(2) + 'x' : '—'}</td>
                            <td style={{ padding: '5px 8px' }}>{a.ctr ? a.ctr.toFixed(2) + '%' : '—'}</td>
                            <td style={{ padding: '5px 8px', color: '#555' }}>{(a.impressions || 0).toLocaleString()}</td>
                            <td style={{ padding: '5px 8px', color: '#555' }}>{(a.clicks || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>)}
            </div>
          ))}
          {/* Accounts with no live audit (disconnected/errored tokens) still get listed. */}
          {(data.accounts || []).filter((a: any) => a.status !== 'active').map((a: any) => (
            <div key={a.accountId} style={{ fontSize: 12, color: '#9ca3af' }}>{a.name} — {a.status}</div>
          ))}
        </div>
      )}
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

      {/* Facebook Ads — connection + live per-account performance (the founder's own numbers). */}
      <MetaAdsSection userId={params.id} />

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

      {/* Followed Brands */}
      {user.follows.length > 0 && (
        <Section title={`Following Brands (${user.follows.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {user.follows.map(f => (
              <div key={f.page_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', background: '#f7f9f7', border: '1px solid #e5e9e5', borderRadius: '20px', fontSize: '13px', color: '#222' }}>
                <span style={{ fontWeight: 600 }}>{f.brand_name || f.page_id}</span>
                {f.email_alerts && <span title="Daily email alerts on" style={{ fontSize: '11px' }}>📧</span>}
                <span style={{ fontSize: '11px', color: '#aaa' }}>{fmt(f.created_at)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Creatives */}
      {user.creatives.length > 0 && (
        <Section title={`AI Creatives (${user.creatives.length})`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px' }}>
            {user.creatives.map(c => (
              <a key={c.id} href={c.image_url || '#'} target="_blank" rel="noreferrer"
                style={{ display: 'block', textDecoration: 'none', border: '1px solid #eee', borderRadius: '10px', overflow: 'hidden', background: '#fafafa' }}>
                <div style={{ position: 'relative', aspectRatio: '1', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.media_type === 'video'
                    ? <video src={c.image_url || ''} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : c.image_url ? <img src={c.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ color: c.status === 'processing' ? '#ff5a2c' : '#666', fontSize: '11px' }}>{c.status === 'processing' ? '⏳ processing' : 'no image'}</span>}
                  <span style={{ position: 'absolute', top: 5, left: 5, background: 'rgba(0,0,0,.65)', color: '#fff', borderRadius: 5, fontSize: 9, fontWeight: 700, padding: '2px 5px', textTransform: 'capitalize' }}>{c.type}</span>
                </div>
                <div style={{ padding: '7px 8px' }}>
                  <div style={{ fontSize: 11.5, color: '#333', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.brand_name || c.prompt || 'Untitled'}</div>
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{fmt(c.created_at)}</div>
                </div>
              </a>
            ))}
          </div>
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
