'use client'

/**
 * The Remotion editor — a live, scrubbable ad preview (@remotion/player) plus an inspector whose edits
 * are INSTANT and FREE (they mutate the timeline; the Player re-renders, no server, no Seedance).
 * Loads a real finished remake via /api/discovery/clone-video/timeline. Persisting edits + export = Step 4.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Player } from '@remotion/player'
import { AdComposition } from './AdComposition'
import { ASPECT_DIMS, totalDurationInFrames, type Aspect, type Timeline, type Layer } from '@/lib/video/timeline'

const ASPECTS: Aspect[] = ['9:16', '4:5', '1:1', '16:9']
const CTA_COLORS = ['#639922', '#25d366', '#378add', '#d4537e', '#17251c']

export default function RemotionEditor({ jobId }: { jobId?: string }) {
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [id, setId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [renderStatus, setRenderStatus] = useState<string | null>(null)
  const [exports, setExports] = useState<Record<string, string> | null>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const qid = jobId || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('jobId') : null)
    fetch(`/api/discovery/clone-video/timeline${qid ? `?jobId=${qid}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j.error) { setErr(j.error) } else { setTimeline(j.timeline); setNote(j.note || null); setEditable(!!j.editable); setId(j.jobId || null); setRenderStatus(j.render?.status || null); setExports(j.exports || null) } })
      .catch((e) => setErr(String(e)))
  }, [jobId])

  const save = async () => {
    if (!id || !timeline) return
    setSaveState('saving')
    await fetch('/api/discovery/clone-video/timeline', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: id, timeline }) }).catch(() => {})
    setSaveState('saved'); setTimeout(() => setSaveState('idle'), 2000)
  }

  const exportAll = async () => {
    if (!id || !timeline) return
    setRenderStatus('requested')
    await fetch('/api/discovery/clone-video/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: id, timeline, aspects: [timeline.aspect] }) }).catch(() => {})
    // Poll until the render worker finishes (or fails).
    const poll = async () => {
      const j = await fetch(`/api/discovery/clone-video/timeline?jobId=${id}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
      if (!j) return
      setRenderStatus(j.render?.status || null); setExports(j.exports || null)
      if (j.render?.status === 'requested' || j.render?.status === 'rendering') setTimeout(poll, 5000)
    }
    setTimeout(poll, 5000)
  }

  const dims = timeline ? ASPECT_DIMS[timeline.aspect] : ASPECT_DIMS['9:16']
  const durationInFrames = useMemo(() => (timeline ? totalDurationInFrames(timeline) : 300), [timeline])

  const patch = (fn: (t: Timeline) => Timeline) => setTimeline((prev) => (prev ? fn(structuredClone(prev)) : prev))
  const capLayer = timeline?.layers.find((l) => l.type === 'captions') as Extract<Layer, { type: 'captions' }> | undefined
  const ctaLayer = timeline?.layers.find((l) => l.type === 'cta') as Extract<Layer, { type: 'cta' }> | undefined
  const hasLogo = !!timeline?.layers.find((l) => l.type === 'logo')

  if (err) return <div style={{ color: '#a33', fontSize: 14 }}>Couldn’t load a timeline: {err}</div>
  if (!timeline || !mounted) return <div style={{ fontSize: 14, color: '#68756b' }}>Loading the editor…</div>

  const label: React.CSSProperties = { fontSize: 11, letterSpacing: '.05em', textTransform: 'uppercase', color: '#7a8872', marginBottom: 6 }
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e6ece2', borderRadius: 12, padding: '12px 14px' }
  const swatch = (c: string, active: boolean, on: () => void) => (
    <button key={c} onClick={on} aria-label={`colour ${c}`} style={{ width: 24, height: 24, borderRadius: 6, background: c, border: active ? '2px solid #17251c' : '1px solid #d7ddd2', cursor: 'pointer' }} />
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) 1fr', gap: 20, alignItems: 'start' }}>
      <div style={{ background: '#0e1512', borderRadius: 16, padding: 12 }}>
        <Player
          component={AdComposition}
          inputProps={{ timeline }}
          durationInFrames={durationInFrames}
          compositionWidth={dims.width}
          compositionHeight={dims.height}
          fps={timeline.fps || 30}
          style={{ width: '100%', borderRadius: 8 }}
          controls
          loop
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {note && <div style={{ fontSize: 12.5, color: '#8a6d3b', background: '#fbf3e0', border: '1px solid #f0e2c0', borderRadius: 10, padding: '9px 12px' }}>{note}</div>}
        <div style={{ fontSize: 12.5, color: '#3a7d2c', fontWeight: 700 }}>{editable ? 'Every edit below is instant and free — no re-render.' : 'This remake is read-only (rendered before the editor).'}</div>

        <div style={card}>
          <div style={label}>Aspect ratio</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {ASPECTS.map((a) => (
              <button key={a} onClick={() => patch((t) => ({ ...t, aspect: a }))} style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (timeline.aspect === a ? '#639922' : '#d7ddd2'), background: timeline.aspect === a ? '#eaf3de' : '#fff', color: '#20321c', fontWeight: 700 }}>{a}</button>
            ))}
          </div>
        </div>

        {capLayer && (
          <div style={card}>
            <div style={label}>Captions</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['block', 'line'] as const).map((st) => (
                <button key={st} onClick={() => patch((t) => ({ ...t, layers: t.layers.map((l) => l.type === 'captions' ? { ...l, style: st } : l) }))} style={{ fontSize: 12, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (capLayer.style === st ? '#639922' : '#d7ddd2'), background: capLayer.style === st ? '#eaf3de' : '#fff', color: '#20321c', fontWeight: 700, textTransform: 'capitalize' }}>{st}</button>
              ))}
              <span style={{ width: 1, height: 20, background: '#e6ece2', margin: '0 4px' }} />
              {['#ffffff', '#dffe95', '#25d366'].map((c) => swatch(c, capLayer.color === c, () => patch((t) => ({ ...t, layers: t.layers.map((l) => l.type === 'captions' ? { ...l, color: c } : l) }))))}
            </div>
          </div>
        )}

        <div style={card}>
          <div style={label}>Call to action</div>
          {ctaLayer ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={ctaLayer.text} onChange={(e) => patch((t) => ({ ...t, layers: t.layers.map((l) => l.type === 'cta' ? { ...l, text: e.target.value } : l) }))} style={{ flex: 1, minWidth: 120, fontSize: 13, padding: '7px 9px', border: '1px solid #d7ddd2', borderRadius: 6 }} />
              {CTA_COLORS.map((c) => swatch(c, ctaLayer.bg === c, () => patch((t) => ({ ...t, layers: t.layers.map((l) => l.type === 'cta' ? { ...l, bg: c } : l) }))))}
            </div>
          ) : (
            <button onClick={() => patch((t) => { const total = t.scenes.reduce((s, x) => s + x.durationSec, 0); return { ...t, layers: [...t.layers, { type: 'cta', text: 'Shop now →', bg: t.brand?.colors?.cta || '#639922', atSec: Math.max(0, total - 4), durationSec: 4 }] } })} style={{ fontSize: 12.5, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: '1px solid #639922', background: '#eaf3de', color: '#20321c', fontWeight: 700 }}>+ Add a CTA button</button>
          )}
        </div>

        <div style={card}>
          <div style={label}>Logo</div>
          <button onClick={() => patch((t) => hasLogo ? { ...t, layers: t.layers.filter((l) => l.type !== 'logo') } : { ...t, layers: [...t.layers, { type: 'logo', src: t.brand?.logo || '', corner: 'tr', scale: 0.12 }] })} disabled={!hasLogo && !timeline.brand?.logo} style={{ fontSize: 12.5, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: '1px solid #d7ddd2', background: hasLogo ? '#eaf3de' : '#fff', color: '#20321c', fontWeight: 700 }}>{hasLogo ? 'Logo on' : 'Logo off'}</button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #e6ece2', paddingTop: 12 }}>
          <button onClick={save} disabled={!editable || saveState === 'saving'} style={{ fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 999, cursor: 'pointer', border: '1px solid #d7ddd2', background: '#fff', color: '#20321c' }}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save edits'}
          </button>
          <button onClick={exportAll} disabled={!editable || renderStatus === 'requested' || renderStatus === 'rendering'} style={{ fontSize: 13, fontWeight: 800, padding: '9px 18px', borderRadius: 999, cursor: 'pointer', border: 'none', background: '#17251c', color: '#fff' }}>
            {renderStatus === 'requested' || renderStatus === 'rendering' ? 'Rendering…' : `Export ${timeline.aspect} →`}
          </button>
          {renderStatus === 'failed' && <span style={{ fontSize: 12, color: '#a33' }}>Render failed — try again.</span>}
        </div>
        {exports && Object.keys(exports).length > 0 && (
          <div style={{ fontSize: 12.5, color: '#20321c' }}>
            Exports: {Object.entries(exports).map(([a, url]) => (<a key={a} href={url as string} target="_blank" rel="noreferrer" style={{ color: '#3a7d2c', fontWeight: 700, marginRight: 12 }}>{a} ↓</a>))}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: '#8a9880' }}>Edits are free + instant. Export renders once on the droplet.</div>
      </div>
    </div>
  )
}
