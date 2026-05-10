'use client'
/**
 * Ad Detail page (Atria-style 3-column layout).
 *   [ad preview] [ad info] [save details + Atria-AI clone]
 */
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { X, Bookmark, Link as LinkIcon, Download, Sparkles, ExternalLink } from 'lucide-react'

interface Creative {
  position: number
  asset_type: 'image' | 'video'
  r2_url: string
  hash: string | null
}

interface Ad {
  id: string
  pageId: string
  pageName: string
  body: string
  title: string
  caption: string
  description: string
  snapshotUrl: string
  thumbnailUrl: string | null
  videoUrl: string | null
  creatives: Creative[]
  startDate: string
  stopDate: string | null
  platforms: string[]
  languages: string[]
  isActive: boolean
  daysRunning: number
  country: string
  format: string
  industries: string[]
  cta: string | null
  mediaType: string
}

const PLATFORM_ICONS: Record<string, string> = {
  facebook: '📘', instagram: '📸', audience_network: '🌐', messenger: '💬',
}

export default function AdDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [ad, setAd] = useState<Ad | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tags, setTags] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!params?.id) return
    ;(async () => {
      try {
        const res = await fetch(`/api/discovery/ad/${params.id}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        setAd(j.ad)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [params?.id])

  const copyLink = async () => {
    if (!ad) return
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  if (loading) return <div style={{ padding: 28, color: '#6b7280' }}>Loading…</div>
  if (error) return <div style={{ padding: 28, color: '#c0392b' }}>Error: {error}</div>
  if (!ad) return <div style={{ padding: 28 }}>Ad not found.</div>

  const slides: { type: 'image' | 'video'; url: string }[] = (() => {
    if (ad.creatives && ad.creatives.length > 0) {
      const sorted = [...ad.creatives].sort((a, b) => {
        if (a.asset_type !== b.asset_type) return a.asset_type === 'image' ? -1 : 1
        return a.position - b.position
      })
      return sorted.map((c) => ({ type: c.asset_type, url: c.r2_url }))
    }
    const fallback: { type: 'image' | 'video'; url: string }[] = []
    if (ad.thumbnailUrl) fallback.push({ type: 'image', url: ad.thumbnailUrl })
    if (ad.videoUrl) fallback.push({ type: 'video', url: ad.videoUrl })
    return fallback
  })()

  const brandPicture = ad.pageId ? `https://graph.facebook.com/${ad.pageId}/picture?type=large` : null
  const startFmt = ad.startDate ? new Date(ad.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const endFmt = ad.stopDate ? new Date(ad.stopDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const runningTime = ad.daysRunning > 0 ? `${ad.daysRunning} days` : '—'

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto', minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.back()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#6b7280' }}>
            <X size={18} />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>Ad Detail</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: 'linear-gradient(90deg, #f97316, #ea580c)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Bookmark size={14} /> Save
          </button>
          <button onClick={copyLink}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: '#fff', color: '#111', border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            <LinkIcon size={14} /> {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>

      {/* 3-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px 360px', gap: 18, alignItems: 'start' }}>
        {/* ── LEFT: ad preview ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a3a1a', overflow: 'hidden', flexShrink: 0 }}>
              {brandPicture && <img src={brandPicture} alt={ad.pageName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{ad.pageName}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Sponsored</div>
            </div>
            <button style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#111', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              ♡ Follow
            </button>
          </div>
          <div style={{ padding: '0 16px 8px', fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db' }} />
            <span>{startFmt} – {ad.stopDate ? endFmt : 'Present'}</span>
          </div>
          {ad.body && (
            <div style={{ padding: '0 16px 14px', fontSize: 13, color: '#1f2937', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {ad.body}
            </div>
          )}
          <DetailMedia slides={slides} adId={ad.id} />
          {(ad.title || ad.caption) && (
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {ad.caption && <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'lowercase' }}>{ad.caption}</div>}
                {ad.title && <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginTop: 2 }}>{ad.title}</div>}
                {ad.description && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{ad.description}</div>}
              </div>
              <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer"
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0', color: '#111', textDecoration: 'none' }}>
                {ad.cta || 'Learn more'}
              </a>
            </div>
          )}
        </div>

        {/* ── MIDDLE: ad info ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{ad.isActive ? 'Active' : 'Inactive'}</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>· Ad ID: {ad.id}</span>
            <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280' }}>
              <ExternalLink size={13} />
            </a>
          </div>

          <InfoRow label="Start date" value={startFmt} />
          <InfoRow label="End date" value={ad.stopDate ? endFmt : '—'} />
          <InfoRow label="Running time" value={runningTime} />
          <InfoRow label="Platforms" value={
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {ad.platforms.map(p => <span key={p} style={{ fontSize: 16 }} title={p}>{PLATFORM_ICONS[p] || '🌐'}</span>)}
            </div>
          } />
          <InfoRow label="Display format" value={ad.format} />
          <InfoRow label="Categories" value={(ad.industries || []).join(', ') || '—'} />
        </div>

        {/* ── RIGHT: save details + Atria AI ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 12 }}>Save Details</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>🏷 Tags</div>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="Add tags..."
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', marginBottom: 14 }}
            />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>📋 Boards</div>
            <select style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', marginBottom: 14, background: '#fff' }}>
              <option>Select boards</option>
            </select>
            <button style={{ width: '100%', padding: '10px', background: 'linear-gradient(90deg, #f97316, #ea580c)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Confirm
            </button>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>Selfmade AI</div>
              <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>⚡</span> 238 credits
              </div>
            </div>
            <button style={{
              width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: 'linear-gradient(135deg, #2d1b4e 0%, #4a1a3a 50%, #1a3a1a 100%)',
              color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Sparkles size={16} /> Clone ad
            </button>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>Comments (0)</div>
              <span style={{ fontSize: 11, color: '#6b7280' }}>Only visible in workspace</span>
            </div>
            <input placeholder="Add a comment..." style={{ marginTop: 10, width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{value}</div>
    </div>
  )
}

function DetailMedia({ slides, adId }: { slides: { type: 'image' | 'video'; url: string }[]; adId: string }) {
  const [idx, setIdx] = useState(0)
  if (slides.length === 0) return <div style={{ aspectRatio: '4/5', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>No media</div>
  const slide = slides[idx]
  const total = slides.length

  const download = () => {
    const a = document.createElement('a')
    a.href = slide.url
    a.download = `${adId}-${slide.type}-${idx}.${slide.type === 'video' ? 'mp4' : 'jpg'}`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div style={{ position: 'relative', background: '#000', overflow: 'hidden', lineHeight: 0 }}>
      {slide.type === 'image' ? (
        <img src={slide.url} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
      ) : (
        <video src={slide.url} controls preload="metadata" style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 600 }} />
      )}
      {/* Download dropdown */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}>
        <button onClick={download}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Download size={12} /> Download
        </button>
      </div>
      {total > 1 && (
        <>
          <button onClick={() => setIdx(i => (i - 1 + total) % total)} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 18, fontWeight: 700, padding: 0, zIndex: 4 }}>‹</button>
          <button onClick={() => setIdx(i => (i + 1) % total)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 18, fontWeight: 700, padding: 0, zIndex: 4 }}>›</button>
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5, zIndex: 4 }}>
            {slides.map((_, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,0.5)' }} />)}
          </div>
        </>
      )}
    </div>
  )
}
