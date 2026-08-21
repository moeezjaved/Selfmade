'use client'
/**
 * AdPreviewLightbox — a tap-to-view overlay for a competitor ad on the brief. Clicking an ad thumbnail
 * used to navigate to Brand Spy; now it opens the creative right here (image large, or the video playing).
 * Shared by BriefScan (competitor rows) and WatchingCompetitors (the watched-brand ad grid).
 */
import { useEffect } from 'react'

export type PreviewAd = { image?: string | null; videoUrl?: string | null; brand?: string | null } | null

const isVid = (u?: string | null) => !!u && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)

export default function AdPreviewLightbox({ ad, onClose }: { ad: PreviewAd; onClose: () => void }) {
  useEffect(() => {
    if (!ad) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ad, onClose])
  if (!ad) return null

  const videoSrc = ad.videoUrl || (isVid(ad.image) ? ad.image : null)
  return (
    <div onClick={onClose} role="dialog" aria-modal
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(13,12,10,.82)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: 'min(92vw,520px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: -40, right: 0, background: 'rgba(255,255,255,.14)', color: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        {videoSrc ? (
          <video src={videoSrc} poster={!isVid(ad.image) && ad.image ? ad.image : undefined} controls autoPlay loop playsInline
            style={{ maxWidth: '100%', maxHeight: '86vh', borderRadius: 14, background: '#000', display: 'block' }} />
        ) : ad.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={ad.image} alt={ad.brand || 'ad'} style={{ maxWidth: '100%', maxHeight: '86vh', borderRadius: 14, display: 'block', objectFit: 'contain', background: '#0d120e' }} />
        ) : (
          <div style={{ color: '#fff', fontSize: 14 }}>No preview available.</div>
        )}
        {ad.brand && <div style={{ color: 'rgba(255,255,255,.72)', fontSize: 13, marginTop: 12, fontWeight: 600 }}>{ad.brand}</div>}
      </div>
    </div>
  )
}
