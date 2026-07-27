'use client'

/**
 * Storyboard-before-generation (Phase 2). Renders a job's analysis (beat_sheet + script) as editable
 * scene cards BEFORE Seedance runs. On a 'review' job, editing the script + hitting Generate approves
 * it (spends credits, worker generates only the approved plan). Read-only for already-generated jobs.
 */
import React, { useEffect, useState } from 'react'

type Scene = { index: number; role: string; time: string | null; action: string; scriptLine: string }
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

  const generate = async () => {
    if (!board?.editable) return
    setGenerating(true)
    const script = scenes.map((s) => s.scriptLine).join(' ').trim()
    await fetch('/api/discovery/clone-video/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: board.jobId, script, mode: board.suggestedMode, sceneCount: board.sceneCount }),
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
          <div key={s.index} style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 14, border: '1px solid #e6ece2', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 26, color: '#17251c', lineHeight: 1 }}>{i + 1}</div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872' }}>{ROLE_LABEL[s.role] || 'Scene'}</div>
              {s.time && <div style={{ fontSize: 10, color: '#a7b09e', fontFamily: 'ui-monospace, Menlo, monospace' }}>{s.time}</div>}
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
