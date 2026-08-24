'use client'
/**
 * Growth — ONE page for the whole organic engine. A revenue scoreboard + journey stepper + the single next
 * move up top (always visible for context), then a tab bar: Overview shows 6 department cards; each other
 * tab renders that department INLINE on this same page (no navigation away). If a department needs a
 * connection, its own screen asks for it right here — like the mission page. Full white, visual-first.
 */
import { useEffect, useState, useCallback } from 'react'
import { EmbeddedContext } from '@/lib/ui/embedded'
import CatalogPage from '../mission/catalog/page'
import BlogPage from '../mission/blog/page'
import ProgrammaticPage from '../mission/programmatic/page'
import SeoPage from '../mission/seo/page'
import GeoPage from '../mission/geo/page'
import CompetitorsPage from '../mission/competitors/page'

const INK = '#141d15', SUB = '#8a938a', LIME = '#ff5a2c', LINE = '#ececec', GOOD = '#1f8f4e', MUT = '#c7cec7'

type Task = { key: string; label: string; done: boolean; value?: string; href: string }
type Stage = { key: string; name: string; status: 'done' | 'active' | 'locked'; tasks: Task[] }
type Revenue = { total: number; currency: string | null; organic: number; organicShare: number }
type Data = { momentum: number; wins: number; banked?: number; nextAction?: { label: string; href: string; stage: string } | null; revenue?: Revenue | null; stages: Stage[] }

function money(n: number, cur?: string | null) {
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : (cur ? cur + ' ' : '$')
  return `${sym}${(n || 0).toLocaleString()}`
}

type TabKey = 'overview' | 'store' | 'content' | 'pages' | 'seo' | 'geo' | 'rivals'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'store', label: 'Store' }, { key: 'content', label: 'Content' },
  { key: 'pages', label: 'Pages at scale' }, { key: 'seo', label: 'SEO' }, { key: 'geo', label: 'AI search' }, { key: 'rivals', label: 'Competitors' },
]

