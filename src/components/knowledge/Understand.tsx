'use client'
/**
 * UNDERSTAND — the structured "why this works," Qoves-style: labeled rows (hook,
 * emotion, audience, offer, visual), the story arc as a flow, punchy bullets, and
 * an earned confidence number. Fetched from /api/ad-insight (generated once by
 * Mello, cached forever). A soft skeleton shows while Mello reads, so the visitor
 * SEES the work being done — then the report lands.
 */
import { useEffect, useState } from 'react'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', GREEN = '#2f7a3f'

type Report = { headline: string; hook?: string; emotion?: string; audience?: string; offer?: string; visualStyle?: string; story: string[]; bullets: string[]; confidence: number }

export default function Understand({ adId }: { adId: string }) {
  const [d, setD] = useState<Report | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(`/api/ad-insight?adId=${encodeURIComponent(adId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => { if (!alive) return; if (x?.story) setD(x); else setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [adId])
  if (failed) return null

  const rows = d ? ([['Hook', d.hook], ['Emotion', d.emotion], ['Audience', d.audience], ['Offer', d.offer], ['Visual', d.visualStyle]].filter(([, v]) => v) as [string, string][]) : []

  return (
    <div style={{ margin: '18px 0', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase' }}>
          Understand · {d ? (d.headline || 'Why this works') : 'Mello is reading this ad…'}
        </div>
        {d && <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, whiteSpace: 'nowrap' }}>{d.confidence}% confidence</div>}
      </div>

      {!d && (
        <div>
          {[86, 70, 78, 64].map((w, i) => <div key={i} style={{ height: 11, width: `${w}%`, background: '#eef2ec', borderRadius: 6, margin: '10px 0', animation: 'undp 1.2s ease-in-out infinite' }} />)}
          <style>{`@keyframes undp{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
        </div>
      )}

      {d && (
        <>
          {/* labeled rows — the facial-report grid */}
          {rows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1, background: LINE, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
              {rows.map(([k, v]) => (
                <div key={k} style={{ background: '#fff', padding: '11px 13px' }}>
                  <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '.1em', color: MUTED, textTransform: 'uppercase' }}>{k}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 750, color: INK, marginTop: 3, letterSpacing: '-.01em' }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* the story arc — a flow, not a paragraph */}
          {d.story?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '.1em', color: MUTED, textTransform: 'uppercase', marginBottom: 7 }}>The arc</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {d.story.map((s, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ background: '#f4fbe6', color: '#2c4a1f', fontSize: 11.5, fontWeight: 750, borderRadius: 100, padding: '5px 12px' }}>{s}</span>
                    {i < d.story.length - 1 && <span style={{ color: '#c6cfc4', fontWeight: 800 }}>→</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* punchy reasons */}
          {d.bullets?.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {d.bullets.map((b, i) => (
                <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '4px 0', fontSize: 13.5, lineHeight: 1.55, color: '#2c342d', fontWeight: 550 }}>
                  <span style={{ color: GREEN, fontWeight: 900, flexShrink: 0 }}>•</span>{b}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
