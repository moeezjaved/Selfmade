'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const SEV_COLOR: Record<string, string> = { high: '#dc2626', medium: '#d97706', low: '#6b7280' }
const money = (n: number, cur: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0)} ${cur}` } }
const scoreColor = (s: number | null | undefined) => s == null ? '#9ca3af' : s >= 70 ? '#16a34a' : s >= 45 ? '#d97706' : '#dc2626'
function fmt(d: string | null) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }

function ScanReport({ result }: { result: any }) {
  if (!result) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: 24 }}>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 18 }}>
        {[['Overall', `${result.score} · ${result.grade}`], ['Website', result.websiteScore], ['Visibility', result.visibilityScore], ['Problems', result.problemCount], ['Revenue lost / yr', money(result.revenueLostPerYear, result.currency)]].map(([k, v]) => (
          <div key={String(k)}><div style={{ fontSize: 22, fontWeight: 800, color: '#111' }}>{v as any}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>{k as any}</div></div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(result.sections || []).map((s: any) => (
          <div key={s.key} style={{ border: '1px solid #f0f2f0', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, color: '#111', fontSize: 14 }}>{s.name}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.sub}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 14, color: scoreColor(s.score) }}>{s.score}</span>
            </div>
            {(s.findings || []).length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(s.findings || []).map((f: any) => (
                  <li key={f.id} style={{ fontSize: 12.5, color: '#333', lineHeight: 1.55 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: SEV_COLOR[f.severity] || '#6b7280', marginRight: 8 }} />
                    <b>{f.title}</b>{f.detail ? ` — ${f.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SitePage({ params }: { params: { domain: string } }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const domain = decodeURIComponent(params.domain)

  useEffect(() => {
    fetch(`/api/admin/site/${encodeURIComponent(domain)}`).then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [domain])

  if (loading) return <div style={{ color: '#aaa', fontSize: 14 }}>Loading…</div>
  if (!data) return <div style={{ color: '#ef4444' }}>Nothing found for this site</div>

  return (
    <div>
      <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: '0 0 18px', display: 'flex', alignItems: 'center', gap: 6 }}>← Back</button>

      {/* The website is the headline. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 26 }}>🌐</span>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', margin: 0 }}>{data.domain}</h1>
        <a href={`https://${data.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>visit ↗</a>
        {data.audit && <span style={{ fontWeight: 800, fontSize: 15, color: scoreColor(data.audit.score) }}>· {data.audit.score} {data.audit.result?.grade || ''}</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        {data.audit && <span style={{ fontSize: 12, color: '#888' }}>{data.audit.site_name} · {data.audit.category} · scanned {fmt(data.audit.created_at)}</span>}
      </div>

      {/* Claim / signup status — the funnel state for THIS site. */}
      <div style={{ background: data.claimed ? '#f0f9f2' : '#fff7ed', border: `1px solid ${data.claimed ? '#bbe6c6' : '#fed7aa'}`, borderRadius: 12, padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {data.claimed ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>✅ Signed up</span>
            <span style={{ fontSize: 13, color: '#444' }}>{data.claimant?.email || data.claimant?.user_id}</span>
            {data.claimant?.user_id && (
              <button onClick={() => router.push(`/admin/users/${data.claimant.user_id}`)} style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 8, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Open full workspace →</button>
            )}
          </>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 700, color: '#c2410c' }}>🔥 Anonymous lead — completed the audit but never signed up</span>
        )}
      </div>

      {/* Workspaces built on this site (if any). */}
      {data.workspaces?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Workspaces on this site ({data.workspaces.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.workspaces.map((w: any) => (
              <div key={w.brand_id} onClick={() => router.push(`/admin/users/${w.user_id}`)} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: 16, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontWeight: 800, color: '#111', fontSize: 15 }}>{w.name}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{w.owner_email}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', background: '#16a34a18', borderRadius: 20, padding: '2px 9px' }}>{w.plan_label}</span>
                  {w.shopify.connected && <span style={{ fontSize: 11, fontWeight: 700, color: '#5a8f2b', background: '#5a8f2b18', borderRadius: 20, padding: '2px 9px' }}>Shopify</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2563eb' }}>Open workspace →</span>
                </div>
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                  {[['Ads', w.ads_count], ['Products', w.products], ['Templates', w.templates], ['Audiences', w.audiences], ['KB', w.kb_present ? 'yes' : '—']].map(([k, v]) => (
                    <div key={String(k)}><div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>{v as any}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>{k as any}</div></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The audit — always, even for anonymous scanners. */}
      {data.audit?.result ? (
        <>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>Their audit</h2>
          <ScanReport result={data.audit.result} />
        </>
      ) : (
        <div style={{ color: '#aaa', fontSize: 13 }}>No stored audit for this site.</div>
      )}
    </div>
  )
}
