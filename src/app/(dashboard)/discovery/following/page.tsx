'use client'
/** Following — ads from brands the user follows. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cleanCopy } from '@/lib/cleanCopy'
import RadarSearch from '@/components/motion/RadarSearch'
import EmptyState from '@/components/motion/EmptyState'

interface Ad {
  id: string; pageId: string; pageName: string; body: string
  thumbnailUrl: string | null; videoUrl: string | null
  creatives: { r2_url: string; asset_type: string }[]
  format: string; isActive: boolean
}

export default function FollowingPage() {
  const router = useRouter()
  const [ads, setAds] = useState<Ad[]>([])
  const [brands, setBrands] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cols, setCols] = useState(4)

  useEffect(() => {
    const calc = () => { const w = window.innerWidth; setCols(w < 700 ? 2 : w < 1050 ? 3 : w < 1450 ? 4 : 5) }
    calc(); window.addEventListener('resize', calc); return () => window.removeEventListener('resize', calc)
  }, [])
  useEffect(() => {
    (async () => {
      const r = await fetch('/api/discovery/following'); const d = await r.json()
      setAds(d.ads || []); setBrands(d.brands || []); setLoading(false)
    })()
  }, [])

  const thumb = (a: Ad) => a.thumbnailUrl || a.creatives?.[0]?.r2_url || null

  const [unfollowing, setUnfollowing] = useState<string | null>(null)
  const unfollow = async (pageId: string) => {
    setUnfollowing(pageId)
    try {
      await fetch(`/api/discovery/follow?page_id=${encodeURIComponent(pageId)}`, { method: 'DELETE' })
      setBrands(prev => prev.filter((b: any) => String(b.page_id) !== String(pageId)))
      setAds(prev => prev.filter(a => String(a.pageId) !== String(pageId)))
    } finally { setUnfollowing(null) }
  }

  if (loading) return <div style={{ padding: '60px 28px' }}><RadarSearch caption="Loading your follows" /></div>

  if (brands.length === 0) return (
    <div style={{ padding: 48, maxWidth: 560, margin: '30px auto', textAlign: 'center' }}>
      <EmptyState heading="You're not following any brands yet" sub="Hover a brand in Discovery and hit Follow to build a feed of just their new ads." />
      <Link href="/discovery" style={{ display: 'inline-block', marginTop: 6, padding: '10px 18px', background: '#1a3a1a', color: '#dffe95', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Find brands to follow →</Link>
    </div>
  )

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>Following</h1>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{brands.length} brand{brands.length > 1 ? 's' : ''} · {ads.length} recent ads</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {brands.map((b: any) => (
          <span key={b.page_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#374151', background: '#f1f5f9', padding: '3px 6px 3px 10px', borderRadius: 100, textTransform: 'capitalize' }}>
            {b.brand_name || b.page_id}
            <button onClick={() => unfollow(b.page_id)} disabled={unfollowing === b.page_id} title="Unfollow"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', border: 'none', background: '#e2e8f0', color: '#64748b', fontSize: 12, lineHeight: 1, cursor: unfollowing === b.page_id ? 'wait' : 'pointer', padding: 0 }}>
              {unfollowing === b.page_id ? '·' : '×'}
            </button>
          </span>
        ))}
      </div>

      {ads.length === 0 ? <div style={{ color: '#9ca3af' }}>No ads from your followed brands yet.</div> : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {Array.from({ length: cols }, (_, ci) => (
            <div key={ci} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ads.filter((_, i) => i % cols === ci).map(ad => (
                <div key={ad.id} onClick={() => router.push(`/discovery/${ad.id}`)}
                  style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}>
                  {thumb(ad) && <img src={thumb(ad) as string} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />}
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{ad.pageName}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{cleanCopy(ad.body)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
