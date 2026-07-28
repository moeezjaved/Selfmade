'use client'
/**
 * UNDERSTAND — the structured "why this works," Qoves-style: labeled rows (hook,
 * emotion, audience, offer, visual), the story arc as a flow, punchy bullets, and
 * an earned confidence number. Fetched from /api/ad-insight (generated once by
 * Mello, cached forever). A soft skeleton shows while Mello reads, so the visitor
 * SEES the work being done — then the report lands.
 */
import { useEffect, useRef, useState } from 'react'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', GREEN = '#2f7a3f', FOREST = '#17251c', LIME = '#dffe95'

type Report = { headline: string; hook?: string; emotion?: string; audience?: string; offer?: string; visualStyle?: string; story: string[]; storyLines?: string[]; bullets: string[]; confidence: number }

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

  // ── THE PLAYED BREAKDOWN — the arc walks itself, like an editor stepping through the commercial.
  // Each beat highlights in sequence (~2.6s) while Mello's line for that beat crossfades below.
  // Motion rules: explains (which beat does what), never decorates; click any beat to jump; ends and
  // stays on the last beat (finite, calm); reduced-motion or an old cached report (no storyLines) →
  // the static chip row, exactly as before. Runs once per report — never loops uninvited.
  const canPlay = !!(d?.storyLines?.length && d.storyLines.length === d.story.length)
  const [beat, setBeat] = useState(-1)            // -1 = not playing (static)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setPlaying(false) }
  const stepFrom = (i: number, total: number) => {
    setBeat(i)
    if (i >= total - 1) { setPlaying(false); return }
    timer.current = setTimeout(() => stepFrom(i + 1, total), 2600)
  }
  const play = (from = 0) => { stop(); setPlaying(true); stepFrom(from, d!.story.length) }
  useEffect(() => {
    if (!canPlay || typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => play(0), 700)      // let the report land first, then walk it once
    return () => { clearTimeout(t); stop() }
  }, [canPlay])   // eslint-disable-line react-hooks/exhaustive-deps

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

          {/* the story arc — played, not printed: the breakdown walks beat by beat like an editor. */}
          {d.story?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '.1em', color: MUTED, textTransform: 'uppercase' }}>The arc</div>
                {canPlay && !playing && (
                  <button onClick={() => play(0)} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>▶ Play the breakdown</button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {d.story.map((s, i) => {
                  const active = canPlay && beat === i
                  const dimmed = canPlay && beat >= 0 && !active
                  return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button onClick={canPlay ? () => play(i) : undefined}
                      style={{ position: 'relative', overflow: 'hidden', border: 'none', fontFamily: 'inherit', cursor: canPlay ? 'pointer' : 'default',
                        background: active ? FOREST : '#f4fbe6', color: active ? LIME : '#2c4a1f', opacity: dimmed ? 0.5 : 1,
                        fontSize: 11.5, fontWeight: 750, borderRadius: 100, padding: '5px 12px',
                        transition: 'background .3s ease, color .3s ease, opacity .3s ease' }}>
                      {s}
                      {/* the beat's own clock — a hairline filling under the active chip */}
                      {active && playing && <span key={beat} style={{ position: 'absolute', left: 0, bottom: 0, height: 2, background: LIME, opacity: .7, animation: 'undbar 2.6s linear forwards' }} />}
                    </button>
                    {i < d.story.length - 1 && <span style={{ color: '#c6cfc4', fontWeight: 800 }}>→</span>}
                  </span>
                  )
                })}
              </div>
              {/* the editor's line for the active beat — crossfades, one at a time, fixed height so nothing jumps */}
              {canPlay && beat >= 0 && d.storyLines?.[beat] && (
                <div key={beat} style={{ marginTop: 9, fontSize: 13, lineHeight: 1.55, color: '#2c342d', fontWeight: 550, minHeight: 20, animation: 'undline .35s ease both' }}>
                  <span style={{ color: GREEN, fontWeight: 900 }}>{d.story[beat]}:</span> {d.storyLines[beat]}
                </div>
              )}
              <style>{`@keyframes undbar{from{width:0}to{width:100%}}
                @keyframes undline{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
                @media (prefers-reduced-motion: reduce){[style*="undbar"],[style*="undline"]{animation:none!important}}`}</style>
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
