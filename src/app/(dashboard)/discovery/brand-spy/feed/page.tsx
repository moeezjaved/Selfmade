'use client'
/**
 * Brand Spy — Feed. A chronological "what did competitors launch" stream across every brand
 * we track (Foreplay's daily-monitor surface). Reuses the optimized /api/discovery/db-search
 * newest path; each card shows the brand, a days-since-launch badge, and a "Spy" link.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

// Read the active project cookie client-side (same as the Brands tab + ProjectSwitcher) so the feed
// scopes to the SAME brand the rest of Brand Spy shows.
const readCookie = (name: string) => { if (typeof document === 'undefined') return ''; const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : '' }

type Cre = { asset_type: string; r2_url: string; poster_url: string | null }
type Ad = { id: string; pageId: string; pageName: string; body: string | null; startDate: string | null; format: string | null; creatives: Cre[] }

const cdn = (url: string, w = 260) => url ? `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp` : ''
const thumbOf = (a: Ad) => { const c = a.creatives?.[0]; if (!c) return ''; return c.asset_type === 'video' ? (c.poster_url || '') : c.r2_url }
const daysAgo = (d: string | null) => { if (!d) return null; const n = Math.floor((Date.now() - +new Date(d)) / 864e5); return n < 0 ? 0 : n }

export default function BrandSpyFeed() {
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [noFollows, setNoFollows] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setNoFollows(false)
    try {
      // Scope to the founder's OWN competitors for the ACTIVE brand — this is "what MY rivals launched",
      // not a global demo feed and not rivals from OTHER/deleted brands (a new account was seeing
      // AlphaInfuse/Iforex it never followed for this brand). Scope to the active project (sf_brand cookie)
      // + spied only, matching the Brands tab. No brand selected → account-wide spied follows.
      const activeBrand = readCookie(BRAND_COOKIE)
      const qs = new URLSearchParams({ spied: '1' }); if (activeBrand) qs.set('brand', activeBrand)
      const f = await fetch(`/api/follows?${qs}`).then(r => r.ok ? r.json() : null).catch(() => null)
      const pageIds: string[] = Array.isArray(f?.pageIds) ? f.pageIds.map(String) : []
      if (!pageIds.length) { setAds([]); setNoFollows(true); return }
      const perBrand = await Promise.all(pageIds.slice(0, 15).map(pid =>
        fetch(`/api/discovery/db-search?pageId=${encodeURIComponent(pid)}&sort=recent&limit=6&country=ALL`).then(r => r.json()).catch(() => ({}))
      ))
      const seen = new Set<string>()
      const merged = perBrand.flatMap((j: any) => (j.ads || j.results || []) as Ad[])
        .filter(a => thumbOf(a) && !seen.has(a.id) && seen.add(a.id))
        .sort((a, b) => (+new Date(b.startDate || 0)) - (+new Date(a.startDate || 0)))
      setAds(merged)
    } catch { setAds([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  // Re-pull when the project switcher changes brand (client-fetch page reads the cookie at fetch time).
  useEffect(() => { const onBrand = () => load(); window.addEventListener('sf:brandchange', onBrand); return () => window.removeEventListener('sf:brandchange', onBrand) }, [load])

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <style>{`.bs-feed-card{transition:transform .12s ease,box-shadow .12s ease}.bs-feed-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}`}</style>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <Link href="/discovery/brand-spy" style={tab(false)}>Brands</Link>
        <Link href="/discovery/brand-spy/feed" style={tab(true)}>Feed</Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', marginBottom: 2 }}>Competitor Feed</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 18 }}>The newest ads from the competitors you watch — your daily “what are they testing today” monitor.</div>

      {loading && <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading feed…</div>}
      {!loading && noFollows && (
        <div style={{ border: '1px dashed #d6ddd4', borderRadius: 12, padding: '28px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>You’re not watching any competitors yet.</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>Follow a brand and their newest ads land here — nobody else’s.</div>
          <Link href="/discovery/brand-spy" style={{ background: '#141d15', color: '#ff5a2c', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>+ Find a competitor to spy</Link>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%), 1fr))', gap: 14 }}>
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
      {!loading && !noFollows && ads.length === 0 && <div style={{ color: '#9ca3af', fontSize: 14 }}>No recent ads from your competitors yet — I’ll fill this as they launch.</div>}
    </div>
  )
}

function tab(active: boolean): React.CSSProperties {
  return { padding: '7px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none', color: active ? '#111' : '#6b7280', background: active ? 'rgba(255,90,44,0.5)' : '#f3f4f6' }
}
