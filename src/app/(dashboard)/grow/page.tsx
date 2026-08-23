'use client'
/**
 * Growth — ONE page that replaces the 9-item Grow menu. Everything about organic growth at a glance:
 * a revenue scoreboard, the journey stepper, the single next move, and 6 department cards (each a big
 * number + a status dot). Tap a card → that department. White, viewport-fit, visual-first — a founder
 * understands the whole picture without reading or scrolling.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#141d15', SUB = '#8a938a', LIME = '#ff5a2c', LINE = '#ececec', GOOD = '#1f8f4e', MUT = '#c7cec7'

type Task = { key: string; label: string; done: boolean; value?: string; href: string }
type Stage = { key: string; name: string; status: 'done' | 'active' | 'locked'; tasks: Task[] }
type Revenue = { total: number; currency: string | null; organic: number; organicShare: number }
type Data = {
  momentum: number; wins: number; banked?: number
  nextAction?: { label: string; href: string; stage: string } | null
  revenue?: Revenue | null
  stages: Stage[]
}

function money(n: number, cur?: string | null) {
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : (cur ? cur + ' ' : '$')
  return `${sym}${(n || 0).toLocaleString()}`
}

export default function GrowPage() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/mello/journey'); const j = await r.json(); if (r.ok) setD(j) } catch { /* noop */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const task = (k: string) => d?.stages?.flatMap((s) => s.tasks).find((t) => t.key === k)
  const rev = d?.revenue

  // 6 department cards — big number + status, tap to open.
  const catalog = task('catalog_seo') || task('catalog_alt')
  const cards = [
    { key: 'store', label: 'Store catalog', value: catalog?.value?.replace(/\D.*$/, '') || (catalog?.done ? '✓' : '—'), sub: catalog?.done ? 'clean' : 'gaps to fix', href: '/mission/catalog', warn: !!catalog && !catalog.done },
    { key: 'content', label: 'Content', value: (task('first_blog')?.value || '0').replace(/\D.*$/, '') || '0', sub: 'articles live', href: '/mission/blog', done: task('first_blog')?.done },
    { key: 'pages', label: 'Pages at scale', value: (task('programmatic')?.value || '0').replace(/\D.*$/, '') || '0', sub: 'programmatic SEO', href: '/mission/programmatic', done: task('programmatic')?.done },
    { key: 'seo', label: 'SEO', value: task('seo_audit')?.value?.replace(/[^\d]/g, '') || '—', sub: 'site score', href: '/mission/seo', done: task('seo_audit')?.done },
    { key: 'geo', label: 'AI search', value: task('geo_check')?.value?.replace(/\D.*$/, '') != null && task('geo_check')?.value ? task('geo_check')!.value!.replace(/[^\d%]/g, '') : '—', sub: 'share of voice', href: '/mission/geo', done: task('geo_check')?.done },
    { key: 'rivals', label: 'Competitors', value: '', sub: 'spy on rivals', href: '/mission/competitors' },
  ]

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '28px 24px 60px', fontFamily: 'Inter, system-ui, sans-serif', color: INK, background: '#fff', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>Growth</h1>
        <a href="/mission/wins" style={{ fontSize: 13, color: GOOD, fontWeight: 700, textDecoration: 'none' }}>Impact ledger →</a>
      </div>

      {loading ? <div style={{ color: SUB }}>Loading…</div> : d && (
        <>
          {/* Scoreboard — revenue + progress in one strip */}
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: 18, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
              {rev && <>
                <div><span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{money(rev.total, rev.currency)}</span><span style={{ fontSize: 12, color: SUB, marginLeft: 6 }}>revenue · 30d</span></div>
                <div style={{ fontSize: 13, color: GOOD, fontWeight: 700 }}>{money(rev.organic, rev.currency)} organic <span style={{ color: SUB, fontWeight: 500 }}>({rev.organicShare}%)</span></div>
              </>}
              <a href="/mission/wins" style={{ marginLeft: 'auto', fontSize: 12.5, color: SUB, textDecoration: 'none' }}><b style={{ color: INK }}>{d.wins}</b> moves{d.banked ? <> · <b style={{ color: GOOD }}>{money(d.banked, rev?.currency)}</b> banked</> : ''}</a>
            </div>
            <div style={{ height: 7, borderRadius: 100, background: '#eef2ee', overflow: 'hidden', marginTop: 12 }}>
              <div style={{ height: '100%', width: `${d.momentum}%`, background: `linear-gradient(90deg,${GOOD},${LIME})`, borderRadius: 100 }} />
            </div>
            {/* stepper */}
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
              {(d.stages || []).map((s, i) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i === d.stages.length - 1 ? '0 0 auto' : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 100, flex: 'none', background: s.status === 'done' ? GOOD : s.status === 'active' ? LIME : '#fff', border: `2px solid ${s.status === 'locked' ? MUT : s.status === 'done' ? GOOD : LIME}`, color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{s.status === 'done' ? '✓' : ''}</span>
                    <span style={{ fontSize: 12.5, fontWeight: s.status === 'active' ? 800 : 600, color: s.status === 'locked' ? SUB : INK }}>{s.name}</span>
                  </div>
                  {i < d.stages.length - 1 && <div style={{ flex: 1, height: 2, background: s.status === 'done' ? GOOD : '#eef2ee', margin: '0 8px' }} />}
                </div>
              ))}
            </div>
          </div>

          {/* The one next move */}
          {d.nextAction && (
            <a href={d.nextAction.href} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', background: INK, borderRadius: 14, padding: '15px 20px', marginBottom: 18 }}>
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,.5)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', flex: 'none' }}>Next</span>
              <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', flex: 1 }}>{d.nextAction.label}</span>
              <span style={{ color: LIME, fontSize: 20 }}>→</span>
            </a>
          )}

          {/* 6 department cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {cards.map((c) => (
              <a key={c.key} href={c.href} style={{ display: 'block', textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, position: 'relative' }}>
                <span style={{ position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 100, background: c.warn ? LIME : c.done ? GOOD : MUT }} />
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', color: c.warn ? LIME : INK, lineHeight: 1, minHeight: 30 }}>{c.value}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginTop: 10 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{c.sub}</div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
