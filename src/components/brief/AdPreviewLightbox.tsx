'use client'
/**
 * AdPreviewLightbox — tap a competitor ad on the brief to VIEW it (Discovery-style: hover-scrub video
 * with the white progress line, or the image), with a clear close and a "Make it mine →" remake CTA —
 * instead of navigating away to Brand Spy. Shared by BriefScan + WatchingCompetitors.
 */
import { useEffect } from 'react'
import Link from 'next/link'

export type PreviewAd = {
  image?: string | null; videoUrl?: string | null; brand?: string | null
  adId?: string | null; pageId?: string | null; isVideo?: boolean
} | null

const isVid = (u?: string | null) => !!u && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)

function mineHref(ad: NonNullable<PreviewAd>): string | null {
  if (!ad.adId) return null
  const q = new URLSearchParams({ ad: ad.adId })
  if (ad.brand) q.set('brand', ad.brand)
  if (ad.image && !isVid(ad.image)) q.set('img', ad.image)
  if (ad.isVideo || ad.videoUrl || isVid(ad.image)) { q.set('type', 'video'); if (ad.videoUrl) q.set('vid', ad.videoUrl) }
  return `/studio?${q.toString()}`
}

export default function AdPreviewLightbox({ ad, onClose }: { ad: PreviewAd; onClose: () => void }) {
  useEffect(() => {
    if (!ad) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [ad, onClose])
  if (!ad) return null

  const videoSrc = ad.videoUrl || (isVid(ad.image) ? ad.image! : null)
  const make = mineHref(ad)

  return (
    <div onClick={onClose} role="dialog" aria-modal
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(13,12,10,.84)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: 'min(92vw, 400px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* CLOSE — always visible, inside the frame */}
        <button onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, background: 'rgba(13,12,10,.72)', color: '#fff', border: '1.5px solid rgba(255,255,255,.5)', borderRadius: '50%', width: 34, height: 34, fontSize: 20, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>×</button>

        {/* the creative — a real playing video (controls + autoplay), image otherwise */}
        <div style={{ width: '100%', aspectRatio: '4 / 5', maxHeight: '74vh', borderRadius: 16, overflow: 'hidden', background: '#0d120e' }}>
          {videoSrc
            ? <video src={videoSrc} poster={!isVid(ad.image) && ad.image ? ad.image : undefined} controls autoPlay loop playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }} />
            : ad.image
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={ad.image} alt={ad.brand || 'ad'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#f3ece0', fontSize: 14 }}>{ad.brand || 'Ad'}</div>}
        </div>

        {/* actions — mirror Discovery: remake it, or jump to the brand's full library (always available) */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {make && (
            <Link href={make} style={{ flex: 1, textAlign: 'center', background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '12px 18px', fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Make it mine →</Link>
          )}
          <Link href={ad.pageId ? `/discovery/brand-spy/${ad.pageId}` : '/discovery/brand-spy'}
            style={{ flex: make ? 'none' : 1, textAlign: 'center', background: 'rgba(255,255,255,.14)', color: '#fff', borderRadius: 100, padding: '12px 18px', fontSize: 13.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>See all ads →</Link>
        </div>
      </div>
    </div>
  )
}
