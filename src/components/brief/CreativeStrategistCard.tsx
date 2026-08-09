'use client'
/**
 * CreativeStrategistCard — the "what to make next" card on the Morning Brief. Fuses your ad performance
 * (winners + fatigue) with rivals' winning angles into 1–3 concrete ideas, each one click into the Studio.
 * Self-fetching + cached server-side; advisory only (making starts in the Studio, budget always confirmed).
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'

const INK = '#17251c', MUTED = '#6b6b6b', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#17251c', LIME = '#dffe95', GREEN = '#3f8f4f'

type Idea = {
  title: string; format: string; why: string; basedOn: 'fatigue' | 'winner' | 'competitor'
  reference: { kind: 'competitor' | 'ours'; label: string; brand?: string; image?: string | null } | null
  priority: 'high' | 'med' | 'low'; studioHref: string
}
type Strategy = { summary: string; ideas: Idea[]; reasoned: boolean; generatedAt: string }

const BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  fatigue: { bg: '#fdecec', fg: '#c0392b', label: 'REPLACE A TIRING AD' },
  winner: { bg: '#eaf3de', fg: '#3b6d11', label: 'SCALE A WINNER' },
  competitor: { bg: '#eef4ff', fg: '#2f5bd0', label: 'STEAL A RIVAL ANGLE' },
}

export default function CreativeStrategistCard({ brandId }: { brandId?: string | null }) {
  const [data, setData] = useState<Strategy | null>(null)
  const [loading, setLoading] = useState(true)

  const load = (fresh = false) => {
    setLoading(true)
    const q = new URLSearchParams()
    if (brandId) q.set('brand', brandId)
    if (fresh) q.set('fresh', '1')
    fetch(`/api/creative/strategy${q.toString() ? `?${q}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(j => { if (j && !j.error) setData(j) })
      .catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Render NOTHING until there are real ideas — never a "Reading…" placeholder that later collapses to
  // null (that collapse jumped the whole brief up, reading as a blink, especially when the strategy call
  // times out empty). The card simply appears once it has content; no loading shell, no layout jump.
  if (!data || data.ideas.length === 0) return null

  const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

  return (
    <div className="bsx-e" style={{ ...card, marginBottom: 24, overflow: 'hidden', animationDelay: '.4s' }}>
      <div style={{ padding: '16px 22px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: '#9aa79a' }}>🎨 What to make next</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginTop: 4, maxWidth: 520 }}>
            {loading && !data ? 'Reading your ads + the market…' : data?.summary}
          </div>
        </div>
        {data && <button onClick={() => load(true)} disabled={loading} style={{ background: '#f2f4ef', color: INK, border: 'none', borderRadius: 100, padding: '5px 12px', fontSize: 11.5, fontWeight: 750, fontFamily: 'inherit', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? '…' : '↻'}</button>}
      </div>

      {data && data.ideas.length > 0 && (
        <div style={{ padding: '0 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.ideas.map((idea, i) => {
            const b = BADGE[idea.basedOn] || BADGE.winner
            return (
              <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {idea.reference?.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={idea.reference.image} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: '#eef2ec' }} onError={(e: any) => { e.target.style.display = 'none' }} />
                ) : (
                  <span style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0, background: '#f2f4ef', display: 'grid', placeItems: 'center', fontSize: 20 }}>🎬</span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ background: b.bg, color: b.fg, borderRadius: 6, padding: '2px 7px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em' }}>{b.label}</span>
                    <span style={{ fontSize: 11, color: SUB, fontWeight: 700 }}>{idea.format}</span>
                    {idea.reference?.label && <span style={{ fontSize: 10.5, color: '#a7b0a5', fontWeight: 600 }}>· {idea.reference.label}</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 750, color: INK, lineHeight: 1.35 }}>{idea.title}</div>
                  <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginTop: 4 }}>{idea.why}</div>
                  <Link href={idea.studioHref} style={{ display: 'inline-block', marginTop: 10, background: FOREST, color: LIME, borderRadius: 100, padding: '7px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>Make it →</Link>
                </div>
              </div>
            )
          })}
          <div style={{ fontSize: 11, color: '#a7b0a5' }}>Grounded in your ad performance {data.reasoned ? '+ rivals' : ''}. Ideas only — nothing spends until you confirm a budget in the Studio.</div>
        </div>
      )}
    </div>
  )
}
