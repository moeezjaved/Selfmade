'use client'
/**
 * Top Picks — pack detail. Shows the expert's favorite ads as a grid (real creatives). Each card
 * has "Edit in template" (opens the stored Canva template) and "Make ad copy" (AI rewrite). Paid
 * packs the user hasn't unlocked show a preview + a buy wall.
 */
import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, LayoutTemplate, Sparkles, Lock, Copy, X, Check } from 'lucide-react'

const LIME = '#ff5a2c'
const DARK = '#141d15'
const dollars = (cents: number) => (cents / 100)

interface Ad {
  adId: string; pageId: string; pageName: string; body: string | null; title: string | null
  startDate: string | null; stopDate: string | null; isActive: boolean; daysRunning: number | null
  format: string | null; thumbnail: string | null; canvaUrl: string | null
}
interface PackDetail {
  pack: { id: string; title: string; description: string | null; cover_url: string | null; price_cents: number; original_price_cents: number | null; is_early_bird: boolean; gate: string; total_ads: number }
  expert: { id: string; name: string; handle: string | null; avatar_url: string | null; bio: string | null }
  ads: Ad[]; unlocked: boolean; locked: boolean; previewCount: number
}

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function PackDetailPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = use(params)
  const [data, setData] = useState<PackDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [copyAd, setCopyAd] = useState<Ad | null>(null)

  const load = async () => {
    try {
      const r = await fetch(`/api/discovery/top-picks/${packId}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setData(d)
    } catch (e) { setError(e instanceof Error ? e.message : 'failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [packId])

  const unlock = async () => {
    setUnlocking(true); setError(null)
    try {
      const r = await fetch(`/api/discovery/top-picks/${packId}/purchase`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || d.error || 'failed')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'unlock failed') }
    finally { setUnlocking(false) }
  }

  if (loading) return <div style={{ padding: 40, color: '#9ca3af' }}>Loading…</div>
  if (error && !data) return <div style={{ padding: 40, color: '#b91c1c' }}>{error}</div>
  if (!data) return null
  const { pack, expert, ads, locked } = data

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <Link href="/discovery/top-picks" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: 18 }}>
        <ArrowLeft size={15} /> Top Picks
      </Link>

      {/* Pack header */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {expert.avatar_url
              ? <img src={expert.avatar_url} alt={expert.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#ef4a1e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{expert.name.slice(0, 1)}</div>}
            <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 700 }}>{expert.name}{expert.handle ? ` · @${expert.handle.replace(/^@/, '')}` : ''}</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111', margin: '0 0 6px' }}>{pack.title}</h1>
          {pack.description && <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5, maxWidth: 640, margin: 0 }}>{pack.description}</p>}
          <div style={{ fontSize: 13, color: '#9ca3af', fontWeight: 600, marginTop: 8 }}>{pack.total_ads} Ads · {pack.total_ads} Canva Templates</div>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, margin: '12px 0' }}>{error}</div>}

      {/* Buy wall for locked packs */}
      {locked && (
        <div style={{ background: '#f8faf0', border: `1px solid ${LIME}`, borderRadius: 14, padding: '20px 24px', margin: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Lock size={22} style={{ color: DARK }} />
            <div>
              <div style={{ fontWeight: 800, color: '#111', fontSize: 15 }}>Unlock all {pack.total_ads} ads + Canva templates</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>You're previewing the first {data.previewCount}. Get the full pack to edit every template.</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: DARK }}>{pack.gate === 'core' ? 'Core' : pack.price_cents === 0 ? 'Free' : `$${dollars(pack.price_cents).toFixed(0)}`}</span>
              {pack.original_price_cents ? <span style={{ fontSize: 15, color: '#9ca3af', textDecoration: 'line-through' }}>${dollars(pack.original_price_cents).toFixed(0)}</span> : null}
            </span>
            <button onClick={unlock} disabled={unlocking}
              style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
              {unlocking ? 'Unlocking…' : 'Unlock pack'}
            </button>
          </div>
        </div>
      )}

      {/* Favorites grid */}
      <div style={{ columnGap: 16, columns: '4 240px', marginTop: 18 }}>
        {ads.map(ad => (
          <div key={ad.adId} style={{ breakInside: 'avoid', marginBottom: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            {/* Brand header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#475569' }}>{(ad.pageName || '?').slice(0, 1)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ad.pageName}</div>
                {(ad.startDate) && <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(ad.startDate)}{ad.stopDate ? ` – ${fmtDate(ad.stopDate)}` : ''}</div>}
              </div>
              {ad.isActive && <span title="Active" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4a1e', flexShrink: 0 }} />}
            </div>
            {/* Copy snippet */}
            {ad.body && <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.45, padding: '0 12px 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ad.body}</div>}
            {/* Creative */}
            {ad.thumbnail
              ? <img src={ad.thumbnail} alt="" loading="lazy" style={{ width: '100%', display: 'block' }} />
              : <div style={{ width: '100%', aspectRatio: '1', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 12 }}>No preview</div>}
            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, padding: 10 }}>
              {ad.canvaUrl ? (
                <a href={ad.canvaUrl} target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#ef4a1e', color: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>
                  <LayoutTemplate size={14} /> Edit in template
                </a>
              ) : (
                <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#f1f5f9', color: '#9ca3af', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, fontWeight: 700 }}>
                  <Lock size={13} /> {locked ? 'Locked' : 'No template'}
                </span>
              )}
              <button onClick={() => setCopyAd(ad)} title="Make ad copy with AI" disabled={locked}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: '#fff', color: locked ? '#cbd5e1' : DARK, border: `1px solid ${locked ? '#e5e7eb' : DARK}`, borderRadius: 8, padding: '8px 11px', fontSize: 12.5, fontWeight: 700, cursor: locked ? 'default' : 'pointer' }}>
                <Sparkles size={14} /> Copy
              </button>
            </div>
          </div>
        ))}
      </div>

      {ads.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>This pack has no ads yet.</div>}

      {copyAd && <AdCopyModal packId={packId} ad={copyAd} onClose={() => setCopyAd(null)} />}
    </div>
  )
}

/** AI ad-copy rewrite — calls the pack's ad-copy endpoint and shows variant hooks/bodies. */
function AdCopyModal({ packId, ad, onClose }: { packId: string; ad: Ad; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [variants, setVariants] = useState<{ hook: string; body: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(`/api/discovery/top-picks/${packId}/ad-copy`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adId: ad.adId }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.message || d.error || 'failed')
        setVariants(d.variants || [])
      } catch (e) { setError(e instanceof Error ? e.message : 'failed') }
      finally { setLoading(false) }
    })()
  }, [packId, ad.adId])

  const copy = (i: number, v: { hook: string; body: string }) => {
    navigator.clipboard.writeText(`${v.hook}\n\n${v.body}`).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500) })
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: '#111', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={18} style={{ color: DARK }} /> AI ad copy</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
        </div>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Fresh angles based on <strong>{ad.pageName}</strong>'s ad — paste any into your Canva template.</p>
        {loading ? <div style={{ color: '#9ca3af', fontSize: 14, padding: '20px 0' }}>Generating…</div>
          : error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {variants.map((v, i) => (
                <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 6 }}>{v.hook}</div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 10 }}>{v.body}</div>
                  <button onClick={() => copy(i, v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: copied === i ? '#fdeee7' : DARK, color: copied === i ? '#9a3412' : LIME, border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {copied === i ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                  </button>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