export default function GrowPage() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('overview')

  const [scan, setScan] = useState<{ domain: string; score: number; grade: string; problemCount: number } | null>(null)
  const load = useCallback(async () => {
    try { const r = await fetch('/api/mello/journey'); const j = await r.json(); if (r.ok) setD(j) } catch { /* noop */ }
    setLoading(false)
    // The free scan they arrived from (theater → dashboard continuity).
    try { const r = await fetch('/api/audit/claim'); const j = await r.json(); if (r.ok && j.scan) setScan(j.scan) } catch { /* optional */ }
  }, [])
  useEffect(() => { load() }, [load])

  const task = (k: string) => d?.stages?.flatMap((s) => s.tasks).find((t) => t.key === k)
  const rev = d?.revenue
  const num = (v?: string) => (v ? (v.match(/[\d.]+%?/)?.[0] ?? v) : '')
  const catalog = task('catalog_seo') || task('catalog_alt')

  const cards: { tab: TabKey; label: string; value: string; sub: string; warn?: boolean; done?: boolean }[] = [
    { tab: 'store', label: 'Store catalog', value: catalog?.done ? '✓' : num(catalog?.value) || '0', sub: catalog?.done ? 'clean' : 'gaps to fix', warn: !!catalog && !catalog.done },
    { tab: 'content', label: 'Content', value: num(task('first_blog')?.value) || '0', sub: 'articles live', done: task('first_blog')?.done },
    { tab: 'pages', label: 'Pages at scale', value: num(task('programmatic')?.value) || '0', sub: 'programmatic SEO', done: task('programmatic')?.done },
    { tab: 'seo', label: 'SEO', value: num(task('seo_audit')?.value) || '—', sub: 'site score', done: task('seo_audit')?.done },
    { tab: 'geo', label: 'AI search', value: num(task('geo_check')?.value) || '—', sub: 'share of voice', done: task('geo_check')?.done },
    { tab: 'rivals', label: 'Competitors', value: '›', sub: 'spy on rivals' },
  ]

  const Dept = tab === 'store' ? CatalogPage : tab === 'content' ? BlogPage : tab === 'pages' ? ProgrammaticPage : tab === 'seo' ? SeoPage : tab === 'geo' ? GeoPage : tab === 'rivals' ? CompetitorsPage : null

  return (
    <div style={{ background: '#fff', width: '100%', minHeight: '100%' }}>
      <style>{`.gcard{transition:border-color .12s, box-shadow .12s, transform .12s} .gcard:hover{border-color:${LIME}!important;box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-1px)} .gcard:hover .garrow{opacity:1;transform:translateX(0)} .gtab{transition:background .12s,color .12s}`}</style>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '26px 24px 70px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>Growth</h1>
        </div>

        {/* Continuity banner — the free scan they came in from */}
        {scan && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: `1px solid ${LINE}`, borderLeft: `3px solid ${LIME}`, borderRadius: 14, padding: '14px 18px', marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: scan.score >= 60 ? GOOD : scan.score >= 40 ? '#c98a1a' : '#e5484d', letterSpacing: '-.02em' }}>{scan.score}<span style={{ fontSize: 13, color: SUB, fontWeight: 500 }}>/100</span></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>Your free X-ray of {scan.domain}</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>{scan.problemCount} problems found · your agents can fix these</div>
            </div>
            <a href="/mission/seo" style={{ background: LIME, color: '#fff', padding: '9px 16px', borderRadius: 100, fontSize: 13, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>Fix them →</a>
          </div>
        )}

        {loading ? <div style={{ color: SUB }}>Loading…</div> : d && (
          <>
            {/* Scoreboard + stepper — always-on context */}
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, padding: 18, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                {rev ? <>
                  <div><span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{money(rev.total, rev.currency)}</span><span style={{ fontSize: 12, color: SUB, marginLeft: 6 }}>revenue · 30d</span></div>
                  <div style={{ fontSize: 13, color: GOOD, fontWeight: 700 }}>{money(rev.organic, rev.currency)} organic <span style={{ color: SUB, fontWeight: 500 }}>({rev.organicShare}%)</span></div>
                </> : <div style={{ fontSize: 15, color: SUB }}>Connect your store to track revenue →</div>}
                <span style={{ marginLeft: 'auto', fontSize: 12.5, color: SUB }}><b style={{ color: INK }}>{d.wins}</b> moves{d.banked ? <> · <b style={{ color: GOOD }}>{money(d.banked, rev?.currency)}</b> banked</> : ''}</span>
              </div>
              <div style={{ height: 7, borderRadius: 100, background: '#eef2ee', overflow: 'hidden', marginTop: 12 }}>
                <div style={{ height: '100%', width: `${d.momentum}%`, background: `linear-gradient(90deg,${GOOD},${LIME})`, borderRadius: 100 }} />
              </div>
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

            {/* Next move */}
            {d.nextAction && (
              <a href={d.nextAction.href} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', background: INK, borderRadius: 14, padding: '14px 20px', marginBottom: 16 }}>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,.5)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', flex: 'none' }}>Next</span>
                <span style={{ fontSize: 16.5, fontWeight: 800, color: '#fff', flex: 1 }}>{d.nextAction.label}</span>
                <span style={{ color: LIME, fontSize: 20 }}>→</span>
              </a>
            )}

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
              {TABS.map((t) => (
                <button key={t.key} className="gtab" onClick={() => setTab(t.key)} style={{
                  border: `1px solid ${tab === t.key ? INK : LINE}`, background: tab === t.key ? INK : '#fff', color: tab === t.key ? '#fff' : INK,
                  borderRadius: 100, padding: '7px 15px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}>{t.label}</button>
              ))}
            </div>

            {/* Overview = cards; else the department inline */}
            {tab === 'overview' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                {cards.map((c) => (
                  <button key={c.tab} className="gcard" onClick={() => setTab(c.tab)} style={{ textAlign: 'left', cursor: 'pointer', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, position: 'relative', fontFamily: 'inherit' }}>
                    <span style={{ position: 'absolute', top: 15, right: 15, width: 8, height: 8, borderRadius: 100, background: c.warn ? LIME : c.done ? GOOD : MUT }} />
                    <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', color: c.warn ? LIME : INK, lineHeight: 1, minHeight: 30 }}>{c.value}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>{c.label}
                      <span className="garrow" style={{ opacity: 0, transform: 'translateX(-3px)', transition: 'opacity .12s, transform .12s', color: LIME }}>→</span>
                    </div>
                    <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{c.sub}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
                <EmbeddedContext.Provider value={true}>{Dept && <Dept />}</EmbeddedContext.Provider>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
