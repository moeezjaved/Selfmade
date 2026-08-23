'use client'
/**
 * Mission Journey — the retention engine. One connected quest across every agent: a momentum meter, a big
 * next-best-action, staged tasks that unlock each other (Connect → Fix → Publish → Grow), and a 12-month
 * projected ladder. Reads real state from /api/mello/journey — the game is honest.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029', MUT = '#b8c4b8'

type Task = { key: string; label: string; done: boolean; value?: string; href: string; locked?: boolean }
type Stage = { key: string; name: string; tagline: string; status: 'done' | 'active' | 'locked'; tasks: Task[]; impact?: string }
type Ladder = { window: string; title: string; desc: string; reached: boolean }
type Data = {
  store?: { name: string } | null
  momentum: number; wins: number
  nextAction?: { label: string; href: string; stage: string } | null
  stages: Stage[]; ladder: Ladder[]
}

export default function JourneyPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/mello/journey'); const j = await r.json(); if (r.ok) setData(j) } catch { /* noop */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <Shell><div style={{ color: SUB }}>Loading your journey…</div></Shell>
  if (!data) return <Shell><div style={{ color: SUB }}>Couldn’t load. Refresh.</div></Shell>

  return (
    <Shell>
      {/* Header + momentum */}
      <div style={{ marginBottom: 4, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>
        {data.store?.name ? `${data.store.name} · your growth journey` : 'Your growth journey'}
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 14px' }}>One step at a time to page one.</h1>

      <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, background: PAPER, padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 15, color: INK }}>Momentum</div>
          <div style={{ fontSize: 13, color: SUB }}><b style={{ color: GOOD }}>{data.wins}</b> wins banked</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <div style={{ flex: 1, height: 10, borderRadius: 100, background: '#eaf0ea', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${data.momentum}%`, background: `linear-gradient(90deg, ${GOOD}, ${LIME})`, borderRadius: 100, transition: 'width .5s' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', minWidth: 46, textAlign: 'right' }}>{data.momentum}%</div>
        </div>
      </div>

      {/* Next best action — the pull */}
      {data.nextAction && (
        <a href={data.nextAction.href} style={{ display: 'block', textDecoration: 'none', border: 'none', borderRadius: 18, background: INK, padding: '18px 22px', marginBottom: 26 }}>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 5 }}>Your next move{data.nextAction.stage ? ` · ${data.nextAction.stage}` : ''}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>{data.nextAction.label}</div>
            <div style={{ fontSize: 22, color: LIME }}>→</div>
          </div>
        </a>
      )}

      {/* The quest chain */}
      <div style={{ position: 'relative', paddingLeft: 4 }}>
        {data.stages.map((s, i) => (
          <Stage key={s.key} s={s} last={i === data.stages.length - 1} />
        ))}
      </div>

      {/* Projected ladder */}
      <div style={{ marginTop: 34 }}>
        <div style={{ fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', marginBottom: 12 }}>Where this goes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.ladder.map((l) => (
            <div key={l.title} style={{ display: 'flex', alignItems: 'center', gap: 14, border: `1px solid ${LINE}`, borderRadius: 12, background: l.reached ? '#f2f8ef' : '#fff', padding: '13px 16px' }}>
              <div style={{ width: 10, height: 10, borderRadius: 100, background: l.reached ? GOOD : MUT, flex: 'none' }} />
              <div style={{ minWidth: 96, fontSize: 12, color: SUB, fontWeight: 700 }}>{l.window}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{l.title}{l.reached && <span style={{ color: GOOD, marginLeft: 8, fontSize: 12 }}>reached ✓</span>}</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>{l.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

function Stage({ s, last }: { s: Stage; last: boolean }) {
  const done = s.status === 'done', active = s.status === 'active', locked = s.status === 'locked'
  const dotBg = done ? GOOD : active ? LIME : '#fff'
  const dotBorder = done || active ? dotBg : LINE
  return (
    <div style={{ display: 'flex', gap: 16, opacity: locked ? 0.62 : 1 }}>
      {/* rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
        <div style={{ width: 26, height: 26, borderRadius: 100, background: dotBg, border: `2px solid ${dotBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800 }}>
          {done ? '✓' : locked ? '🔒' : ''}
        </div>
        {!last && <div style={{ width: 2, flex: 1, minHeight: 24, background: done ? GOOD : LINE, marginTop: 2 }} />}
      </div>
      {/* content */}
      <div style={{ paddingBottom: 22, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: INK }}>{s.name}</div>
          <div style={{ fontSize: 13, color: SUB }}>{s.tagline}</div>
          {s.impact && <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: done ? GOOD : LIME, background: done ? '#eaf6e6' : '#fff1ec', borderRadius: 20, padding: '2px 10px' }}>{s.impact}</div>}
        </div>
        <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
          {s.tasks.map((t, i) => (
            <a key={t.key} href={t.locked ? undefined : t.href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', borderTop: i ? `1px solid ${LINE}` : 'none', textDecoration: 'none', color: 'inherit', cursor: t.locked ? 'default' : 'pointer', pointerEvents: t.locked ? 'none' : 'auto' }}>
              <span style={{ width: 18, height: 18, borderRadius: 100, flex: 'none', border: `2px solid ${t.done ? GOOD : t.locked ? MUT : LINE}`, background: t.done ? GOOD : 'transparent', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{t.done ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.done ? INK : t.locked ? SUB : INK, fontWeight: t.done ? 600 : 700, textDecoration: t.done ? 'none' : 'none' }}>{t.label}</span>
              {t.value && <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: t.done ? GOOD : SUB }}>{t.value}</span>}
              {!t.locked && !t.done && <span style={{ color: LIME, fontSize: 15 }}>→</span>}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
