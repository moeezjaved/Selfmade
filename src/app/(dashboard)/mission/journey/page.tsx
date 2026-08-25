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
type Revenue = { total: number; aov: number; orders: number; currency: string | null; organic: number; organicShare: number; windowDays: number }
type Milestone = { amount: number; label: string; reached: boolean }
type Data = {
  store?: { name: string } | null
  momentum: number; wins: number; banked?: number; activeDays?: number
  nextAction?: { label: string; href: string; stage: string } | null
  revenue?: Revenue | null
  milestones?: Milestone[]; nextMilestone?: { label: string; amount: number; remaining: number } | null
  threat?: { title: string } | null
  stages: Stage[]; ladder: Ladder[]
}

function money(n: number, cur?: string | null) {
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : (cur ? cur + ' ' : '')
  return `${sym}${(n || 0).toLocaleString()}`
}

type Move = { title: string; why?: string; impact?: string; needs?: string | null; dept?: string; lever?: string }

const MOVE_HREF: Record<string, string> = { meta: '/connect-meta', shopify: '/connect/shopify', klaviyo: '/inbox' }
const DEPT_HREF: Record<string, string> = { seo: '/mission/seo', site: '/mission/catalog', media: '/reports', creative: '/studio', email: '/inbox', outreach: '/mission/competitors', research: '/mission/competitors', reports: '/reports', customer: '/inbox' }
function moveHref(m: Move): string { return (m.needs && MOVE_HREF[m.needs]) || (m.dept && DEPT_HREF[m.dept]) || '/brief' }

