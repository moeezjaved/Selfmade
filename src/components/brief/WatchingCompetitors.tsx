'use client'
/**
 * WatchingCompetitors — the "Watching for <brand>" list on the brief. Confirms a just-added competitor is
 * tracked, shows its crawl progress, and shows their ads VISUALLY (like Discovery): top ads normally, and
 * when they launch new ones, "<brand> launched N new ads" + the new creatives (capped at 4). Also catches
 * a competitor added but NOT linked to the selected brand, with one-click "Link to <brand>".
 */
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import AdPreviewLightbox, { type PreviewAd } from '@/components/brief/AdPreviewLightbox'

const INK = '#141d15', GREEN = '#ef4a1e', LINE = 'rgba(0,0,0,0.08)', FOREST = '#141d15', LIME = '#ff5a2c'

type Ad = { adId: string; image: string | null; isVideo: boolean; videoUrl: string | null }
type Row = { pageId: string; brand: string; adCount: number; status: 'live' | 'crawling' | 'queued' | 'empty'; lastCrawledAt: string | null; topAds?: Ad[]; newAds?: Ad[] }
type Unlinked = { pageId: string; brand: string }
type Data = { watching: Row[]; unlinked: Unlinked[] }

const LABEL: Record<Row['status'], (n: number) => string> = {
  live: (n) => `✓ ${n} ad${n === 1 ? '' : 's'}`,
  crawling: () => '⏳ fetching their ads…',
  queued: () => '⏳ queued — fetching soon',
  empty: () => 'no live ads found',
}
const COLOR: Record<Row['status'], string> = { live: GREEN, crawling: '#b7791f', queued: '#b7791f', empty: '#a7b0a5' }

function Thumbs({ ads, pageId, brand }: { ads: Ad[]; pageId: string; brand: string }) {
  const [preview, setPreview] = useState<PreviewAd>(null)
  if (!ads.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <AdPreviewLightbox ad={preview} onClose={() => setPreview(null)} />
      {ads.slice(0, 4).map(a => (
        // Tap the ad to VIEW it right here (image/video) instead of bouncing to Brand Spy.
        <button key={a.adId} onClick={() => setPreview({ image: a.image, videoUrl: a.videoUrl, isVideo: a.isVideo, adId: a.adId, pageId, brand })} title="View ad"
          style={{ display: 'block', width: 62, height: 62, borderRadius: 8, overflow: 'hidden', background: '#eef2ec', position: 'relative', flexShrink: 0, border: 'none', padding: 0, cursor: 'pointer' }}>
          {a.image
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={a.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
            : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 18 }}>🎬</span>}
          {a.isVideo && <span style={{ position: 'absolute', bottom: 3, right: 3, fontSize: 8.5, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 3, padding: '0 4px', lineHeight: '13px' }}>▶</span>}
        </button>
      ))}
    </div>
  )
}

