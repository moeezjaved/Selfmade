'use client'

/**
 * The CEO desk — Mello's decisions for today, as one-click tasks (Polsia-style). Each card is a
 * decision Mello already made; clicking Start runs the engine (RESEARCH → competitor report) and, when
 * done, links to the result (you're also emailed). Turns the brief from analytics into work-being-done.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'

const FOREST = '#17251c', LIME = '#dffe95', INK = '#161c17', MUTED = '#68756b', LINE = '#e6ece2', GREEN = '#3f8f4f'
const KIND: Record<string, { label: string; run: string }> = {
  research: { label: 'Research', run: 'Reading their ads · writing the report…' },
  creative: { label: 'Creative', run: 'Designing the ad…' },
  video: { label: 'Video', run: 'Building the storyboard…' },
}

type Task = {
  id?: string; kind: string; title: string; why?: string; evidence?: any; credits?: number | null
  status: string; suggested?: boolean; suggested_key?: string; brand_id?: string | null; result?: any; error?: string
}

export default function MelloTasks({ brandId }: { brandId?: string | null }) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = () => fetch(`/api/mello/tasks${brandId ? `?brandId=${brandId}` : ''}`, { cache: 'no-store' })
    .then((r) => r.json()).then((j) => setTasks(j.tasks || [])).catch(() => setTasks([]))
  useEffect(() => { load() }, [brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (t: Task, i: number) => {
    const key = t.id || t.suggested_key || String(i)
    setBusy((b) => ({ ...b, [key]: true }))
    setTasks((prev) => prev?.map((x, xi) => (xi === i ? { ...x, status: 'running' } : x)) || prev)
    try {
      const body = t.id ? { id: t.id } : { suggestion: t }
      const j = await fetch('/api/mello/tasks/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
      if (j.task) setTasks((prev) => prev?.map((x, xi) => (xi === i ? { ...x, ...j.task, suggested: false } : x)) || prev)
    } catch { setTasks((prev) => prev?.map((x, xi) => (xi === i ? { ...x, status: 'failed', error: 'Something went wrong — try again.' } : x)) || prev) }
    finally { setBusy((b) => ({ ...b, [key]: false })) }
  }

  if (!tasks) return null
  if (!tasks.length) return null

  const chip: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: GREEN, background: '#eef7d6', borderRadius: 5, padding: '2px 7px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10.5, letterSpacing: '.15em', textTransform: 'uppercase', color: INK, borderTop: '2px solid #1c1c1a', paddingTop: 9 }}>Mello’s plan for today</div>
      {tasks.map((t, i) => {
        const running = t.status === 'running'
        const done = t.status === 'done'
        const failed = t.status === 'failed'
        return (
          <div key={t.id || t.suggested_key || i} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '13px 15px', background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={chip}>{KIND[t.kind]?.label || t.kind}</span>
              {done && <span style={{ ...chip, color: '#2f7d1f', background: '#e7f3de' }}>Done</span>}
              {failed && <span style={{ ...chip, color: '#a3382d', background: '#fbe9e6' }}>Failed</span>}
            </div>
            <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 19, color: INK, lineHeight: 1.2 }}>{t.title}</div>
            {t.why && <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{t.why}</div>}

            <div style={{ marginTop: 11 }}>
              {done && t.result?.url ? (
                <Link href={t.result.url} style={{ display: 'inline-block', background: LIME, color: FOREST, borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>Open the report →</Link>
              ) : running ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: GREEN, fontWeight: 600 }}>
                  <span className="mt-spin" style={{ width: 14, height: 14, border: `2px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} /> {KIND[t.kind]?.run || 'Working…'}
                </div>
              ) : (
                <button onClick={() => run(t, i)} disabled={busy[t.id || t.suggested_key || String(i)]}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {failed ? 'Try again' : 'Start'} {t.credits ? <span style={{ color: '#9db98a', fontWeight: 600 }}>· {t.credits} cr</span> : null} →
                </button>
              )}
              {failed && t.error && <div style={{ fontSize: 12, color: '#a3382d', marginTop: 6 }}>{t.error}</div>}
            </div>
          </div>
        )
      })}
      <style>{`.mt-spin{animation:mtspin 1s linear infinite}@keyframes mtspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
