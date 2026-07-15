'use client'
/**
 * Trending — "what's hot right now," Motion-style but powered by our own performance data (hybrid
 * rank: performance_score + recency + save velocity), scoped by industry via the embedded dropdown.
 * Each card ties straight into generation with a "Clone" action (our edge over Motion).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Flame, Search, Sparkles, Play, ChevronDown, Loader2, ArrowUpRight } from 'lucide-react'
import CloneModal from '../discovery/CloneModal'
import CloneVideoModal from '../discovery/CloneVideoModal'
import HoverScrubVideo from '@/components/discovery/HoverScrubVideo'

type Ad = { adId: string; pageId: string; pageName: string; image: string | null; isVideo: boolean; videoUrl?: string | null; score: number; format: string | null; hook: string | null; saves: number; isActive: boolean; daysRunning: number | null }
type BrandW = { pageId: string; pageName: string; adCount: number; activeCount: number; avgScore: number; image: string | null }
type FormatW = { format: string; count: number; samples: string[] }

const DARK = '#14281a'

/** R2 URLs load as-is (Cloudflare CDN); external (Meta) URLs go through weserv resized + hotlink-safe. */
function img(url: string | null, w = 400): string {
  if (!url) return ''
  if (/\.r2\.dev\/|r2\.cloudflarestorage|\/\/cdn\.|pub-.*\.r2\.dev/.test(url) || url.includes(process.env.NEXT_PUBLIC_R2_PUBLIC_HOST || '@@none@@')) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp`
}
const initials = (s: string) => (s || '?').trim().slice(0, 1).toUpperCase()

export default function TrendingPage() {
  const [niches, setNiches] = useState<string[]>([])
  const [niche, setNiche] = useState<string>('')          // '' = All
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [nicheQuery, setNicheQuery] = useState('')
  const [cloneAd, setCloneAd] = useState<Ad | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)   // hover-to-play video in the grid
  const [visible, setVisible] = useState(12)
  const [brands, setBrands] = useState<BrandW[]>([])
  const [formats, setFormats] = useState<FormatW[]>([])
  const [drill, setDrill] = useState<{ kind: 'brand' | 'format'; id: string; label: string } | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/discovery/niches').then(r => r.json()).then(j => setNiches(j.niches || [])).catch(() => {})
  }, [])

  const load = useCallback(async (n: string, d?: { kind: 'brand' | 'format'; id: string } | null) => {
    setLoading(true); setVisible(12)
    const param = d ? (d.kind === 'brand' ? `&pageId=${encodeURIComponent(d.id)}` : `&format=${encodeURIComponent(d.id)}`) : ''
    try {
      const j = await fetch(`/api/discovery/trending?niche=${encodeURIComponent(n)}${param}&limit=48`).then(r => r.json())
      setAds(j.ads || [])
    } catch { setAds([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(niche, drill) }, [niche, drill, load])

  // Brands + formats re-scope with the industry filter (not the brand drill-down).
  useEffect(() => {
    fetch(`/api/discovery/trending/brands?niche=${encodeURIComponent(niche)}`).then(r => r.json()).then(j => setBrands(j.brands || [])).catch(() => setBrands([]))
    fetch(`/api/discovery/trending/formats?niche=${encodeURIComponent(niche)}`).then(r => r.json()).then(j => setFormats(j.formats || [])).catch(() => setFormats([]))
  }, [niche])

  // Close the industry picker on outside click.
  useEffect(() => {
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const filteredNiches = niches.filter(n => !nicheQuery || n.toLowerCase().includes(nicheQuery.toLowerCase()))
  const shown = ads.slice(0, visible)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Hero title with embedded industry filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Flame size={24} color="#e8590c" />
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Discover what's trending in
          <span ref={pickerRef} style={{ position: 'relative' }}>
            <button onClick={() => setPickerOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: DARK, fontSize: 26, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 4, fontFamily: 'inherit', padding: 0 }}>
              {niche || 'All'} <ChevronDown size={20} />
            </button>
            {pickerOpen && (
              <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, width: 260, maxHeight: 380, overflow: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,.12)', padding: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', border: '1px solid #eee', borderRadius: 8, marginBottom: 6 }}>
                  <Search size={14} color="#9ca3af" />
                  <input autoFocus value={nicheQuery} onChange={e => setNicheQuery(e.target.value)} placeholder="Search industries…" style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, fontFamily: 'inherit' }} />
                </div>
                <button onClick={() => { setNiche(''); setDrill(null); setPickerOpen(false); setNicheQuery('') }} style={nOpt(niche === '')}>All</button>
                {filteredNiches.map(n => (
                  <button key={n} onClick={() => { setNiche(n); setDrill(null); setPickerOpen(false); setNicheQuery('') }} style={nOpt(niche === n)}>{n}</button>
                ))}
              </div>
            )}
          </span>
        </h1>
      </div>
      <p style={{ fontSize: 13.5, color: '#6b7280', marginTop: 6 }}>Stay ahead of your competition — the top-performing ads {niche ? `in ${niche}` : 'across every industry'} right now.</p>

      {/* Brands to Watch */}
      {brands.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#171717', margin: 0 }}>Brands to Watch</h2>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: '2px 0 12px' }}>Brands with the most top-performing ads {niche ? `in ${niche}` : 'right now'} — click to see their creatives.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {brands.map(b => {
              const on = drill?.kind === 'brand' && drill.id === b.pageId
              return (
                <button key={b.pageId} onClick={() => setDrill(on ? null : { kind: 'brand', id: b.pageId, label: b.pageName })}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 22, border: `1px solid ${on ? DARK : '#e5e7eb'}`, background: on ? '#eef5eb' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {b.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img(b.image, 64)} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{initials(b.pageName)}</span>}
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{b.pageName}</span>
                  <span style={{ fontSize: 11.5, color: '#9ca3af' }}>{b.adCount} ads</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Section */}
      <div style={{ marginTop: 26, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#171717', margin: 0, textTransform: drill?.kind === 'format' ? 'capitalize' : 'none' }}>{drill ? (drill.kind === 'format' ? `Top ${drill.label} ads` : `Top ads from ${drill.label}`) : 'Top trending ads this week'}</h2>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: '2px 0 0' }}>Ranked by performance + how fresh and active they are.</p>
        </div>
        {drill && <button onClick={() => setDrill(null)} style={{ padding: '7px 14px', borderRadius: 20, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>← All trending</button>}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', padding: 40, justifyContent: 'center' }}><Loader2 size={18} className="spin" /> Loading trending ads…</div>
      ) : ads.length === 0 ? (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center', fontSize: 14 }}>No trending ads {niche ? `in ${niche} ` : ''}yet — the more the crawler + classifier process, the richer this gets.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%), 1fr))', gap: 14 }}>
            {shown.map((ad, i) => (
              <article key={ad.adId} style={{ borderRadius: 16, position: 'relative', background: '#fff', border: '1px solid #eef0ee', overflow: 'hidden' }}>
                <div
                  onMouseEnter={() => ad.isVideo && ad.videoUrl && setHoverId(ad.adId)}
                  onMouseLeave={() => setHoverId(h => (h === ad.adId ? null : h))}
                  style={{ position: 'relative', aspectRatio: '3/4', background: '#0d120e', overflow: 'hidden' }}
                >
                  {ad.isVideo && ad.videoUrl
                    ? <HoverScrubVideo src={ad.videoUrl} poster={ad.image ? img(ad.image) : undefined} brandBg="#0d120e" initials={initials(ad.pageName)} />
                    : ad.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img(ad.image)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%' }} />}
                  {/* rank + performance badge */}
                  <span style={{ position: 'absolute', top: 8, left: 8, background: i < 3 ? '#e8590c' : 'rgba(0,0,0,.62)', color: '#fff', borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Flame size={11} /> {Math.round(ad.score * 100)}
                  </span>
                  {ad.format && <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,.92)', color: '#374151', borderRadius: 20, fontSize: 10, fontWeight: 700, padding: '3px 7px', textTransform: 'capitalize' }}>{ad.format}</span>}
                  {/* Clone CTA on hover-ish (always visible bottom-right for discoverability) */}
                  <button onClick={() => setCloneAd(ad)} style={{ position: 'absolute', bottom: 8, right: 8, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#dffe95', color: DARK, border: 'none', borderRadius: 20, fontSize: 11.5, fontWeight: 800, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
                    <Sparkles size={12} /> Remake
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', height: 44 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{initials(ad.pageName)}</div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{ad.pageName}</span>
                  {ad.isActive && <span title="Currently running" style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />}
                </div>
              </article>
            ))}
          </div>
          {visible < ads.length && (
            <div style={{ textAlign: 'center', marginTop: 22 }}>
              <button onClick={() => setVisible(v => v + 12)} style={{ padding: '9px 20px', borderRadius: 20, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>See {Math.min(12, ads.length - visible)} more</button>
            </div>
          )}
        </>
      )}

      {/* Popular Visual Formats */}
      {formats.length > 0 && (
        <section style={{ marginTop: 40, borderTop: '1px solid #f0f0f0', paddingTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#171717', margin: 0 }}>Popular visual formats</h2>
          <p style={{ fontSize: 12.5, color: '#9ca3af', margin: '2px 0 14px' }}>The ad formats top performers are using {niche ? `in ${niche}` : 'right now'} — set an Angle in the Studio to match one.</p>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            {formats.map(f => (
              <button key={f.format} onClick={() => { setDrill({ kind: 'format', id: f.format, label: f.format }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                style={{ width: 210, flexShrink: 0, border: '1px solid #eef0ee', borderRadius: 14, overflow: 'hidden', background: '#fff', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ display: 'grid', gridTemplateColumns: f.samples.length >= 2 ? '1fr 1fr' : '1fr', gap: 2, aspectRatio: '16/10', background: '#0d120e' }}>
                  {(f.samples.length ? f.samples.slice(0, f.samples.length >= 3 ? 3 : f.samples.length) : []).map((s, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={img(s, 220)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', gridColumn: f.samples.length === 3 && i === 0 ? 'span 2' : undefined }} />
                  ))}
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', textTransform: 'capitalize' }}>{f.format}</div>
                    <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{f.count} top ad{f.count === 1 ? '' : 's'}</div>
                  </div>
                  <ArrowUpRight size={16} color="#9ca3af" />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {cloneAd && (cloneAd.isVideo
        ? <CloneVideoModal sourceAdId={cloneAd.adId} sourcePoster={cloneAd.image ? img(cloneAd.image) : undefined} onClose={() => setCloneAd(null)} />
        : <CloneModal ad={{ id: cloneAd.adId, pageId: cloneAd.pageId, pageName: cloneAd.pageName }} onClose={() => setCloneAd(null)} />)}
    </div>
  )
}

const nOpt = (on: boolean): React.CSSProperties => ({ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 7, border: 'none', background: on ? '#eef5eb' : 'transparent', color: on ? DARK : '#374151', fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' })
