'use client'
/**
 * Brand Spy — directory + manual add. Reads the fast per-brand summary
 * (/api/discovery/brand-spy over discovery_brand_crawl_state). "Add manually" pastes a Meta
 * Ad Library page URL to start spying a NEW brand (charges brand_spy credits + queues it to
 * crawl). Brands we already track are free to open.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCredits, refreshCredits } from '@/components/credits/CreditCounter'

type Brand = { pageId: string; name: string; adCount: number }

function tab(active: boolean): React.CSSProperties {
  return { padding: '7px 16px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none', color: active ? '#111' : '#6b7280', background: active ? 'rgba(223,254,149,0.5)' : '#f3f4f6', border: 'none', cursor: 'pointer' }
}

export default function BrandSpyList() {
  const router = useRouter()
  const { pricing } = useCredits()
  const cost = pricing?.brand_spy?.credits ?? null
  const [brands, setBrands] = useState<Brand[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'search' | 'manual'>('search')
  const [manualUrl, setManualUrl] = useState('')
  const [spying, setSpying] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/discovery/brand-spy${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      const j = await res.json()
      setBrands(j.brands || [])
    } catch { setBrands([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { const t = setTimeout(() => load(q.trim()), q ? 300 : 0); return () => clearTimeout(t) }, [q, load])

  const spyManual = async () => {
    setMsg('')
    if (!manualUrl.trim()) return
    if (cost && !confirm(`Start spying on this brand? This uses ${cost} credits and adds it to continuous tracking.`)) return
    setSpying(true)
    try {
      const res = await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: manualUrl.trim() }) })
      const j = await res.json()
      if (!res.ok) { setMsg(j.error || 'Failed'); setSpying(false); return }
      refreshCredits()
      router.push(`/discovery/brand-spy/${j.pageId}`)
    } catch (e) { setMsg(String(e)); setSpying(false) }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <style>{`.bs-row:hover{background:#fafafa}`}</style>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <Link href="/discovery/brand-spy" style={tab(true)}>Brands</Link>
        <Link href="/discovery/brand-spy/feed" style={tab(false)}>Feed</Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', marginBottom: 2 }}>Brand Spy</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Track any competitor’s Meta ads over time — format mix, launch cadence, active-ad trends, and the hooks they run. We snapshot every brand continuously, so the history is already there.
      </div>

      {/* Search / Add-manually toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setMode('search')} style={tab(mode === 'search')}>Search brands</button>
        <button onClick={() => setMode('manual')} style={tab(mode === 'manual')}>Add manually{cost ? ` · ${cost} credits` : ''}</button>
      </div>

      {mode === 'search' ? (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a brand to spy on…"
          style={{ width: 360, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 14, outline: 'none' }} />
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 6 }}>Start spying on a new competitor</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="facebook.com/ads/library/?...view_all_page_id=123… or a page ID"
              style={{ flex: 1, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none' }} />
            <button onClick={spyManual} disabled={spying || !manualUrl.trim()}
              style={{ padding: '9px 18px', background: '#2075ff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: spying ? 'wait' : 'pointer', opacity: spying || !manualUrl.trim() ? 0.6 : 1 }}>
              {spying ? 'Spying…' : `Spy${cost ? ` · ${cost} cr` : ''}`}
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>Paste a brand’s Meta Ad Library <b>page URL</b> (not a keyword search). New brands are queued for continuous tracking.</div>
          {msg && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>{msg}</div>}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 110px', padding: '10px 16px', borderBottom: '1px solid #eee', fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <div>Brand</div><div style={{ textAlign: 'right' }}>Ads tracked</div><div style={{ textAlign: 'right' }}>Spy</div>
        </div>
        {loading && <div style={{ padding: 24, color: '#9ca3af', fontSize: 14 }}>Loading brands…</div>}
        {!loading && brands.length === 0 && <div style={{ padding: 24, color: '#9ca3af', fontSize: 14 }}>No brands match “{q}”.</div>}
        {brands.map((b) => (
          <Link key={b.pageId} href={`/discovery/brand-spy/${b.pageId}`} className="bs-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 120px 110px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f3f4f6', textDecoration: 'none', color: 'inherit' }}>
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