export default function JourneyPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [moves, setMoves] = useState<Move[] | null>(null)
  // Grounded revenue estimate per stage, from the Growth Plan lever math (honest — labeled 'est').
  const [stageRev, setStageRev] = useState<Record<string, { text: string; est: boolean }>>({})

  const load = useCallback(async () => {
    try { const r = await fetch('/api/mello/journey'); const j = await r.json(); if (r.ok) setData(j) } catch { /* noop */ }
    setLoading(false)
    // Mello's ranked GTM moves (paid + organic) — the same brain that powers the Morning Brief.
    try { const r = await fetch('/api/mello/strategist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const j = await r.json(); if (r.ok && Array.isArray(j.tasks)) setMoves(j.tasks.slice(0, 3)) } catch { /* noop */ }
    // Attach grounded £/$ estimates to stages from the growth-plan levers (only where the data supports it).
    try {
      const r = await fetch('/api/mello/growth-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (r.ok && Array.isArray(j.levers)) {
        const by: Record<string, any> = {}; for (const l of j.levers) by[l.key] = l
        const grounded = (k: string) => { const l = by[k]; return l && l.delta > 0 && ['measured', 'estimated'].includes(l.confidence) ? { text: `${l.deltaText}/mo`, est: l.confidence !== 'measured' } : null }
        const map: Record<string, any> = {}
        const fix = grounded('cvr_fix'); if (fix) map.fix = fix
        const pub = grounded('seo'); if (pub) map.publish = pub
        const grow = grounded('geo') || grounded('seo'); if (grow) map.grow = grow
        setStageRev(map)
      }
    } catch { /* estimates optional */ }
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
          <span style={{ fontSize: 13, color: SUB }}><b style={{ color: GOOD }}>{data.wins}</b> moves{data.banked ? <> · <b style={{ color: GOOD }}>{money(data.banked, data.revenue?.currency)}</b> banked</> : ''}{data.activeDays && data.activeDays > 1 ? ` · active ${data.activeDays} days` : ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <div style={{ flex: 1, height: 10, borderRadius: 100, background: '#eaf0ea', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${data.momentum}%`, background: `linear-gradient(90deg, ${GOOD}, ${LIME})`, borderRadius: 100, transition: 'width .5s' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', minWidth: 46, textAlign: 'right' }}>{data.momentum}%</div>
        </div>
      </div>

      {/* Real revenue + SEO (organic) contribution */}
      {data.revenue && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 18 }}>
          <RevStat label={`Revenue · ${data.revenue.windowDays}d`} value={money(data.revenue.total, data.revenue.currency)} />
          <RevStat label="Orders" value={String(data.revenue.orders)} />
          <RevStat label="AOV" value={money(data.revenue.aov, data.revenue.currency)} />
          <RevStat label="From organic (SEO)" value={money(data.revenue.organic, data.revenue.currency)} sub={`${data.revenue.organicShare}% of revenue`} accent />
        </div>
      )}

      {/* The day's threat — loss-aversion, understated (from the ads-health watchdog) */}
      {data.threat && (
        <a href="/mission/ads" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', border: `1px solid rgba(192,57,43,.25)`, background: '#fdecea', borderRadius: 12, padding: '11px 15px', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#c0392b', letterSpacing: '.04em', textTransform: 'uppercase', flex: 'none' }}>Watch</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: INK, flex: 1, minWidth: 0 }}>{data.threat.title}</span>
          <span style={{ color: '#c0392b', fontSize: 15 }}>→</span>
        </a>
      )}

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

      {/* Revenue milestones — understated markers, real monthly revenue (Phase 3) */}
      {data.milestones && data.milestones.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>Revenue milestones</div>
            {data.nextMilestone && <div style={{ fontSize: 12, color: SUB }}>{money(data.nextMilestone.remaining, data.revenue?.currency)} to {data.nextMilestone.label}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {data.milestones.map((m, i) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', flex: i === data.milestones!.length - 1 ? '0 0 auto' : 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 'none' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 100, background: m.reached ? GOOD : '#fff', border: `2px solid ${m.reached ? GOOD : '#d7ddd7'}`, flex: 'none' }} />
                  <div style={{ fontSize: 10.5, color: m.reached ? INK : SUB, fontWeight: m.reached ? 700 : 500, whiteSpace: 'nowrap' }}>{m.label}</div>
                </div>
                {i < data.milestones!.length - 1 && <div style={{ flex: 1, height: 2, background: m.reached ? GOOD : '#e6eae6', margin: '0 4px', marginBottom: 16 }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What Mello would do — the ranked GTM moves (paid + organic) unified onto mission */}
      {moves && moves.length > 0 && (
        <div style={{ marginBottom: 30 }}>
          <div style={{ fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', marginBottom: 12 }}>What Mello would do</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {moves.map((m, i) => (
              <a key={i} href={moveHref(m)} style={{ textDecoration: 'none', color: 'inherit', border: `1px solid ${LINE}`, borderLeft: `3px solid ${LIME}`, borderRadius: 12, background: '#fff', padding: 15, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: INK, lineHeight: 1.25 }}>{m.title}</div>
                {m.why && <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.45 }}>{m.why}</div>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
                  {m.impact && <span style={{ fontSize: 12.5, fontWeight: 800, color: GOOD }}>{m.impact}</span>}
                  <span style={{ color: LIME, fontSize: 15, marginLeft: 'auto' }}>→</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* The quest chain */}
      <div style={{ position: 'relative', paddingLeft: 4 }}>
        {data.stages.map((s, i) => (
          <Stage key={s.key} s={s} last={i === data.stages.length - 1} rev={stageRev[s.key]} />
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

function Stage({ s, last, rev }: { s: Stage; last: boolean; rev?: { text: string; est: boolean } }) {
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {rev && !done && <div style={{ fontSize: 12, fontWeight: 800, color: GOOD, background: '#f2f8ef', borderRadius: 20, padding: '2px 10px' }}>≈ +{rev.text}{rev.est ? <span style={{ fontWeight: 600, color: SUB, fontSize: 10 }}> est</span> : ''}</div>}
            {s.impact && <div style={{ fontSize: 12, fontWeight: 700, color: done ? GOOD : LIME, background: done ? '#eaf6e6' : '#fff1ec', borderRadius: 20, padding: '2px 10px' }}>{s.impact}</div>}
          </div>
        </div>
        <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
          {s.tasks.map((t, i) => (
            <a key={t.key} href={t.locked ? undefined : t.href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', borderTop: i ? `1px solid ${LINE}` : 'none', textDecoration: 'none', color: 'inherit', cursor: t.locked ? 'default' : 'pointer', pointerEvents: t.locked ? 'none' : 'auto' }}>
              <span style={{ width: 18, height: 18, borderRadius: 100, flex: 'none', border: `2px solid ${t.done ? GOOD : t.locked ? MUT : LINE}`, background: t.done ? GOOD : 'transparent', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{t.done ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.done ? INK : t.locked ? SUB : INK, fontWeight: t.done ? 600 : 700, textDecoration: t.done ? 'none' : 'none' }}>{t.label}</span>
              {t.value && <span style={{ fontSize: 11.5, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: t.done ? GOOD : SUB }}>{t.value}</span>}
              {!t.locked && !t.done && <span style={{ color: LIME, fontSize: 15 }}>→</span>}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function RevStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ border: `1px solid ${accent ? 'rgba(37,96,41,.25)' : LINE}`, borderRadius: 14, padding: '13px 15px', background: accent ? '#f2f8ef' : '#fff' }}>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: accent ? GOOD : INK }}>{value}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? GOOD : SUB, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
