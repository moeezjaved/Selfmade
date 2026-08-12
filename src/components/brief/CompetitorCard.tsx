'use client'
/**
 * CompetitorCard — "your rivals' winning ad right now" on the Morning Brief.
 *
 * Fetches /api/meta/competitor-moves (pure DB, zero Graph calls) and shows the single strongest
 * signal across all watched rivals: the ad they've run longest, hardest, and are still paying for.
 * Honest framing — we infer "winning" from behaviour (longevity + variants + still-live), never
 * claim their ROAS. Two actions:
 *   · "See their ads"  → Brand Spy for that rival (browse before deciding)
 *   · "Make it mine →" → the Studio remake flow seeded with this exact ad + the rival's name;
 *     the founder picks THEIR brand + product photos there, the clone runs, and the result view
 *     offers "Run it on Facebook →" (prefilled M4 — budget always confirmed by the founder).
 *
 * SEPARATE from "What Mello would do" by design: those cards are own-account numbers only; this
 * one is competitor intelligence. The two never mix.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import HoverScrubVideo from '@/components/discovery/HoverScrubVideo'

const INK = '#111111', MUTED = '#6b6b6b', LINE = '#ecede8', FOREST = '#141d15', LIME = '#ff5a2c', FAINT = '#9aa79a'
const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

type Move = {
  adId: string; pageId: string; brandName: string; title: string | null; hook: string | null
  daysRunning: number; variants: number; isActive: boolean; isVideo: boolean
  image: string | null; videoUrl: string | null; why: string
}

const mineHref = (m: Move) => {
  const q = new URLSearchParams({ ad: m.adId, brand: m.brandName })
  if (m.image) q.set('img', m.image)
  if (m.isVideo) { q.set('type', 'video'); if (m.videoUrl) q.set('vid', m.videoUrl) }
  return `/studio?${q.toString()}`
}

export default function CompetitorCard({ brandId }: { brandId?: string | null }) {
  const [moves, setMoves] = useState<Move[] | null>(null)
  useEffect(() => {
    let alive = true
    setMoves(null)   // clear the previous brand's moves on switch so stale rival data never lingers
    fetch(`/api/meta/competitor-moves${brandId ? `?brand=${encodeURIComponent(brandId)}` : ''}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(j => { if (alive && j && Array.isArray(j.moves)) setMoves(j.moves) })
      .catch(() => {})
    return () => { alive = false }
  }, [brandId])

  // Nothing to show (no watched rivals, or none with a real run) → render nothing, never clutter.
  if (!moves || !moves.length) return null
  const hero = moves[0]
  const rest = moves.slice(1)

  return (
    <div className="bsx-e" style={{ ...card, marginBottom: 24, overflow: 'hidden', animationDelay: '.4s' }}>
      <div style={{ padding: '18px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15.5, fontWeight: 750, color: INK }}>Your rivals&rsquo; winning ad right now</div>
          <span style={{ fontSize: 11.5, color: FAINT, fontWeight: 650 }}>inferred from how long &amp; hard they run it</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '14px 22px 18px', flexWrap: 'wrap' }}>
        {/* the ad itself — playable when it's a video, Discovery-style */}
        <div style={{ width: 168, flexShrink: 0 }}>
          <div style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${LINE}`, aspectRatio: '4/5', background: '#0d120e' }}>
            {hero.isVideo && hero.videoUrl
              ? <HoverScrubVideo src={hero.videoUrl} poster={hero.image || undefined} initials={hero.brandName.charAt(0)} />
              : hero.image
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={hero.image} alt={hero.brandName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: LIME, fontSize: 28, fontWeight: 800 }}>{hero.brandName.charAt(0)}</div>}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.015em', color: INK, lineHeight: 1.3 }}>{hero.brandName}</div>
          <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, marginTop: 4 }}>{hero.why}</div>
          {hero.hook && <div style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>The hook: <span style={{ color: MUTED, fontWeight: 650 }}>{hero.hook.replace(/_/g, ' ')}</span></div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Link href={mineHref(hero)} style={{ background: FOREST, color: LIME, borderRadius: 100, padding: '10px 20px', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>
              Make it mine →
            </Link>
            <Link href={`/discovery/brand-spy/${hero.pageId}`} style={{ background: '#f2f4ef', color: INK, borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              See their ads
            </Link>
          </div>
          <div style={{ fontSize: 11.5, color: FAINT, marginTop: 10 }}>Make it mine = the same concept rebuilt with your brand. You approve it, then confirm a budget before anything spends.</div>
        </div>
      </div>

      {/* the runners-up — one quiet row each */}
      {rest.length > 0 && (
        <div style={{ borderTop: `1px solid ${LINE}`, padding: '4px 22px' }}>
          {rest.map((m) => (
            <div key={m.adId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: m === rest[0] ? 'none' : `1px solid ${LINE}` }}>
              {m.image
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.image} alt="" style={{ width: 34, height: 42, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: `1px solid ${LINE}` }} />
                : <span style={{ width: 34, height: 42, borderRadius: 8, background: FOREST, color: LIME, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{m.brandName.charAt(0)}</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: INK }}>{m.brandName}</span>
                <span style={{ display: 'block', fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.why}</span>
              </span>
              <Link href={mineHref(m)} style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 750, color: FOREST, textDecoration: 'none' }}>Make it mine →</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
