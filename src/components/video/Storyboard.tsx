'use client'

/**
 * Storyboard-before-generation (Phase 2). Renders a job's analysis (beat_sheet + script) as editable
 * scene cards BEFORE Seedance runs. On a 'review' job, editing the script + hitting Generate approves
 * it (spends credits, worker generates only the approved plan). Read-only for already-generated jobs.
 */
import React, { useEffect, useState } from 'react'

type Scene = { index: number; role: string; time: string | null; action: string; scriptLine: string; thumb?: string | null; preview?: string | null }
type Board = {
  jobId: string; status: string; editable: boolean; hookType: string | null; suggestedMode: string
  sceneCount: number; durationSeconds: number | null; script: string; scenes: Scene[]
}

const ROLE_LABEL: Record<string, string> = { hook: 'Hook', body: 'Body', cta: 'CTA' }

export default function Storyboard({ jobId }: { jobId?: string }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [generating, setGenerating] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const id = jobId || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('jobId') : null)
    fetch(`/api/discovery/clone-video/storyboard${id ? `?jobId=${id}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else { setBoard(j); setScenes(j.scenes || []) } })
      .catch((e) => setErr(String(e)))
  }, [jobId])

  const [busy, setBusy] = useState<Record<number, boolean>>({})
  // Generate (or regenerate) a keyframe for one scene — a cheap image preview of what THIS scene will
  // look like with your product/creator, BEFORE paying video prices. The worker animates it on approve.
  const genKeyframe = async (s: Scene) => {
    if (!board?.editable || busy[s.index]) return
    setBusy((b) => ({ ...b, [s.index]: true }))
    try {
      const r = await fetch('/api/discovery/clone-video/keyframe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: board.jobId, sceneIndex: s.index, action: s.action }),
      }).then((x) => x.json())
      if (r?.preview) setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, preview: r.preview } : x))
    } catch { /* leave as-is */ } finally { setBusy((b) => ({ ...b, [s.index]: false })) }
  }

  const move = (i: number, dir: -1 | 1) => setScenes((prev) => {
    const j = i + dir
    if (j < 0 || j >= prev.length) return prev
    const next = [...prev];[next[i], next[j]] = [next[j], next[i]]; return next
  })
  const remove = (index: number) => setScenes((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.index !== index)))

  const generate = async () => {
    if (!board?.editable) return
    setGenerating(true)
    const script = scenes.map((s) => s.scriptLine).join(' ').trim()
    // Scene count follows the edited storyboard, so the worker shoots exactly the scenes you kept.
    await fetch('/api/discovery/clone-video/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: board.jobId, script, mode: board.suggestedMode, sceneCount: scenes.length }),
    }).catch(() => {})
    setGenerating(false)
  }

  if (err) return <div style={{ color: '#a33', fontSize: 14 }}>Couldn’t load a storyboard: {err}</div>
  if (!board || !mounted) return <div style={{ fontSize: 14, color: '#68756b' }}>Loading the storyboard…</div>

  const chip: React.CSSProperties = { fontSize: 12, color: '#20321c', background: '#eef7d6', borderRadius: 999, padding: '4px 11px', fontWeight: 700 }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {board.hookType && <span style={chip}>Hook: {board.hookType}</span>}
        <span style={chip}>{board.suggestedMode === 'faithful' ? 'Cinematic' : 'UGC'}</span>
        <span style={chip}>{board.sceneCount} scenes</span>
        {board.durationSeconds && <span style={chip}>~{Math.round(board.durationSeconds)}s</span>}
        <span style={{ ...chip, background: board.editable ? '#dffe95' : '#f0efe8', color: board.editable ? '#17251c' : '#68756b' }}>
          {board.editable ? 'Editable — nothing generated yet' : 'Already generated (read-only)'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {scenes.map((s, i) => (
          <div key={s.index} style={{ display: 'grid', gridTemplateColumns: '56px 96px 1fr', gap: 14, border: '1px solid #e6ece2', borderRadius: 12, padding: '14px 16px', background: '#fff', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 26, color: '#17251c', lineHeight: 1 }}>{i + 1}</div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872' }}>{ROLE_LABEL[s.role] || 'Scene'}</div>
              {s.time && <div style={{ fontSize: 10, color: '#a7b09e', fontFamily: 'ui-monospace, Menlo, monospace' }}>{s.time}</div>}
              {board.editable && (
                <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" style={{ border: '1px solid #e6ece2', background: '#fff', borderRadius: 5, width: 20, height: 20, cursor: i === 0 ? 'default' : 'pointer', color: '#66755d', fontSize: 11, lineHeight: 1, padding: 0 }}>↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label="Move down" style={{ border: '1px solid #e6ece2', background: '#fff', borderRadius: 5, width: 20, height: 20, cursor: i === scenes.length - 1 ? 'default' : 'pointer', color: '#66755d', fontSize: 11, lineHeight: 1, padding: 0 }}>↓</button>
                  <button onClick={() => remove(s.index)} disabled={scenes.length <= 1} aria-label="Remove scene" style={{ border: '1px solid #f0dada', background: '#fff', borderRadius: 5, width: 20, height: 20, cursor: scenes.length <= 1 ? 'default' : 'pointer', color: '#b3564e', fontSize: 11, lineHeight: 1, padding: 0 }}>✕</button>
                </div>
              )}
            </div>
            <div>
              <div style={{ width: 96, aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', background: '#eef2ec', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {(s.preview || s.thumb)
                  ? <img src={s.preview || s.thumb || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 20, color: '#b4bdad' }}>▦</span>}
                {s.preview && <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', color: '#17251c', background: '#dffe95', borderRadius: 4, padding: '1px 4px' }}>YOURS</span>}
                {busy[s.index] && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#3a7d2c', fontWeight: 700 }}>…</div>}
              </div>
              {board.editable && (
                <button onClick={() => genKeyframe(s)} disabled={busy[s.index]} style={{ width: 96, marginTop: 5, fontSize: 10.5, fontWeight: 700, color: '#20321c', background: '#fff', border: '1px solid #d7ddd2', borderRadius: 6, padding: '4px 0', cursor: busy[s.index] ? 'default' : 'pointer' }}>
                  {busy[s.index] ? 'Generating…' : s.preview ? 'Regenerate' : 'Preview scene'}
                </button>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: '#66755d', marginBottom: 8 }}>{s.action || 'Scene action'}</div>
              <textarea
                value={s.scriptLine}
                disabled={!board.editable}
                onChange={(e) => setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, scriptLine: e.target.value } : x))}
                rows={2}
                style={{ width: '100%', fontSize: 13.5, lineHeight: 1.5, color: '#20321c', border: '1px solid #e6ece2', borderRadius: 8, padding: '8px 10px', resize: 'vertical', background: board.editable ? '#fff' : '#faf9f5', fontFamily: 'inherit' }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <button onClick={generate} disabled={!board.editable || generating}
          style={{ fontSize: 14, fontWeight: 800, padding: '11px 22px', borderRadius: 999, cursor: board.editable ? 'pointer' : 'default', border: 'none', background: board.editable ? '#17251c' : '#d7ddd2', color: '#fff' }}>
          {generating ? 'Starting generation…' : board.editable ? 'Approve & generate →' : 'Already generated'}
        </button>
        <span style={{ fontSize: 12, color: '#8a9880' }}>Editing the storyboard is free. Seedance only shoots once you approve.</span>
      </div>
    </div>
  )
}