export default function WatchingCompetitors({ brandId, brandName }: { brandId?: string | null; brandName?: string | null }) {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<any>(null)

  const load = () => {
    fetch(`/api/discovery/watching${brandId ? `?brand=${encodeURIComponent(brandId)}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.watching)) setData({ watching: j.watching, unlinked: j.unlinked || [] }) }).catch(() => {})
  }
  // Clear the previous brand's rows on switch so a brand change never shows the old brand's competitors.
  useEffect(() => { setData(null); load(); return () => { if (timer.current) clearInterval(timer.current) } }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps
  // Re-pull the moment a competitor is added (AddCompetitors fires this), so the new one appears live
  // instead of only after a manual reload.
  useEffect(() => {
    const onAdded = () => load()
    window.addEventListener('sf:competitor-added', onAdded)
    return () => window.removeEventListener('sf:competitor-added', onAdded)
  }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.watching || []
  const unlinked = data?.unlinked || []

  useEffect(() => {
    const stillLoading = rows.some(r => r.status === 'crawling' || r.status === 'queued')
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    if (stillLoading) timer.current = setInterval(load, 20000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [data])   // eslint-disable-line react-hooks/exhaustive-deps

  const fetchNow = async () => {
    setBusy(true)
    try {
      const j = await fetch('/api/guardian/recheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandId }) }).then(r => r.json())
      if (j?.ok) toast.success(`Fetching ads for ${j.queued} competitor${j.queued === 1 ? '' : 's'} — this can take a bit.`)
      else toast.error('Could not start the fetch.')
    } catch { toast.error('Could not start the fetch.') } finally { setBusy(false) }
  }
  const [linking, setLinking] = useState('')
  const linkOne = async (u: { pageId: string; brand: string }) => {
    if (!brandId) return
    setLinking(u.pageId)
    try {
      await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: u.pageId, brandName: u.brand, action: 'follow', brandId, spied: true }) })
      toast.success(`Linked ${u.brand} to ${brandName || 'this brand'}.`)
      load()
    } catch { toast.error('Could not link.') } finally { setLinking('') }
  }
  const linkAll = async () => {
    if (!brandId || !unlinked.length) return
    setBusy(true)
    try {
      for (const u of unlinked) {
        await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: u.pageId, brandName: u.brand, action: 'follow', brandId, spied: true }) }).catch(() => {})
      }
      toast.success(`Linked ${unlinked.length} competitor${unlinked.length === 1 ? '' : 's'} to ${brandName || 'this brand'}.`)
      load()
    } catch { toast.error('Could not link.') } finally { setBusy(false) }
  }

  if (!data || (rows.length === 0 && unlinked.length === 0)) return null

  return (
    <div style={{ marginTop: 12 }}>
      {rows.length > 0 && (<>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a7b0a5', marginBottom: 8 }}>
          Watching {rows.length} competitor{rows.length === 1 ? '' : 's'}{brandName ? ` for ${brandName}` : ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => {
            const hasNew = !!(r.newAds && r.newAds.length)
            const ads = hasNew ? r.newAds! : (r.topAds || [])
            return (
              <div key={r.pageId} style={{ background: '#fff', border: `1px solid ${hasNew ? '#f2e3c0' : LINE}`, borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Link href={`/discovery/brand-spy/${r.pageId}`} style={{ fontSize: 13, fontWeight: 700, color: INK, textDecoration: 'none', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.brand}</Link>
                  {hasNew && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#b7791f', background: '#fef6e7', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>🆕 {r.newAds!.length} new</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, color: COLOR[r.status], whiteSpace: 'nowrap' }}>{LABEL[r.status](r.adCount)}</span>
                </div>
                {hasNew && <div style={{ fontSize: 12, color: '#9a6a12', fontWeight: 750, marginTop: 6 }}>{r.brand} launched {r.newAds!.length === 1 ? 'a new ad' : `${r.newAds!.length} new ads`} 👀</div>}
                <Thumbs ads={ads} pageId={r.pageId} brand={r.brand} />
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          {rows.some(r => r.status !== 'live') && (
            <button onClick={fetchNow} disabled={busy} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '5px 13px', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Starting…' : '↻ Fetch their ads now'}</button>
          )}
          {rows.some(r => r.status === 'crawling' || r.status === 'queued') && <span style={{ fontSize: 11, color: '#a7b0a5' }}>New competitors take a little while to load — this updates on its own.</span>}
        </div>
      </>)}

      {rows.length === 0 && unlinked.length > 0 && brandId && (
        <div style={{ background: '#fef6e7', border: '1px solid #f2e3c0', borderRadius: 12, padding: '12px 14px', marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 750, color: '#9a6a12', marginBottom: 8 }}>You’re watching {unlinked.length} competitor{unlinked.length === 1 ? '' : 's'} not linked to {brandName || 'this brand'}. Link the ones that actually compete with it:</div>
          {/* Per-competitor — choose which belong to THIS brand (linking all at once was wrong for
              multi-brand founders). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {unlinked.map(u => (
              <div key={u.pageId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #f2e3c0', borderRadius: 9, padding: '6px 8px 6px 11px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.brand}</span>
                <button onClick={() => linkOne(u)} disabled={!!linking} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '4px 12px', fontSize: 11.5, fontWeight: 800, fontFamily: 'inherit', cursor: linking ? 'default' : 'pointer', opacity: linking && linking !== u.pageId ? 0.5 : 1, whiteSpace: 'nowrap' }}>{linking === u.pageId ? 'Linking…' : `Link → ${brandName || ''}`.trim()}</button>
              </div>
            ))}
          </div>
          {unlinked.length > 1 && <button onClick={linkAll} disabled={busy} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', padding: 0 }}>{busy ? 'Linking…' : `Link all ${unlinked.length} to ${brandName || 'this brand'}`}</button>}
        </div>
      )}
    </div>
  )
}
