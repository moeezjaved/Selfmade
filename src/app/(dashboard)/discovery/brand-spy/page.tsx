'use client'
/**
 * Brand Spy — directory of brands we track (the union of everything the crawler indexes,
 * ranked by ad volume). Search a brand, click through to its competitor dashboard. Powered
 * by /api/discovery/top-brands over discovery_ads_index — no per-brand "spend credits to
 * track" gate, because we already snapshot every brand continuously.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Brand = { pageId: string; name: string; adCount: number; picture: string | null }

export default function BrandSpyList() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/discovery/top-brands?country=ALL${query ? `&q=${encodeURIComponent(query)}` : ''}`)
      const j = await res.json()
      setBrands(j.brands || [])
    } catch { setBrands([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, load])

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', marginBottom: 2 }}>Brand Spy</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 18 }}>
        Track any competitor’s Meta ads over time — format mix, launch cadence, active-ad trends, and the hooks they run. We snapshot every brand continuously, so the history is already there.
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a brand to spy on…"
        style={{ width: 360, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 14, outline: 'none' }}
      />

      <div style={{ background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 110px', padding: '10px 16px', borderBottom: '1px solid #eee', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <div>Brand</div><div style={{ textAlign: 'right' }}>Ads tracked</div><div style={{ textAlign: 'right' }}>Spy</div>
        </div>
        {loading && <div style={{ padding: 24, color: '#9ca3af', fontSize: 14 }}>Loading brands…</div>}
        {!loading && brands.length === 0 && <div style={{ padding: 24, color: '#9ca3af', fontSize: 14 }}>No brands match “{q}”.</div>}
        {brands.map((b) => (
          <Link
            key={b.pageId}
            href={`/discovery/brand-spy/${b.pageId}`}
            style={{ display: 'grid', gridTemplateColumns: '1fr 120px 110px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f3f4f6', textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.pageId}</div>
            <div style={{ textAlign: 'right', fontSize: 14, color: '#374151' }}>{b.adCount.toLocaleString()}</div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#2075ff', background: 'rgba(32,117,255,0.08)', padding: '5px 12px', borderRadius: 999 }}>Spy →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
