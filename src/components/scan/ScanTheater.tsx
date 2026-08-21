'use client'
/**
 * ScanTheater — the /scan funnel, modeled on Ryze's live scan (dark sticky sidebar checklist +
 * big evidence stage + verdict cards + score/gate). Ads edition: reads the visitor's competitors'
 * winning-ad DNA (proven long-runners), scores their ad presence, and gates the prescriptions.
 *
 * v1 SCOPE: requires a logged-in session (reuses the existing authed discovery + DNA endpoints).
 * Anonymous/public hardening (IP limiter, anon paths, domain→page_id) is a later step.
 * Preview/branch only — not production.
 */
import { useCallback, useRef, useState, type CSSProperties } from 'react'
import type { FullDnaResult, Tally } from '@/lib/dna/engine'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', ORANGE = '#ef4a1e', PAPER = '#fbf4e2'
const DARK = '#1c1611', DARK2 = '#2a2016', CREAM = '#f3ece0', MUT = '#a99f92'

type Comp = { pageId: string; name: string; avatar?: string | null; adCount?: number | null }
type StepId = 'store' | 'rivals' | 'winners' | 'gaps' | 'score'
type Step = { id: StepId; label: string; status: 'pending' | 'active' | 'done'; metric?: string }
type Brand = { name: string; images: string[] }

