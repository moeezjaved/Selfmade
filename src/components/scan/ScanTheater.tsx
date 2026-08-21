'use client'
/**
 * ScanTheater — the /scan funnel. It's an AUDIT of YOUR ads (Ryze-style live theater): read your ads,
 * score your ad presence, show the gaps — and spying on rivals is ONE part of it. Public, no login.
 * Input: pick your brand from the 611K directory, or paste your Meta Ad Library link.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { FullDnaResult, Tally } from '@/lib/dna/engine'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', ORANGE = '#ef4a1e', PAPER = '#fbf4e2'
const DARK = '#1c1611', DARK2 = '#2a2016', CREAM = '#f3ece0', MUT = '#a99f92'

type Brand = { pageId: string; name: string; adCount?: number; industry?: string | null }
type StepId = 'ads' | 'rivals' | 'gaps' | 'score'
type Step = { id: StepId; label: string; status: 'pending' | 'active' | 'done'; metric?: string }
type ScanResult = FullDnaResult & { brand: { pageId: string; name: string; niche: string | null }; competitors: number; ownPending?: boolean }

const STEPS0: Step[] = [
  { id: 'ads', label: 'Reading your ads', status: 'pending' },
  { id: 'rivals', label: 'Spying on your rivals', status: 'pending' },
  { id: 'gaps', label: 'Finding your gaps', status: 'pending' },
  { id: 'score', label: 'Scoring your ad presence', status: 'pending' },
]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Live animation: staggered reveal + reduced-motion guard.
const REVEAL_CSS = `
@keyframes sf-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.sf-rise{animation:sf-rise .5s cubic-bezier(.2,.7,.2,1) both}
@media (prefers-reduced-motion:reduce){.sf-rise{animation:none}}
`
const rise = (i = 0): CSSProperties => ({ animationDelay: `${i * 70}ms` })

// A number that ticks up from 0 (Ryze-style). Respects reduced-motion.
function Count({ n, dur = 900 }: { n: number; dur?: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion:reduce)').matches) { setV(n); return }
    let raf = 0; const t0 = performance.now()
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setV(Math.round(n * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [n, dur])
  return <>{v.toLocaleString()}</>
}

export default function ScanTheater() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Brand[]>([])
  const [showLink, setShowLink] = useState(false)
  const [adLink, setAdLink] = useState('')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [steps, setSteps] = useState<Step[]>(STEPS0)
  const [stage, setStage] = useState<StepId>('ads')
  const [pct, setPct] = useState(0)
  const [res, setRes] = useState<ScanResult | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const running = useRef(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (phase !== 'idle') return
    if (q.trim().length < 2) { setResults([]); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      fetch(`/api/scan/brands?q=${encodeURIComponent(q.trim())}`).then((r) => r.json())
        .then((j) => setResults(Array.isArray(j.results) ? j.results.slice(0, 8) : [])).catch(() => setResults([]))
    }, 220)
  }, [q, phase])

  const setStep = useCallback((id: StepId, status: Step['status'], metric?: string) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, status, metric: metric ?? x.metric } : x))), [])

  const run = useCallback(async (payload: { pageId?: string; adLibraryUrl?: string }) => {
    if (running.current) return
    running.current = true
    setPhase('running'); setStage('ads'); setStep('ads', 'active'); setPct(10)
    try {
      const r = await fetch('/api/scan/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Scan failed')
      const data: ScanResult = await r.json()
      setRes(data)
      setStep('ads', 'done', data.own.found ? `${data.own.totalAds} ads` : 'no ads found'); setStage('ads'); setPct(34); await sleep(1100)
      setStage('rivals'); setStep('rivals', 'active'); await sleep(300)
      setStep('rivals', 'done', `${data.winners.winnerCount} winners`); setPct(60); await sleep(1100)
      setStage('gaps'); setStep('gaps', 'active'); await sleep(300)
      setStep('gaps', 'done', `${data.gaps.length} gaps`); setPct(82); await sleep(900)
      setStage('score'); setStep('score', 'active'); await sleep(300)
      setStep('score', 'done', `${data.score.total}/100`); setPct(100); await sleep(500)
      setPhase('done')
    } catch (e) {
      setErrMsg(String((e as Error).message || 'Scan failed')); setPhase('error'); running.current = false
    }
  }, [setStep])

  // ── IDLE — audit framing + brand picker (or ad-library link) ──
  if (phase === 'idle') {
    return (
      <div style={{ minHeight: '100vh', background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 600, width: '100%', textAlign: 'center' }}>
          <div style={{ fontFamily: 'Fraunces,serif', fontStyle: 'italic', color: '#c8410f', fontSize: 20, marginBottom: 8 }}>free · 90 seconds · no login</div>
          <h1 style={{ fontFamily: 'Fraunces,Georgia,serif', fontSize: 'clamp(38px,7vw,60px)', lineHeight: .98, letterSpacing: '-.02em', color: INK, margin: '0 0 16px' }}>Audit your ads.</h1>
          <p style={{ color: SUB, fontSize: 18, margin: '0 0 26px' }}>See exactly where your ads stand — your presence, your gaps, and what your rivals are winning with.</p>

          {!showLink ? (
            <div style={{ position: 'relative', maxWidth: 460, margin: '0 auto', textAlign: 'left' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your brand…" autoFocus
                style={{ width: '100%', padding: '15px 18px', borderRadius: results.length ? '16px 16px 0 0' : 100, border: `1.5px solid ${LINE}`, fontSize: 16, background: '#fff', color: INK, outline: 'none' }} />
              {results.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${LINE}`, borderTop: 'none', borderRadius: '0 0 16px 16px', overflow: 'hidden', zIndex: 5, boxShadow: '0 20px 40px -20px rgba(0,0,0,.3)' }}>
                  {results.map((b) => (
                    <button key={b.pageId} onClick={() => run({ pageId: b.pageId })}
                      style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: INK }}>{b.name}</span>
                      <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: SUB }}>{b.adCount ? `${b.adCount.toLocaleString()} ads` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ textAlign: 'center', marginTop: 16, fontSize: 14, color: SUB }}>
                Can&rsquo;t find it? <button onClick={() => setShowLink(true)} style={{ background: 'none', border: 'none', color: ORANGE, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>Paste your Meta Ad Library link →</button>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <input value={adLink} onChange={(e) => setAdLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adLink.trim() && run({ adLibraryUrl: adLink.trim() })} placeholder="facebook.com/ads/library/?…view_all_page_id=…" autoFocus
                  style={{ flex: 1, padding: '14px 16px', borderRadius: 100, border: `1.5px solid ${LINE}`, fontSize: 14, background: '#fff', color: INK, outline: 'none' }} />
                <button onClick={() => adLink.trim() && run({ adLibraryUrl: adLink.trim() })} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '14px 24px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>Audit →</button>
              </div>
              <button onClick={() => setShowLink(false)} style={{ marginTop: 14, background: 'none', border: 'none', color: SUB, fontSize: 14, cursor: 'pointer' }}>← Search by brand name instead</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const winners = res?.winners
  const own = res?.own

  return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'grid', gridTemplateColumns: 'minmax(0,300px) minmax(0,1fr)' }}>
      <style>{REVEAL_CSS}</style>
      <aside style={{ background: DARK, color: CREAM, padding: '28px 24px', position: 'sticky', top: 0, alignSelf: 'start', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 22, color: '#fff' }}>{phase === 'done' ? 'Audit complete' : 'Auditing your ads'}</div>
        <div style={{ color: MUT, fontSize: 13.5, margin: '6px 0 24px', lineHeight: 1.45 }}>{res?.brand?.name || 'Your brand'}{res?.brand?.niche ? ` · ${res.brand.niche}` : ''}</div>
        <div style={{ flex: 1 }}>
          {steps.map((s) => (
            <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 18, textAlign: 'center', color: s.status === 'done' ? ORANGE : s.status === 'active' ? '#fff' : MUT, fontWeight: 800 }}>{s.status === 'done' ? '✓' : s.status === 'active' ? '◐' : '○'}</span>
                <span style={{ fontSize: 14.5, fontWeight: s.status === 'active' ? 800 : 600, color: s.status === 'pending' ? MUT : '#fff' }}>{s.label}</span>
                {s.metric && <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace,monospace', fontSize: 11.5, color: ORANGE }}>{s.metric}</span>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: MUT, marginBottom: 6 }}><span>{phase === 'done' ? 'Done' : 'Working…'}</span><span>{pct}%</span></div>
          <div style={{ height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 100 }}><div style={{ height: 4, width: `${pct}%`, background: ORANGE, borderRadius: 100, transition: 'width .5s' }} /></div>
        </div>
      </aside>

      <main style={{ padding: 'clamp(28px,5vw,64px)', maxWidth: 900 }}>
        {phase === 'error' && (
          <div><h2 style={h2}>{errMsg}</h2><button onClick={() => { setPhase('idle'); setSteps(STEPS0); setPct(0); running.current = false }} style={btn}>Try again</button></div>
        )}
        {phase !== 'error' && phase !== 'done' && res && <StageAct stage={stage} res={res} own={own!} winners={winners!} />}
        {phase !== 'error' && phase !== 'done' && !res && <div><h2 style={h2}>Reading your ads…</h2><p style={sub}>Pulling every ad on your page.</p></div>}
        {phase === 'done' && res && <ScoreAct res={res} />}
      </main>
    </div>
  )
}

// The full Brand-Spy depth: one panel per DNA dimension.
const PANELS: [string, string][] = [
  ['persona', 'Personas'], ['angle', 'Ad angles'], ['usp', 'USPs'],
  ['desire', 'Desires'], ['emotion', 'Emotions'], ['themes', 'Themes'], ['hook_type', 'Hooks'],
]
function DnaPanels({ dist }: { dist: Record<string, Tally[]> }) {
  const has = PANELS.filter(([k]) => (dist[k] || []).length)
  if (!has.length) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 14, marginTop: 20 }}>
      {has.map(([k, label], i) => (
        <div key={k} className="sf-rise" style={{ ...rise(i), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 10 }}>{label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(dist[k] || []).slice(0, 6).map((t, i) => <span key={i} style={{ fontSize: 12.5, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 100, padding: '4px 10px', color: INK }}>{t.label} <b style={{ color: SUB }}>{t.count}</b></span>)}
          </div>
        </div>
      ))}
    </div>
  )
}
const pill = (hot: boolean): CSSProperties => ({ fontSize: 12.5, background: hot ? ORANGE : PAPER, color: hot ? '#fff' : INK, border: `1px solid ${hot ? ORANGE : LINE}`, borderRadius: 100, padding: '4px 10px' })
// YOU vs WINNERS, dimension by dimension. Orange pill on the winners' side = a winning move you don't run.
function VsPanels({ own, winners }: { own: Record<string, Tally[]>; winners: Record<string, Tally[]> }) {
  const rows = PANELS.map(([k, label]) => ({ k, label, o: own[k] || [], w: winners[k] || [] })).filter((r) => r.w.length || r.o.length)
  if (!rows.length) return null
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
      {rows.map(({ k, label, o, w }, ri) => {
        const oSet = new Set(o.map((t) => t.label.toLowerCase()))
        return (
          <div key={k} className="sf-rise" style={{ ...rise(ri), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 10 }}>{label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, marginBottom: 6 }}>You</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {o.length ? o.slice(0, 5).map((t, i) => <span key={i} style={pill(false)}>{t.label}</span>) : <span style={{ fontSize: 12.5, color: MUT }}>—</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#c8410f', marginBottom: 6 }}>Winners</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {w.slice(0, 5).map((t, i) => { const missing = !oSet.has(t.label.toLowerCase()); return <span key={i} style={pill(missing)}>{t.label} <b style={{ color: missing ? '#fff' : SUB }}>{t.pct}%</b></span> })}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
const MEDIA_COLOR: Record<string, string> = { Video: '#3b6df0', 'Carousel/DCO': ORANGE, Image: '#1e7a4f' }
function MediaBar({ media }: { media: Tally[] }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t) }, [])
  if (!media.length) return null
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', height: 12, borderRadius: 100, overflow: 'hidden', background: '#e7e0d0' }}>
        {media.map((m, i) => <div key={i} style={{ width: on ? `${m.pct}%` : '0%', background: MEDIA_COLOR[m.label] || '#bbb', transition: 'width .9s cubic-bezier(.4,0,.2,1)' }} title={`${m.label} ${m.pct}%`} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 9 }}>
        {media.map((m, i) => <span key={i} style={{ fontSize: 12.5, color: SUB, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: MEDIA_COLOR[m.label] || '#bbb' }} /><b style={{ color: INK }}>{m.label}</b> {m.count} · {m.pct}%</span>)}
      </div>
    </div>
  )
}

function StageAct({ stage, res, own, winners }: { stage: StepId; res: ScanResult; own: FullDnaResult['own']; winners: FullDnaResult['winners'] }) {
  if (stage === 'ads') {
    const vid = own.media.find((m) => m.label === 'Video')?.pct ?? 0
    return (
      <div>
        <h2 style={h2}>Your ads, read</h2>
        {own.found ? (
          <>
            <p style={sub}>Everything on your page, decoded — your presence and your creative DNA.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '18px 0 4px' }}>
              {([['Total ads', own.totalAds], ['Active', own.activeAds], ['Video %', vid]] as [string, number][]).map(([l, v], i) => (
                <div key={l} className="sf-rise" style={{ ...rise(i), flex: '1 1 120px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 28, color: INK, lineHeight: 1 }}><Count n={v} />{l === 'Video %' ? '%' : ''}</div>
                  <div style={{ fontSize: 12, color: SUB, marginTop: 3 }}>{l}</div>
                </div>
              ))}
            </div>
            <MediaBar media={own.media} />
            <DnaPanels dist={own.dist as Record<string, Tally[]>} />
          </>
        ) : res.ownPending ? (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '20px 22px', marginTop: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>⏳ Pulling your ads now…</div>
            <p style={{ ...sub, marginTop: 6 }}>You weren&rsquo;t in our index yet, so we just started a <b style={{ color: INK }}>priority crawl</b> of your ad library. Your own-ad breakdown fills in within a few minutes — re-run then. Meanwhile, here&rsquo;s your market ↓</p>
          </div>
        ) : <p style={sub}>We couldn&rsquo;t find ads for your page — you may not be running any (that&rsquo;s the first gap). Here&rsquo;s what winning looks like in your market…</p>}
      </div>
    )
  }
  if (stage === 'rivals') return (
    <div>
      <h2 style={h2}>What your rivals are <span style={{ color: ORANGE }}>winning</span> with</h2>
      <p style={sub}>Of {winners.sampleSize.toLocaleString()} rival ads, {winners.winnerCount.toLocaleString()} have run 90+ days — proven money-makers. Their playbook:</p>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '18px 0 8px' }}>
        {winners.examples.map((ex, i) => (
          <div key={ex.adId} className="sf-rise" style={{ ...rise(i), flex: '0 0 150px', width: 150, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ height: 108, background: `#f1ece2 ${ex.thumb ? `url(${ex.thumb}) center/cover` : ''}` }} />
            <div style={{ padding: '9px 10px 11px' }}>
              <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 700, color: ORANGE }}>{ex.daysRunning}d running</div>
              <div style={{ fontSize: 11.5, color: INK, lineHeight: 1.3, marginTop: 3, maxHeight: 46, overflow: 'hidden' }}>{ex.hook || ex.brand}</div>
            </div>
          </div>
        ))}
      </div>
      <MediaBar media={winners.media} />
      <DnaPanels dist={winners.dist as Record<string, Tally[]>} />
    </div>
  )
  if (stage === 'gaps') return (
    <div>
      <h2 style={h2}>You vs the <span style={{ color: ORANGE }}>winners</span></h2>
      <p style={sub}>Your ad DNA next to your rivals&rsquo;, dimension by dimension. <b style={{ color: '#c8410f' }}>Orange</b> = a winning move you&rsquo;re not running.</p>
      <VsPanels own={own.dist as Record<string, Tally[]>} winners={winners.dist as Record<string, Tally[]>} />
      {res.gaps.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, margin: '26px 0 4px' }}>Biggest gaps</div>
          <div>
            {res.gaps.slice(0, 6).map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: `1px solid ${LINE}` }}>
                <span style={{ color: ORANGE, fontWeight: 900 }}>→</span>
                <div><b style={{ color: INK, fontSize: 14.5 }}>{g.dimension}: {g.label}</b>
                  <div style={{ color: SUB, fontSize: 13 }}>{g.winnerPct}% of winners use it — you&rsquo;re at {g.yourPct}%.</div></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
  return null
}

const TIER: Record<string, { c: string; l: string }> = { starter: { c: '#c0281a', l: 'Starter' }, scaling: { c: '#b7791f', l: 'Scaling' }, elite: { c: '#1e7a4f', l: 'Elite' } }
type BenchAxis = { key: string; label: string; you: number; unit: string; tier: string; pct: number; target: string }
function BenchSection({ bench, systemScore }: { bench: BenchAxis[]; systemScore: number }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), 90); return () => clearTimeout(t) }, [])
  if (!bench.length) return null
  const verdict = systemScore >= 70 ? 'You&rsquo;re building a system.' : systemScore >= 40 ? 'You&rsquo;re starting to build a system.' : 'Right now, you&rsquo;re running ads.'
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '26px 28px', margin: '0 0 28px' }}>
      <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 26, color: INK, lineHeight: 1.15 }}>$100k → $1M: are you running ads, or building a <span style={{ color: ORANGE }}>system</span>?</div>
      <p style={{ color: SUB, fontSize: 15, margin: '8px 0 2px' }} dangerouslySetInnerHTML={{ __html: `<b style="color:${INK}">${verdict}</b> A $100k brand runs ads; a $1M brand builds a creative + conversion system. Here&rsquo;s where you sit on each axis.` }} />
      <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
        {bench.map((a, i) => {
          const t = TIER[a.tier] || TIER.starter
          return (
            <div key={a.key} className="sf-rise" style={rise(i)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{a.label} <span style={{ color: t.c, fontWeight: 800 }}>· {t.l}</span></span>
                <span style={{ fontSize: 12.5, color: SUB }}><b style={{ color: INK }}><Count n={a.you} /></b> {a.unit} · <span style={{ color: MUT }}>{a.target}</span></span>
              </div>
              <div style={{ height: 8, background: 'rgba(26,20,16,.08)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: 8, width: on ? `${Math.max(3, a.pct)}%` : '0%', background: t.c, borderRadius: 100, transition: 'width 1s cubic-bezier(.4,0,.2,1)' }} />
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ color: MUT, fontSize: 12.5, marginTop: 16, lineHeight: 1.5 }}>The invisible half: we can&rsquo;t see your CAC, LTV, subscriptions or AOV from the outside — but $1M brands obsess over them. If every customer is worth more, you can afford to spend more to win them.</p>
    </div>
  )
}

function ScoreAct({ res }: { res: ScanResult }) {
  const s = res.score
  const color = s.total < 40 ? '#c0281a' : s.total < 60 ? '#b7791f' : '#1e7a4f'
  const C = 2 * Math.PI * 78
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 80); return () => clearTimeout(t) }, [])
  return (
    <div>
      {res.own.found && <BenchSection bench={res.own.bench} systemScore={res.own.systemScore} />}
      <h2 style={h2}>Your ad-presence score</h2>
      <p style={sub}>Across coverage, format mix, angles, and the winning tactics you&rsquo;re missing.</p>
      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'center', margin: '26px 0' }}>
        <div style={{ position: 'relative', width: 180, height: 180, flex: 'none' }}>
          <svg width="180" height="180" viewBox="0 0 180 180">
            <circle cx="90" cy="90" r="78" fill="none" stroke="rgba(26,20,16,.1)" strokeWidth="12" />
            <circle cx="90" cy="90" r="78" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={drawn ? C * (1 - s.total / 100) : C} transform="rotate(-90 90 90)" style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 46, color: INK, lineHeight: 1 }}><Count n={s.total} dur={1200} /></div>
            <div style={{ fontSize: 11, color: SUB, letterSpacing: '.1em' }}>OF 100</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'inline-block', background: `${color}18`, color, fontWeight: 800, fontSize: 13, padding: '6px 14px', borderRadius: 100, marginBottom: 14 }}>{s.band}</div>
          {s.subscores.map((ss) => (
            <div key={ss.key} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '9px 0' }}>
              <span style={{ width: 120, fontSize: 13, color: SUB }}>{ss.label}</span>
              <div style={{ flex: 1, height: 6, background: 'rgba(26,20,16,.08)', borderRadius: 100 }}>{ss.value != null && <div style={{ height: 6, width: drawn ? `${ss.value}%` : '0%', background: ORANGE, borderRadius: 100, transition: 'width 1s cubic-bezier(.4,0,.2,1)' }} />}</div>
              <span style={{ width: 52, textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontSize: 12, color: ss.value != null ? INK : MUT }}>{ss.value != null ? ss.value : 'n/a'}</span>
            </div>
          ))}
        </div>
      </div>

      {res.report.prescriptions.length > 0 && (
        <div style={{ background: DARK, borderRadius: 20, padding: '30px 30px', marginTop: 10, color: CREAM }}>
          <h3 style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 24, color: '#fff', margin: '0 0 8px' }}>Your fix list — {res.report.prescriptions.length} ads to make</h3>
          <p style={{ color: MUT, fontSize: 14.5, margin: '0 0 18px' }}>Built from the winning DNA you&rsquo;re missing.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {res.report.prescriptions.map((p, i) => (
              <div key={i} style={{ background: DARK2, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{p.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[['Hook', p.hook], ['Format', p.format], ['Offer', p.offer]].filter(([, v]) => v).map(([k, v]) => <span key={k as string} style={{ fontSize: 11.5, background: 'rgba(255,255,255,.08)', borderRadius: 7, padding: '4px 9px' }}><b style={{ color: '#ff9f7a' }}>{k}:</b> {v}</span>)}
                </div>
              </div>
            ))}
          </div>
          <a href="/signup" style={{ display: 'inline-block', marginTop: 20, background: ORANGE, color: '#fff', borderRadius: 100, padding: '13px 28px', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Let Selfmade make these →</a>
        </div>
      )}
    </div>
  )
}

const h2: CSSProperties = { fontFamily: 'Fraunces,Georgia,serif', fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.02em', lineHeight: 1.05, color: INK, margin: '0 0 10px' }
const sub: CSSProperties = { color: SUB, fontSize: 17, maxWidth: 620, margin: 0, lineHeight: 1.5 }
const btn: CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }
