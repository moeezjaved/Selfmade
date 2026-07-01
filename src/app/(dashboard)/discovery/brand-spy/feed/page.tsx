'use client'
/**
 * Brand Spy — Feed. A chronological "what did competitors launch" stream across every brand
 * we track (Foreplay's daily-monitor surface). Reuses the optimized /api/discovery/db-search
 * newest path; each card shows the brand, a days-since-launch badge, and a "Spy" link.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Cre = { asset_type: string; r2_url: string; poster_url: string | null }
type Ad = { id: string; pageId: string; pageName: string; body: string | null; startDate: string | null; format: string | null; creatives: Cre[] }

const cdn = (url: string, w = 260) => url ? `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp` : ''
const thumbOf = (a: Ad) => { const c = a.creatives?.[0]; if (!c) return ''; return c.asset_type === 'video' ? (c.poster_url || '') : c.r2_url }
const daysAgo = (d: string | null) => { if (!d) return null; const n = Math.floor((Date.now() - +new Date(d)) / 864e5); return n < 0 ? 0 : n }

export default function BrandSpyFeed() {
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Use sort=recent (last_seen DESC) — the ONE index-backed browse sort (~0.2s). sort=newest
      // (start_date DESC) has no index for the has-creative browse set → it times out server-side and
      // the route returns ads:[] (the "No recent ads" you saw). last_seen DESC = most-recently-active
      // ads, exactly right for a "what are competitors running now" monitor; each card still shows the
      // real launch-age badge from start_date.
      const res = await fetch('/api/discovery/db-search?sort=recent&limit=60&country=ALL')
      const j = await res.json()
      setAds((j.ads || j.results || []).filter((a: Ad) => thumbOf(a)))
    } catch { setAds([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <style>{`.bs-feed-card{transition:transform .12s ease,box-shadow .12s ease}.bs-feed-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}`}</style>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <Link href="/discovery/brand-spy" style={tab(false)}>Brands</Link>
        <Link href="/discovery/brand-spy/feed" style={tab(true)}>Feed</Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', marginBottom: 2 }}>Competitor Feed</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 18 }}>Newest ads launched across every brand we track — your daily “what are competitors testing today” monitor.</div>

      {loading && <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading feed…</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {ads.map((a) => {
          const d = daysAgo(a.startDate)
          return (
            <div key={a.id} className="bs-feed-card" style={{ background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ position: 'relative', aspectRatio: '1/1', background: '#f3f4f6' }}>
                <img src={cdn(thumbOf(a))} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {d !== null && (
                  <span style={{ position: 'absolute', top: 8, left: 8, background: d === 0 ? '#10b981' : 'rgba(17,17,17,0.8)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999 }}>
                    {d === 0 ? 'NEW · 0D' : `${d}D`}
                  </span>
                )}
                {a.format && <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,0.92)', color: '#374151', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6 }}>{a.format}</span>}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.pageName || a.pageId}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, height: 32, overflow: 'hidden' }}>{a.body || ''}</div>
                <Link href={`/discovery/brand-spy/${a.pageId}`} style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700, color: '#2075ff', textDecoration: 'none' }}>Spy brand →</Link>
              </div>
            </div>
          )
        })}
      </div>
      {!loading && ads.length === 0 && <div style={{ color: '#9ca3af', fontSize: 14 }}>No recent ads.</div>}
    </div>
  )
}

function tab(active: boolean): React.CSSProperties {
  return { padding: '7px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none', color: active ? '#111' : '#6b7280', background: active ? 'rgba(223,254,149,0.5)' : '#f3f4f6' }
}