const STEPS0: Step[] = [
  { id: 'store', label: 'Casing your store', status: 'pending' },
  { id: 'rivals', label: 'Finding your rivals', status: 'pending' },
  { id: 'winners', label: 'Reading their winning ads', status: 'pending' },
  { id: 'gaps', label: 'Spotting your gaps', status: 'pending' },
  { id: 'score', label: 'Scoring your ad presence', status: 'pending' },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const domainOf = (u: string) => (u || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')

export default function ScanTheater() {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [steps, setSteps] = useState<Step[]>(STEPS0)
  const [stage, setStage] = useState<StepId>('store')
  const [pct, setPct] = useState(0)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [comps, setComps] = useState<Comp[]>([])
  const [res, setRes] = useState<FullDnaResult | null>(null)
  const [gateEmail, setGateEmail] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const running = useRef(false)

  const setStep = useCallback((id: StepId, status: Step['status'], metric?: string) => {
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, status, metric: metric ?? x.metric } : x)))
  }, [])

  const run = useCallback(async () => {
    const u = url.trim()
    if (!u || running.current) return
    running.current = true
    setPhase('running'); setStage('store'); setStep('store', 'active'); setPct(8)

    try {
      // ── Act 1 · casing the store (brand + products) ──
      const det = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u }) }).then((r) => r.json()).catch(() => null)
      if (det?.error === 'Unauthorized' || det === null) throw new Error('auth')
      const b: Brand = { name: det?.brandName || domainOf(u), images: (det?.productImages || det?.images || []).slice(0, 6) }
      setBrand(b); setStep('store', 'done', b.images.length ? `${b.images.length} products` : b.name); setPct(22)
      await sleep(700)

      // ── Act 2 · find rivals (keywords → directory/pages search, same as onboarding) ──
      setStage('rivals'); setStep('rivals', 'active')
      const ana = await fetch('/api/interview/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u }) }).then((r) => r.json()).catch(() => null)
      const niche: string | null = ana?.niche || null
      const kws: string[] = (ana?.keywords?.length ? ana.keywords : [ana?.niche]).filter(Boolean).slice(0, 3)
      const found = new Map<string, Comp>()
      await Promise.all(kws.map(async (kw) => {
        const [br, pg] = await Promise.all([
          fetch(`/api/discovery/brands?q=${encodeURIComponent(kw)}&sort=ads`).then((r) => r.json()).catch(() => null),
          fetch(`/api/discovery/pages?q=${encodeURIComponent(kw)}`).then((r) => r.json()).catch(() => null),
        ])
        for (const x of (br?.brands || [])) if (x?.pageId) found.set(x.pageId, { pageId: x.pageId, name: x.name, avatar: x.avatar, adCount: x.adCount })
        for (const x of (pg?.pages || [])) if (x?.pageId && !found.has(x.pageId)) found.set(x.pageId, { pageId: x.pageId, name: x.name, avatar: x.picture, adCount: x.adCount })
      }))
      const rivals = Array.from(found.values()).sort((a, c) => (c.adCount || 0) - (a.adCount || 0)).slice(0, 6)
      setComps(rivals); setStep('rivals', 'done', `${rivals.length} found`); setPct(40)
      if (!rivals.length) throw new Error('norivals')
      await sleep(700)

      // ── Acts 3–5 · the DNA engine (winners + gaps + score + prescriptions) ──
      setStage('winners'); setStep('winners', 'active')
      const dna: FullDnaResult = await fetch('/api/onboarding/dna', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandName: b.name, competitorPageIds: rivals.map((r) => r.pageId), niche }),
      }).then((r) => { if (!r.ok) throw new Error('dna'); return r.json() })
      setRes(dna)
      setStep('winners', 'done', `${dna.winners.winnerCount} proven winners`); setPct(64)
      await sleep(900)

      setStage('gaps'); setStep('gaps', 'active'); await sleep(700)
      setStep('gaps', 'done', `${dna.gaps.length} gaps`); setPct(82)

      setStage('score'); setStep('score', 'active'); await sleep(700)
      setStep('score', 'done', `${dna.score.total}/100`); setPct(100)
      await sleep(500)
      setPhase('done')
    } catch (e) {
      const msg = String((e as Error).message)
      setErrMsg(msg === 'auth' ? 'Please sign in to run a scan (v1 is logged-in only).' : msg === 'norivals' ? "Couldn't find competitors for that site yet." : 'Scan hit a snag — try another URL.')
      setPhase('error'); running.current = false
    }
  }, [url, setStep])

  // ── IDLE: the door ──
  if (phase === 'idle') {
    return (
      <div style={{ minHeight: '100vh', background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <div style={{ fontFamily: 'Fraunces,serif', fontStyle: 'italic', color: '#c8410f', fontSize: 20, marginBottom: 8 }}>free · 90 seconds · no setup</div>
          <h1 style={{ fontFamily: 'Fraunces,Georgia,serif', fontSize: 'clamp(38px,7vw,60px)', lineHeight: .98, letterSpacing: '-.02em', color: INK, margin: '0 0 16px' }}>Spy on your competitors&rsquo; ads.</h1>
          <p style={{ color: SUB, fontSize: 18, margin: '0 0 26px' }}>Type your store URL. We&rsquo;ll show you what&rsquo;s winning in your market — and the gaps you can own.</p>
          <div style={{ display: 'flex', gap: 10, maxWidth: 440, margin: '0 auto' }}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="yourstore.com"
              style={{ flex: 1, padding: '14px 18px', borderRadius: 100, border: `1.5px solid ${LINE}`, fontSize: 16, background: '#fff', color: INK, outline: 'none' }} />
            <button onClick={run} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '14px 26px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>Run the scan →</button>
          </div>
        </div>
      </div>
    )
  }

  const topHooks = res?.winners.dist.hook_type || []
  const topFormats = res?.winners.dist.format_style || []
  const topAngles = res?.winners.dist.angle || []

  return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'grid', gridTemplateColumns: 'minmax(0,300px) minmax(0,1fr)', gap: 0 }}>
      {/* ── SIDEBAR (dark, sticky) ── */}
      <aside style={{ background: DARK, color: CREAM, padding: '28px 24px', position: 'sticky', top: 0, alignSelf: 'start', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 22, color: '#fff' }}>{phase === 'done' ? 'Scan complete' : 'Scanning your ads'}</div>
        <div style={{ color: MUT, fontSize: 13.5, margin: '6px 0 24px', lineHeight: 1.45 }}>Reads your rivals&rsquo; ads, keeps only the proven winners, finds your gaps. No setup.</div>
        <div style={{ flex: 1 }}>
          {steps.map((s) => (
            <div key={s.id} style={{ padding: '10px 0', borderBottom: `1px solid rgba(255,255,255,.07)` }}>
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

      {/* ── STAGE ── */}
      <main style={{ padding: 'clamp(28px,5vw,64px)', maxWidth: 900 }}>
        {phase === 'error' && (
          <div><h2 style={h2}>{errMsg}</h2><button onClick={() => { setPhase('idle'); setSteps(STEPS0); setPct(0); running.current = false }} style={btn}>Try again</button></div>
        )}

        {phase !== 'error' && phase !== 'done' && (
          <StageAct stage={stage} brand={brand} comps={comps} res={res} topHooks={topHooks} topFormats={topFormats} topAngles={topAngles} />
        )}

        {phase === 'done' && res && (
          <ScoreAct res={res} unlocked={unlocked} email={gateEmail} setEmail={setGateEmail} onUnlock={() => setUnlocked(true)} />
        )}
      </main>
    </div>
  )
}

// ── the live acts ──
function StageAct({ stage, brand, comps, res, topHooks, topFormats, topAngles }: { stage: StepId; brand: Brand | null; comps: Comp[]; res: FullDnaResult | null; topHooks: Tally[]; topFormats: Tally[]; topAngles: Tally[] }) {
  if (stage === 'store') return (
    <div>
      <h2 style={h2}>Casing {brand?.name || 'your store'}</h2>
      <p style={sub}>Pulling your products and the way you show up — so we can rebuild what&rsquo;s working, for you.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
        {(brand?.images || []).map((src, i) => <div key={i} style={{ width: 120, height: 120, borderRadius: 12, background: `#eee url(${src}) center/cover`, border: `1px solid ${LINE}` }} />)}
      </div>
    </div>
  )
  if (stage === 'rivals') return (
    <div>
      <h2 style={h2}>Meet the neighbours</h2>
      <p style={sub}>The competitors fighting for your buyers&rsquo; attention right now.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
        {comps.map((c) => (
          <div key={c.pageId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '8px 16px 8px 8px' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: `#eee ${c.avatar ? `url(${c.avatar}) center/cover` : ''}` }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>{c.name}</span>
            {c.adCount ? <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11.5, color: ORANGE }}>{c.adCount} ads</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
  // winners / gaps share the DNA
  if (stage === 'winners') return (
    <div>
      <h2 style={h2}>What&rsquo;s <span style={{ color: ORANGE }}>winning</span> in your market</h2>
      <p style={sub}>Of {res?.winners.sampleSize.toLocaleString() || '…'} rival ads, {res?.winners.winnerCount.toLocaleString() || '…'} have run 90+ days — proven money-makers. The patterns they share:</p>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '18px 0 8px' }}>
        {(res?.winners.examples || []).map((ex) => (
          <div key={ex.adId} style={{ flex: '0 0 150px', width: 150, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ height: 108, background: `#f1ece2 ${ex.thumb ? `url(${ex.thumb}) center/cover` : ''}` }} />
            <div style={{ padding: '9px 10px 11px' }}>
              <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 700, color: ORANGE }}>{ex.daysRunning}d running</div>
              <div style={{ fontSize: 11.5, color: INK, lineHeight: 1.3, marginTop: 3, maxHeight: 46, overflow: 'hidden' }}>{ex.hook || ex.brand}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {[...topHooks.slice(0, 3), ...topFormats.slice(0, 2), ...topAngles.slice(0, 2)].map((t, i) => (
          <span key={i} style={chip}>{t.label} <b style={{ color: ORANGE }}>{t.pct}%</b></span>
        ))}
      </div>
    </div>
  )
  if (stage === 'gaps') return (
    <div>
      <h2 style={h2}>The gaps you can own</h2>
      <p style={sub}>Winning tactics your rivals lean on that you&rsquo;re not running.</p>
      <div style={{ marginTop: 16 }}>
        {(res?.gaps || []).slice(0, 8).map((g, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ color: ORANGE, fontWeight: 900 }}>→</span>
            <div><b style={{ color: INK, fontSize: 14.5 }}>{g.dimension}: {g.label}</b>
              <div style={{ color: SUB, fontSize: 13 }}>{g.winnerPct}% of winners use it — you&rsquo;re at {g.yourPct}%.</div></div>
          </div>
        ))}
      </div>
    </div>
  )
  return null
}

// ── the score + gate ──
function ScoreAct({ res, unlocked, email, setEmail, onUnlock }: { res: FullDnaResult; unlocked: boolean; email: string; setEmail: (s: string) => void; onUnlock: () => void }) {
  const s = res.score
  const color = s.total < 40 ? '#c0281a' : s.total < 60 ? '#b7791f' : '#1e7a4f'
  const C = 2 * Math.PI * 78
  return (
    <div>
      <h2 style={h2}>Your ad-presence score</h2>
      <p style={sub}>One number across coverage, format mix, angles, and the winning tactics you&rsquo;re missing.</p>
      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'center', margin: '26px 0' }}>
        <div style={{ position: 'relative', width: 180, height: 180, flex: 'none' }}>
          <svg width="180" height="180" viewBox="0 0 180 180">
            <circle cx="90" cy="90" r="78" fill="none" stroke="rgba(26,20,16,.1)" strokeWidth="12" />
            <circle cx="90" cy="90" r="78" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - s.total / 100)} transform="rotate(-90 90 90)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 46, color: INK, lineHeight: 1 }}>{s.total}</div>
            <div style={{ fontSize: 11, color: SUB, letterSpacing: '.1em' }}>OF 100</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'inline-block', background: `${color}18`, color, fontWeight: 800, fontSize: 13, padding: '6px 14px', borderRadius: 100, marginBottom: 14 }}>{s.band}</div>
          {s.subscores.map((ss) => (
            <div key={ss.key} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '9px 0' }}>
              <span style={{ width: 120, fontSize: 13, color: SUB }}>{ss.label}</span>
              <div style={{ flex: 1, height: 6, background: 'rgba(26,20,16,.08)', borderRadius: 100 }}>{ss.value != null && <div style={{ height: 6, width: `${ss.value}%`, background: ORANGE, borderRadius: 100 }} />}</div>
              <span style={{ width: 52, textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontSize: 12, color: ss.value != null ? INK : MUT }}>{ss.value != null ? ss.value : 'n/a'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* the gift + gate */}
      <div style={{ background: DARK, borderRadius: 20, padding: '30px 30px', marginTop: 10, color: CREAM }}>
        <h3 style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 24, color: '#fff', margin: '0 0 8px' }}>While you watched, we drafted your comeback.</h3>
        <p style={{ color: MUT, fontSize: 14.5, margin: '0 0 18px' }}>{res.report.prescriptions.length} ready-to-make ads, built from the winning DNA you&rsquo;re missing.</p>
        <div style={{ display: 'grid', gap: 10, position: 'relative' }}>
          {res.report.prescriptions.map((p, i) => (
            <div key={i} style={{ background: DARK2, borderRadius: 12, padding: '14px 16px', filter: unlocked ? 'none' : 'blur(6px)', userSelect: unlocked ? 'auto' : 'none' }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{p.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[['Hook', p.hook], ['Format', p.format], ['Offer', p.offer]].filter(([, v]) => v).map(([k, v]) => <span key={k as string} style={{ fontSize: 11.5, background: 'rgba(255,255,255,.08)', borderRadius: 7, padding: '4px 9px' }}><b style={{ color: '#ff9f7a' }}>{k}:</b> {v}</span>)}
              </div>
            </div>
          ))}
          {!unlocked && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <div style={{ fontSize: 14, color: '#fff', fontWeight: 700 }}>Where should we send them?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" style={{ padding: '11px 16px', borderRadius: 100, border: 'none', fontSize: 14, width: 220 }} />
                <button onClick={() => email.includes('@') && onUnlock()} style={{ ...btn, padding: '11px 22px' }}>Unlock →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const h2: CSSProperties = { fontFamily: 'Fraunces,Georgia,serif', fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.02em', lineHeight: 1.05, color: INK, margin: '0 0 10px' }
const sub: CSSProperties = { color: SUB, fontSize: 17, maxWidth: 620, margin: 0, lineHeight: 1.5 }
const chip: CSSProperties = { fontSize: 12.5, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '6px 13px', color: INK }
const btn: CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }
