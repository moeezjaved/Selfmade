'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UserDetail {
  id: string; email: string; full_name: string; subscription_status: string; plan?: string; plan_label?: string;
  created_at: string; last_sign_in_at: string | null; last_active_at?: string | null; business_type: string;
  niche: string; experience_level: string; trial_ends_at: string | null;
  ad_plan_clicked: boolean; campaign_launched: boolean; scale_clicked: boolean;
  campaigns_count: number;
  campaigns: { id: string; name: string; status: string; created_at: string }[];
  brands_count?: number;
  brands_created?: { id: string; name: string; brand_type: string | null; created_at: string | null }[];
  errors: { id: string; error_message: string; page_url: string | null; created_at: string }[];
  follows: { page_id: string; brand_name: string | null; email_alerts: boolean; created_at: string }[];
  creatives: { id: string; type: string; tier: string; media_type: string | null; status: string | null; prompt: string | null; image_url: string | null; brand_id: string | null; brand_name: string | null; source_ad_id: string | null; created_at: string }[];
  credit_balance?: number | null;
  logins?: { d7: number; d30: number; total: number; recent: string[] };
  revenue?: { total: number; organic: number; orders: number; currency: string };
  reports?: { id: string; kind: string; title: string; subject: string | null; model: string | null; ad_count: number | null; body_md?: string; created_at: string }[];
  brands_workspace?: BrandWorkspace[];
}

interface BrandWorkspace {
  id: string; name: string; website: string | null; brand_type: string | null; created_at: string | null;
  shopify: { connected: boolean; shop_domain?: string; shop_name?: string | null; status?: string };
  meta: { connected: boolean; accounts?: { name: string; status: string; primary: boolean }[] };
  kb_present: boolean;
  kb_facts: string[];
  voice: { tone?: string; energy?: string; audience?: string } | null;
  market: string | null;
  templates: { title: string; headline: string; concept: string; image: string | null }[];
  products_cached: { title: string; image: string | null; price: string | null; url: string | null }[];
  products_count: number; templates_count: number;
  audiences: { name: string; insights: string[] }[];
  competitors: { name: string; domain: string | null; reason: string; liveAds: any[] }[];
  seo: { catalog_applied: number; catalog_drafts: number; blogs_published: number; blogs_drafts: number; wins: number };
  revenue: { total: number; organic: number; orders: number; currency: string };
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

function Pill({ on, onLabel, offLabel, color }: { on: boolean; onLabel: string; offLabel: string; color: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 10px',
      background: on ? `${color}1a` : '#f3f4f6', color: on ? color : '#9ca3af',
      border: `1px solid ${on ? `${color}44` : '#e5e7eb'}` }}>
      {on ? onLabel : offLabel}
    </span>
  )
}

function SubBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #eceeec' }}>
      <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
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
  const [openReport, setOpenReport] = useState<string | null>(null)

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

      {/* KPI strip — logins (activity), Shopify revenue, credits: the "is this user actually working" glance. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { k: 'Logins · 7d', v: user.logins?.d7 ?? 0 },
          { k: 'Logins · 30d', v: user.logins?.d30 ?? 0 },
          { k: 'Logins · all', v: user.logins?.total ?? 0 },
          { k: 'Shopify revenue', v: user.revenue ? money(user.revenue.total, user.revenue.currency) : '—' },
          { k: 'Orders', v: user.revenue?.orders ?? 0 },
          { k: 'Credits', v: user.credit_balance != null ? user.credit_balance.toLocaleString() : '—' },
        ].map((s) => (
          <div key={s.k} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111' }}>{s.v as any}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.k}</div>
          </div>
        ))}
      </div>
      {user.logins?.recent && user.logins.recent.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '14px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Recent logins</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {user.logins.recent.slice(0, 12).map((t, i) => (
              <span key={i} style={{ fontSize: 11.5, color: '#444', background: '#f5f6f5', border: '1px solid #eceeec', borderRadius: 6, padding: '3px 8px' }}>{fmt(t)}</span>
            ))}
          </div>
        </div>
      )}

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
          {/* The TRUE plan (entitlement), not the raw subscription status. Status is the badge up top. */}
          <Row label="Plan" value={<span style={{ textTransform: 'capitalize', fontWeight: 700 }}>{user.plan_label || user.subscription_status}</span>} />
          <Row label="Billing status" value={<span style={{ textTransform: 'capitalize' }}>{user.subscription_status}</span>} />
          <Row label="Credit balance" value={user.credit_balance != null ? <span style={{ fontWeight: 700 }}>{user.credit_balance.toLocaleString()} cr</span> : '—'} />
          <Row label="Signup Date" value={fmt(user.created_at)} />
          <Row label="Last active" value={fmt(user.last_active_at || user.last_sign_in_at)} />
          <Row label="Last sign-in" value={fmt(user.last_sign_in_at)} />
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
          <Row label="Brands Created" value={user.brands_count ?? 0} />
        </Section>
      </div>

      {/* Per-brand workspace — website, connections, KB, products, templates, audiences, SEO push, revenue. */}
      {(user.brands_workspace?.length ?? 0) > 0 && (
        <Section title={`Workspaces (${user.brands_workspace!.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {user.brands_workspace!.map((b) => (
              <div key={b.id} style={{ border: '1px solid #eef0ee', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>{b.name || 'Untitled brand'}</span>
                  {b.website
                    ? <span onClick={() => router.push(`/admin/site/${encodeURIComponent(b.website!.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))}`)} style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }} title="Open everything about this site">🌐 {b.website.replace(/^https?:\/\//, '')}</span>
                    : <span style={{ fontSize: 12, color: '#d97706' }}>🌐 no website</span>}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Pill on={b.shopify.connected} onLabel={`Shopify · ${b.shopify.shop_domain || 'connected'}`} offLabel="Shopify ✕" color="#96bf48" />
                    <Pill on={b.meta.connected} onLabel={`Meta · ${b.meta.accounts?.length || 0} acct`} offLabel="Meta ✕" color="#1877F2" />
                    <Pill on={b.kb_present} onLabel="Knowledge base" offLabel="No KB" color="#7c3aed" />
                  </span>
                </div>

                {/* metrics row */}
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 12 }}>
                  {[
                    ['Revenue', money(b.revenue.total, b.revenue.currency), `${b.revenue.orders} orders${b.revenue.organic ? ` · ${money(b.revenue.organic, b.revenue.currency)} organic` : ''}`],
                    ['Products', b.products_count, 'synced'],
                    ['Templates', b.templates_count, 'generated'],
                    ['SEO applied', b.seo.catalog_applied, `${b.seo.catalog_drafts} pending`],
                    ['Blogs', b.seo.blogs_published, `${b.seo.blogs_drafts} draft`],
                    ['Wins', b.seo.wins, 'logged'],
                  ].map(([k, v, sub]) => (
                    <div key={String(k)}>
                      <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{v as any}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{k as any}</div>
                      <div style={{ fontSize: 10, color: '#c3c7c3' }}>{sub as any}</div>
                    </div>
                  ))}
                </div>

                {/* ── Knowledge base (what Mello read off their website) ── */}
                {(b.kb_facts.length > 0 || b.voice) && (
                  <SubBlock label={`Knowledge base${b.market ? ` · ${b.market}` : ''}`}>
                    {b.voice && (
                      <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                        <b>Voice:</b> {[b.voice.tone, b.voice.energy, b.voice.audience].filter(Boolean).join(' · ') || '—'}
                      </div>
                    )}
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {b.kb_facts.slice(0, 12).map((f, i) => (
                        <li key={i} style={{ fontSize: 12, color: '#333', lineHeight: 1.5 }}>{f}</li>
                      ))}
                    </ul>
                    {b.kb_facts.length > 12 && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>+{b.kb_facts.length - 12} more facts</div>}
                  </SubBlock>
                )}

                {/* ── Products (real cards with images) ── */}
                {b.products_cached.length > 0 && (
                  <SubBlock label={`Products (${b.products_cached.length}${b.products_count > b.products_cached.length ? ` of ${b.products_count}` : ''})`}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10 }}>
                      {b.products_cached.slice(0, 18).map((p, i) => (
                        <a key={i} href={p.url || '#'} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', background: '#fafafa' }}>
                          <div style={{ aspectRatio: '1', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {p.image ? <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, color: '#bbb' }}>no image</span>}
                          </div>
                          <div style={{ padding: '5px 7px' }}>
                            <div style={{ fontSize: 11, color: '#222', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title || 'Product'}</div>
                            {p.price && <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700 }}>{p.price}</div>}
                          </div>
                        </a>
                      ))}
                    </div>
                  </SubBlock>
                )}

                {/* ── Templates (their generated ad templates) ── */}
                {b.templates.length > 0 && (
                  <SubBlock label={`Templates (${b.templates.length})`}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                      {b.templates.map((t, i) => (
                        <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', background: '#fafafa' }}>
                          <div style={{ aspectRatio: '4/5', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {t.image ? <img src={t.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 10, color: '#888', padding: 8, textAlign: 'center' }}>not generated yet</span>}
                          </div>
                          <div style={{ padding: '5px 7px' }}>
                            <div style={{ fontSize: 11, color: '#222', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                            {t.headline && <div style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.headline}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SubBlock>
                )}

                {/* ── Audiences (full personas) ── */}
                {b.audiences.length > 0 && (
                  <SubBlock label={`Audiences (${b.audiences.length})`}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                      {b.audiences.map((a, i) => (
                        <div key={i} style={{ border: '1px solid #eef0ee', borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#111', marginBottom: 4 }}>{a.name}</div>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {a.insights.map((s, j) => <li key={j} style={{ fontSize: 11.5, color: '#555', lineHeight: 1.5 }}>{s}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </SubBlock>
                )}

                {/* ── Competitors (discovered cards + their live ads) ── */}
                {b.competitors.length > 0 && (
                  <SubBlock label={`Competitors (${b.competitors.length})`}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {b.competitors.map((c, i) => (
                        <div key={i} style={{ border: '1px solid #eef0ee', borderRadius: 8, padding: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111' }}>{c.name}</span>
                            {c.domain && <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563eb', textDecoration: 'none' }}>{c.domain}</a>}
                          </div>
                          {c.reason && <div style={{ fontSize: 11.5, color: '#666', marginTop: 3 }}>{c.reason}</div>}
                          {c.liveAds.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                              {c.liveAds.slice(0, 6).map((ad: any, j: number) => {
                                const img = ad?.image || ad?.image_url || ad?.thumbnail || ad?.creative || null
                                return img ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={j} src={img} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
                                ) : null
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </SubBlock>
                )}

                {/* ── Generated ads for THIS brand (the actual creatives they made) ── */}
                {(() => {
                  const brandAds = user.creatives.filter((c) => c.brand_id === b.id)
                  if (brandAds.length === 0) return null
                  return (
                    <SubBlock label={`Generated ads (${brandAds.length})`}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                        {brandAds.slice(0, 24).map((c) => (
                          <a key={c.id} href={c.image_url || '#'} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', background: '#fafafa' }}>
                            <div style={{ position: 'relative', aspectRatio: '1', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {c.media_type === 'video'
                                ? <video src={c.image_url || ''} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                // eslint-disable-next-line @next/next/no-img-element
                                : c.image_url ? <img src={c.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ color: c.status === 'processing' ? '#ff5a2c' : '#666', fontSize: 10 }}>{c.status === 'processing' ? '⏳' : 'no image'}</span>}
                              <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.65)', color: '#fff', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px', textTransform: 'capitalize' }}>{c.type}</span>
                            </div>
                          </a>
                        ))}
                      </div>
                    </SubBlock>
                  )
                })()}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Facebook / competitor reports Mello authored for this user. */}
      {(user.reports?.length ?? 0) > 0 && (
        <Section title={`Reports (${user.reports!.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                {['Title', 'Type', 'Subject', 'Ads', 'Model', 'Created'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#999', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {user.reports!.map(r => (
                <React.Fragment key={r.id}>
                  <tr onClick={() => setOpenReport(openReport === r.id ? null : r.id)}
                    style={{ borderBottom: '1px solid #f8f8f8', cursor: r.body_md ? 'pointer' : 'default', background: openReport === r.id ? '#faf9f6' : 'transparent' }}>
                    <td style={{ padding: '9px 8px', color: '#111', fontWeight: 600 }}>{r.body_md ? (openReport === r.id ? '▾ ' : '▸ ') : ''}{r.title}</td>
                    <td style={{ padding: '9px 8px', color: '#555' }}>{r.kind.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '9px 8px', color: '#555' }}>{r.subject || '—'}</td>
                    <td style={{ padding: '9px 8px', color: '#555' }}>{r.ad_count ?? '—'}</td>
                    <td style={{ padding: '9px 8px', color: '#888', fontSize: 11 }}>{r.model || '—'}</td>
                    <td style={{ padding: '9px 8px', color: '#888' }}>{fmt(r.created_at)}</td>
                  </tr>
                  {openReport === r.id && r.body_md && (
                    <tr>
                      <td colSpan={6} style={{ padding: '4px 8px 16px' }}>
                        <div style={{ background: '#fff', border: '1px solid #eceeec', borderRadius: 8, padding: 16, maxHeight: 480, overflowY: 'auto', fontSize: 12.5, lineHeight: 1.6, color: '#222', whiteSpace: 'pre-wrap' }}>
                          {r.body_md}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Section>
      )}

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

      {/* Brands the user CREATED (their own projects) — distinct from the competitor brands they follow. */}
      {(user.brands_created?.length ?? 0) > 0 && (
        <Section title={`Brands Created (${user.brands_created!.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {user.brands_created!.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', background: '#f7f9f7', border: '1px solid #e5e9e5', borderRadius: '20px', fontSize: '13px', color: '#222' }}>
                <span style={{ fontWeight: 600 }}>{b.name || b.id}</span>
                {b.brand_type && <span style={{ fontSize: '11px', color: '#888' }}>{b.brand_type}</span>}
                {b.created_at && <span style={{ fontSize: '11px', color: '#aaa' }}>{fmt(b.created_at)}</span>}
              </div>
            ))}
          </div>
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
                  {/* Which ad this was cloned from — click opens it in Discovery (nested-anchor-safe via onClick). */}
                  {c.source_ad_id && (
                    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(`/discovery/${c.source_ad_id}`, '_blank') }}
                      title={`Cloned from ad ${c.source_ad_id} — open in Discovery`}
                      style={{ fontSize: 10, color: '#ff5a2c', fontWeight: 700, marginTop: 3, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      ⧉ cloned from {c.source_ad_id}
                    </div>
                  )}
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
