'use client'
/**
 * /admin/seo — SEO dashboard. Our coverage numbers (eligible brands, unique-content generated) plus
 * live Google Search Console ranking data (clicks / impressions / avg position / top queries) once GSC
 * is connected. Refresh-on-load; GSC data is 28-day.
 */
import { useEffect, useState } from 'react'

export default function AdminSeo() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/admin/seo').then(r => r.json()).then(setD).catch(e => setErr(String(e)))
  }, [])

  if (err) return <div style={{ padding: 32, color: '#c0392b' }}>Error: {err}</div>
  if (!d) return <div style={{ padding: 32 }}>Loading SEO metrics…</div>

  const g = d.gsc
  const t = g?.totals
  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a1a', marginBottom: 4 }}>SEO — Brand Pages</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Programmatic pages at <code>/brands/[slug]</code> for brands with ≥{d.min_ads} ads.
        Sitemap: <a href={d.sitemap_url} target="_blank" rel="noreferrer" style={{ color: '#2075ff' }}>{d.sitemap_url}</a>
      </div>

      {/* Coverage */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#374151', margin: '8px 0 10px' }}>Coverage</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginBottom: 8 }}>
        <KPI label={`Eligible brands (≥${d.min_ads} ads)`} value={d.coverage.eligible_brands.toLocaleString()} />
        <KPI label="Unique content written" value={`${d.coverage.content_generated.toLocaleString()}`} sub={`${d.coverage.content_pct}% of eligible`} />
        <KPI label="100–499 ads" value={d.coverage.buckets['100-499'].toLocaleString()} />
        <KPI label="500–999 ads" value={d.coverage.buckets['500-999'].toLocaleString()} />
        <KPI label="1000+ ads" value={d.coverage.buckets['1000+'].toLocaleString()} />
      </div>
      {d.coverage.content_pct < 100 && (
        <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: 8, marginBottom: 24 }}>
          {d.coverage.eligible_brands - d.coverage.content_generated} eligible brands still use templated copy.
          Run <code>seo-content-worker</code> on the droplet to write unique copy for them.
        </div>
      )}

      {/* Google Search Console */}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#374151', margin: '20px 0 10px' }}>Google Search Console (last 28 days)</h2>
      {!g?.configured ? (
        <div style={{ fontSize: 13, color: '#4b5563', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px 18px', borderRadius: 10, lineHeight: 1.6 }}>
          <b>Not connected yet.</b> To see live ranking data (clicks, impressions, average position, top queries) here:
          <ol style={{ margin: '8px 0 0 18px' }}>
            <li>Verify <code>tryselfmade.ai</code> in Google Search Console and submit the sitemap above.</li>
            <li>Create a Google Cloud service account, enable the <i>Search Console API</i>, and add the service-account email as a <b>full user</b> in GSC settings.</li>
            <li>Set env vars <code>GOOGLE_SA_EMAIL</code>, <code>GOOGLE_SA_PRIVATE_KEY</code>, <code>GSC_PROPERTY</code> (e.g. <code>sc-domain:tryselfmade.ai</code>) in Vercel.</li>
          </ol>
          Until then, view rankings directly in the <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" style={{ color: '#2075ff' }}>Search Console dashboard</a>.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginBottom: 18 }}>
            <KPI label="Clicks" value={t ? Math.round(t.clicks).toLocaleString() : '—'} />
            <KPI label="Impressions" value={t ? Math.round(t.impressions).toLocaleString() : '—'} />
            <KPI label="Avg CTR" value={t ? `${(t.ctr * 100).toFixed(1)}%` : '—'} />
            <KPI label="Avg position" value={t ? t.position.toFixed(1) : '—'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <RankTable title="Top queries" rows={g.topQueries} keyName="query" />
            <RankTable title="Top pages" rows={g.topPages} keyName="page" />
          </div>
        </>
      )}

      <ProgrammaticSeo />
    </div>
  )
}

/** Coverage for the programmatic /ads + /alternatives pages (live vs thin, ad counts). */
function ProgrammaticSeo() {
  const [p, setP] = useState<any>(null)
  useEffect(() => { fetch('/api/admin/seo/programmatic').then(r => r.json()).then(setP).catch(() => {}) }, [])
  if (!p) return <div style={{ marginTop: 28, fontSize: 13, color: '#9ca3af' }}>Loading ad/comparison page coverage…</div>
  const s = p.summary
  return (
    <div style={{ marginTop: 32, borderTop: '1px solid #eee', paddingTop: 24 }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1a3a1a', margin: '0 0 4px' }}>SEO — Ad &amp; Comparison Pages</h2>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        <code>/ads/[industry]</code>, <code>/ads/format/[hook]</code>, and <code>/alternatives/[competitor]</code>. A page goes <b>live</b> (indexable) at ≥{p.min_ads} real ads; below that it&rsquo;s <b>noindex</b> (thin-content guard).
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginBottom: 20 }}>
        <KPI label="Total pages" value={String(s.total)} />
        <KPI label="Live (indexed)" value={String(s.live)} sub={`${Math.round(s.live / s.total * 100)}% of pages`} />
        <KPI label="Thin (noindex)" value={String(s.thin)} />
        <KPI label="Comparison pages" value={String(s.alternatives)} sub="always live" />
        <KPI label="Industry / Format live" value={`${s.industriesLive} / ${s.formatsLive}`} />
      </div>
      {s.thin > 0 && (
        <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: 8, marginBottom: 20 }}>
          {s.thin} pages are still thin (&lt;{p.min_ads} ads) and noindex&rsquo;d. They go live automatically as the classifier (E) processes more ads in those niches/formats.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <SeoTable title={`Industries (${p.industries.filter((x: any) => x.live).length}/${p.industries.length} live)`} rows={p.industries} />
        <SeoTable title={`Formats (${p.formats.filter((x: any) => x.live).length}/${p.formats.length} live)`} rows={p.formats} />
      </div>
      <div style={{ marginTop: 20 }}>
        <SeoTable title={`Comparison pages (${p.alternatives.length})`} rows={p.alternatives} />
      </div>
    </div>
  )
}

function SeoTable({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ border: '1px solid #e6e6e6', borderRadius: 10, overflow: 'hidden' }}>
        {rows.map((r: any, i: number) => (
          <div key={r.url} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 12px', fontSize: 12.5, borderBottom: '1px solid #f1f5f9', background: i % 2 ? '#fafafa' : '#fff' }}>
            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#374151', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</a>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {r.ads != null && <span style={{ color: '#9ca3af' }}>{r.ads} ads</span>}
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: r.live ? '#dcfce7' : '#fef3c7', color: r.live ? '#16a34a' : '#b45309' }}>{r.live ? 'LIVE' : 'thin'}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function RankTable({ title, rows, keyName }: { title: string; rows: any[]; keyName: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ border: '1px solid #e6e6e6', borderRadius: 10, overflow: 'hidden' }}>
        {(rows || []).slice(0, 15).map((r: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 12px', fontSize: 12, borderBottom: '1px solid #f1f5f9', background: i % 2 ? '#fafafa' : '#fff' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' }}>{r.keys?.[0]}</span>
            <span style={{ color: '#6b7280', flexShrink: 0 }}>{Math.round(r.clicks)} clk · {Math.round(r.impressions)} imp · #{r.position?.toFixed(0)}</span>
          </div>
        ))}
        {(!rows || rows.length === 0) && <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>No data yet.</div>}
      </div>
    </div>
  )
}
