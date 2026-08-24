'use client'
/**
 * AuditTheater — the public SEO scan (Ryze-style). Enter a domain → a LIVE "scanning your website" theater
 * that streams REAL findings per step (spam %, catalog count, Google ranks, AI reads) via SSE → a gated
 * report (score gauge + sections, SERP ladder, per-AI cards, each finding "Agent can fix") → the offer.
 * Real data from /api/audit/stream. Mobile responsive. Preview/branch only.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'

const INK = '#141d15', SUB = '#6f7a70', LINE = '#ececec', GOOD = '#1f8f4e', RED = '#e5484d', LIME = '#ff5a2c', PAPER = '#faf9f5', DARK = '#161311'

type Finding = { id: string; title: string; detail: string; severity: 'high' | 'medium' | 'low'; sample?: string[]; fixable: boolean }
type LadderRow = { keyword: string; volume: number | null; yourPosition: number | null; top: { domain: string; position: number }[] }
type AiRead = { engine: string; mentioned: boolean; question: string; answer: string }
type Section = { key: string; name: string; sub: string; score: number; findings: Finding[]; ladder?: LadderRow[]; ai?: { question: string; reads: AiRead[] } }
type Result = { domain: string; siteName: string; category: string; score: number; grade: string; websiteScore: number; visibilityScore: number; sections: Section[]; ai: { question: string; reads: AiRead[] }; revenueLostPerYear: number; currency: string; problemCount: number }

const STEPS = [
  { key: 'health', label: 'Website health' }, { key: 'speed', label: 'Website speed' }, { key: 'spam', label: 'Spam-update check' },
  { key: 'catalog', label: 'Your catalog' }, { key: 'google', label: 'Google visibility' }, { key: 'backlinks', label: 'Backlinks' }, { key: 'ai', label: 'AI visibility' }, { key: 'revenue', label: 'Revenue you’re losing' },
]
const engLabel = (e: string) => e === 'chatgpt' ? 'ChatGPT' : e === 'gemini' ? 'Gemini' : e === 'perplexity' ? 'Perplexity' : e

export default function AuditTheater() {
  const isMobile = useIsMobile()
  const [phase, setPhase] = useState<'idle' | 'running' | 'report' | 'offer'>('idle')
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [live, setLive] = useState<Record<string, Section>>({})   // sections as they stream in
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const timer = useRef<any>(null)
  const doneRef = useRef<Result | null>(null)

  const run = useCallback(async () => {
    const d = domain.trim()
    if (!d || !d.includes('.')) { setError('Enter a real website, like yourstore.com'); return }
    setError(null); setPhase('running'); setStep(0); setLive({}); doneRef.current = null
    timer.current = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 2800)
    try {
      const res = await fetch(`/api/audit/stream?domain=${encodeURIComponent(d)}`)
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() || ''
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data: ')); if (!line) continue
          const ev = JSON.parse(line.slice(6))
          if (ev.type === 'section') setLive((m) => ({ ...m, [ev.section.key]: ev.section }))
          else if (ev.type === 'done') { doneRef.current = ev.result; clearInterval(timer.current); setStep(STEPS.length - 1) }
          else if (ev.type === 'error') { clearInterval(timer.current); setError(ev.error); setPhase('idle') }
        }
      }
    } catch { clearInterval(timer.current); setError('Network error — try again.'); setPhase('idle') }
  }, [domain])
  useEffect(() => () => clearInterval(timer.current), [])
  // when the timer reaches the end AND we have a result, go to report
  useEffect(() => { if (phase === 'running' && step >= STEPS.length - 1 && doneRef.current) { setResult(doneRef.current); setTimeout(() => setPhase('report'), 500) } }, [step, phase])

  if (phase === 'idle') return (
    <div style={{ minHeight: '100dvh', background: DARK, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 560, textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: LIME, marginBottom: 16 }}>Free SEO X-ray</div>
        <h1 style={{ fontSize: isMobile ? 30 : 42, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 0 14px' }}>Is your store invisible on Google &amp; AI?</h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,.65)', lineHeight: 1.5, margin: '0 0 28px' }}>Enter your website. In ~30 seconds we check your search health, your catalog, and whether ChatGPT even mentions you — no login.</p>
        <div style={{ display: 'flex', gap: 10, flexDirection: isMobile ? 'column' : 'row', maxWidth: 460, margin: '0 auto' }}>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="yourstore.com" autoFocus
            style={{ flex: 1, padding: '15px 18px', fontSize: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#fff', fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={run} style={{ background: LIME, color: '#fff', border: 'none', borderRadius: 12, padding: '15px 24px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Scan my site →</button>
        </div>
        {error && <div style={{ color: '#ffb3b3', fontSize: 14, marginTop: 12 }}>{error}</div>}
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.4)', marginTop: 16 }}>Reads only what’s public. No account, no card.</div>
      </div>
    </div>
  )

  const Sidebar = () => (
    <aside style={{ background: DARK, color: '#fff', padding: isMobile ? 20 : 26, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {phase === 'report' && result ? (
        <>
          <Gauge score={result.score} grade={result.grade} />
          <SubScore label="Your website" value={result.websiteScore} />
          <SubScore label="Search visibility" value={result.visibilityScore} />
          <div style={{ marginTop: 'auto', paddingTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Fix everything in minutes</div>
            <button onClick={() => setPhase('offer')} style={{ width: '100%', background: '#fff', color: DARK, border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>⚡ Fix in 30 minutes</button>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', textAlign: 'center', marginTop: 10 }}>Read-only until you approve each fix</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 800 }}>Scanning your website</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginTop: 8, lineHeight: 1.5 }}>Checks across search, speed, catalog and competitors. No setup needed.</div>
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 13 }}>
            {STEPS.map((s, i) => {
              const sec = live[s.key]
              return (
                <div key={s.key} style={{ opacity: i <= step ? 1 : 0.4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 100, flex: 'none', border: `2px solid ${i < step ? GOOD : i === step ? LIME : 'rgba(255,255,255,.25)'}`, background: i < step ? GOOD : 'transparent', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{i < step ? '✓' : ''}</span>
                    <span style={{ fontSize: 14.5, fontWeight: i === step ? 800 : 600, flex: 1 }}>{s.label}</span>
                    {sec && <span style={{ fontSize: 11, color: sec.score >= 70 ? GOOD : sec.findings.length ? '#ffb37a' : 'rgba(255,255,255,.5)' }}>{sec.findings.length ? `${sec.findings.length} found` : 'ok'}</span>}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 24 }}>
            <div style={{ height: 6, borderRadius: 100, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(((step + 1) / STEPS.length) * 100)}%`, background: LIME, transition: 'width .5s' }} /></div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 8 }}>Working… {Math.round(((step + 1) / STEPS.length) * 100)}%</div>
          </div>
        </>
      )}
    </aside>
  )

  if (phase === 'offer' && result) return <Offer result={result} onBack={() => setPhase('report')} isMobile={isMobile} />

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,300px) minmax(0,1fr)', background: PAPER, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar />
      <main style={{ padding: isMobile ? '22px 18px 60px' : '40px 48px 80px', minWidth: 0, background: PAPER }}>
        {phase === 'running' ? <RunningStage step={step} live={live} isMobile={isMobile} />
          : result ? <Report result={result} open={open} setOpen={setOpen} isMobile={isMobile} /> : null}
      </main>
    </div>
  )
}

/* ── Running stage (real data when it has streamed in) ─────────────────────────────────────────── */
function RunningStage({ step, live, isMobile }: { step: number; live: Record<string, Section>; isMobile: boolean }) {
  const s = STEPS[step]
  const titles: Record<string, string> = { health: 'Reading your pages', speed: 'How fast do you load?', spam: 'Did Google’s spam update target you?', catalog: 'Your catalog, product by product', google: 'Where do buyers find you?', backlinks: 'Who links to you?', ai: 'Do the AIs mention you?', revenue: 'What it’s costing you' }
  const blurbs: Record<string, string> = {
    health: 'Reading your meta descriptions, headings and image alt text across your pages.',
    speed: 'Pulling real-visitor load times from Chrome UX data.',
    spam: 'Google’s spam update demotes scaled, template-generated content. We read your sitemap and estimate how much of your site matches that pattern.',
    catalog: 'We open your product pages and check what Google and shoppers need to see.',
    google: 'Checking where buyers find you first, and who’s taking the click.',
    backlinks: 'Comparing your backlink profile to the rivals who outrank you.',
    ai: 'Really asking ChatGPT, Gemini & Perplexity for your category — do you come up?',
    revenue: 'Adding up what all of this is costing you.',
  }
  return (
    <>
      <style>{`@keyframes aSweep{from{stroke-dashoffset:var(--c)}to{stroke-dashoffset:var(--off)}}@keyframes aOrbit{to{transform:rotate(360deg)}}@keyframes aFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes aFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ minHeight: isMobile ? 'auto' : '72vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ maxWidth: 640, marginBottom: isMobile ? 22 : 30, animation: 'aFade .4s ease' }} key={s.key}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: LIME, marginBottom: 10 }}>Step {step + 1} of {STEPS.length}</div>
          <h1 style={{ fontSize: isMobile ? 26 : 40, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 0 12px', color: INK }}>{titles[s.key]}</h1>
          <p style={{ fontSize: isMobile ? 15 : 16.5, color: SUB, lineHeight: 1.5, margin: 0 }}>{blurbs[s.key]}</p>
        </div>
        <div style={{ animation: 'aFade .5s ease', display: 'flex', justifyContent: 'center' }} key={s.key + '-v'}>
          {s.key === 'spam' ? <SpamGauge sec={live.spam} isMobile={isMobile} />
            : s.key === 'catalog' ? <CatalogCards sec={live.catalog} isMobile={isMobile} />
            : s.key === 'google' && live.google?.ladder?.length ? <MiniLadder rows={live.google.ladder!} isMobile={isMobile} />
            : <ScanPulse isMobile={isMobile} />}
        </div>
      </div>
    </>
  )
}

function SpamGauge({ sec, isMobile }: { sec?: Section; isMobile: boolean }) {
  const total = sec ? Number((sec.sub.match(/(\d+)/) || [])[1] || 0) : 0
  const maxDay = sec?.findings.length ? Number((sec.findings[0].title.match(/(\d+)/) || [])[1] || 0) : 0
  const suspicious = total && maxDay ? Math.min(0.35, maxDay / total) : 0
  const healthy = 1 - suspicious
  const size = isMobile ? 280 : 360, cx = size / 2, cy = size / 2, r = size * 0.28, C = 2 * Math.PI * r
  const off = C * (1 - Math.max(0.04, suspicious || 0.06))
  const risk = suspicious > 0.15 ? 'HIGH' : suspicious > 0.05 ? 'MED' : 'LOW'
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 640 }}>
      <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', margin: '0 auto', maxWidth: size }}>
        {[0.46, 0.38, 0.30].map((f, i) => <circle key={i} cx={cx} cy={cy} r={size * f} fill="none" stroke="#e7ebf0" strokeWidth="1.5" strokeDasharray="2 6" />)}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eceff3" strokeWidth={size * 0.055} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={DARK} strokeWidth={size * 0.055} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cy})`} style={{ ['--c' as any]: C, ['--off' as any]: off, animation: 'aSweep 1.1s ease forwards' }} />
        <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'aOrbit 6s linear infinite' }}><circle cx={cx} cy={cy - size * 0.46} r="4" fill={RED} /></g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ background: risk === 'LOW' ? '#eaf6ec' : '#fff4e6', color: risk === 'LOW' ? GOOD : '#c98a1a', fontWeight: 800, fontSize: isMobile ? 15 : 18, borderRadius: 10, padding: '6px 16px' }}>{risk}</div>
      </div>
      {!isMobile && total > 0 && <>
        <Callout style={{ top: '28%', left: 0 }} label="Healthy pages" big={`${Math.round(healthy * 100)}%`} sub={`${Math.round(healthy * total)} pages`} col={GOOD} />
        <Callout style={{ top: '18%', right: 0 }} label="Flagged" big={`${Math.round(suspicious * 100)}%`} sub={`${Math.round(suspicious * total)} pages`} col={suspicious ? RED : SUB} align="right" />
      </>}
    </div>
  )
}
function Callout({ style, label, big, sub, col, align }: { style: React.CSSProperties; label: string; big: string; sub: string; col: string; align?: 'right' }) {
  return <div style={{ position: 'absolute', textAlign: align || 'left', ...style }}><div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: SUB }}>{label}</div><div style={{ fontSize: 26, fontWeight: 800, color: col, lineHeight: 1 }}>{big}</div><div style={{ fontSize: 11.5, color: SUB }}>{sub}</div></div>
}

function CatalogCards({ sec, isMobile }: { sec?: Section; isMobile: boolean }) {
  const altFind = sec?.findings.find((f) => f.id === 'prodalt')
  const name = altFind?.sample?.[0] || sec?.findings.find((f) => f.id === 'thin')?.sample?.[0] || 'Product'
  const gap = altFind ? altFind.title : (sec?.findings[0]?.title || 'Checking products…')
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 560, height: isMobile ? 220 : 260 }}>
      {[2, 1, 0].map((depth) => (
        <div key={depth} style={{ position: 'absolute', inset: 0, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, boxShadow: '0 10px 30px rgba(0,0,0,.06)', transform: `translate(${depth * 10}px, ${depth * -10}px) rotate(${depth * 1.4}deg)`, opacity: depth === 0 ? 1 : 0.55 - depth * 0.12, zIndex: 10 - depth }}>
          {depth === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: isMobile ? 16 : 26, height: '100%', animation: 'aFloat 3s ease-in-out infinite' }}>
              <div style={{ width: isMobile ? 92 : 130, height: isMobile ? 92 : 130, borderRadius: 14, background: 'linear-gradient(135deg,#f5efe8,#efe6f0)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>🛍️</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: isMobile ? 16 : 21, fontWeight: 800, color: INK, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, background: '#fdecea', color: RED, borderRadius: 100, padding: '7px 14px', fontSize: isMobile ? 12 : 13.5, fontWeight: 700 }}><span style={{ width: 7, height: 7, borderRadius: 100, background: RED }} /> {gap}</div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
function MiniLadder({ rows, isMobile }: { rows: LadderRow[]; isMobile: boolean }) {
  const r = rows[0]
  return (
    <div style={{ width: '100%', maxWidth: 520, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: isMobile ? 16 : 22, boxShadow: '0 10px 30px rgba(0,0,0,.05)' }}>
      <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: INK }}>“{r.keyword}”{r.volume ? <span style={{ color: SUB, fontWeight: 500, fontSize: 13 }}> · {r.volume.toLocaleString()}/mo</span> : ''}</div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {r.top.slice(0, 3).map((t, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#3a453c', borderTop: i ? `1px solid ${LINE}` : 'none', padding: '7px 0' }}><span>{i + 1}. {t.domain}</span><span style={{ color: SUB }}>#{t.position}</span></div>)}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 8, marginTop: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>you</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: RED, background: '#fdecea', borderRadius: 100, padding: '3px 10px' }}>{r.yourPosition == null ? 'not in top 50' : `#${r.yourPosition}`}</span>
        </div>
      </div>
    </div>
  )
}
function ScanPulse({ isMobile }: { isMobile: boolean }) {
  const size = isMobile ? 220 : 300
  return <div style={{ position: 'relative', width: size, height: size }}>{[0.5, 0.38, 0.26].map((f, i) => <div key={i} style={{ position: 'absolute', inset: `${(0.5 - f) * size}px`, border: '1.5px dashed #e2e6ea', borderRadius: '50%' }} />)}<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: size * 0.3, height: size * 0.3, borderRadius: '50%', border: `3px solid ${LINE}`, borderTopColor: LIME, animation: 'aOrbit 1s linear infinite' }} /></div></div>
}

/* ── Report ───────────────────────────────────────────────────────────────────────────────────── */
function Report({ result, open, setOpen, isMobile }: { result: Result; open: Record<string, boolean>; setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void; isMobile: boolean }) {
  const money = (n: number) => `${result.currency}${n.toLocaleString()}`
  return (
    <>
      <h1 style={{ fontSize: isMobile ? 24 : 30, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: INK }}>Your full report — {result.problemCount} problems found</h1>
      <p style={{ fontSize: 15.5, color: SUB, margin: '0 0 30px', lineHeight: 1.5, maxWidth: 640 }}>Everything we found across Google, your catalog, AI assistants and your site — and what fixing it is worth.</p>

      {result.sections.map((sec, si) => (
        <section key={sec.key} style={{ marginBottom: 34 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${LINE}`, paddingBottom: 10, marginBottom: 14 }}>
            <div><div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 800, color: INK }}><span style={{ color: SUB, fontWeight: 600, marginRight: 8 }}>{si + 1}.</span>{sec.name}</div><div style={{ fontSize: 13.5, color: SUB, marginTop: 2 }}>{sec.sub}</div></div>
            <div style={{ fontSize: 18, fontWeight: 800, color: sec.score >= 70 ? GOOD : sec.score >= 40 ? '#c98a1a' : RED, flex: 'none' }}>{sec.score}/100</div>
          </div>
          {sec.findings.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, background: '#fff' }}><span style={{ color: GOOD, fontSize: 18 }}>✓</span><span style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>Looks good — nothing to fix here.</span></div>
          ) : sec.findings.map((f) => (
            <div key={f.id} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', marginBottom: 10, overflow: 'hidden' }}>
              <button onClick={() => f.sample?.length && setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 16, cursor: f.sample?.length ? 'pointer' : 'default', fontFamily: 'inherit', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ width: 22, height: 22, borderRadius: 100, flex: 'none', background: f.severity === 'high' ? '#fdecea' : '#fff4e6', color: f.severity === 'high' ? RED : '#c98a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, marginTop: 1 }}>✕</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: INK }}>{f.title}</span><span style={{ display: 'block', fontSize: 13.5, color: SUB, marginTop: 2 }}>{f.detail}</span></span>
                {f.fixable && <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 800, color: GOOD, background: '#eaf6ec', borderRadius: 100, padding: '4px 11px' }}>Agent can fix</span>}
              </button>
              {open[f.id] && f.sample?.length ? <div style={{ borderTop: `1px solid ${LINE}`, padding: '10px 16px', background: PAPER }}>{f.sample.slice(0, 6).map((s, i) => <div key={i} style={{ fontSize: 12.5, color: '#4a544c', fontFamily: 'monospace', padding: '5px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>{s}</div>)}</div> : null}
            </div>
          ))}

          {/* SERP ladder (Google visibility) */}
          {sec.ladder && sec.ladder.length > 0 && sec.ladder.map((r) => (
            <div key={r.keyword} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16, marginBottom: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>“{r.keyword}”{r.volume ? <span style={{ color: SUB, fontWeight: 500, fontSize: 13 }}> · {r.volume.toLocaleString()} searches/mo</span> : ''}</div>
              <div style={{ marginTop: 10 }}>
                {r.top.slice(0, 3).map((t, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#3a453c', borderTop: i ? `1px solid ${LINE}` : 'none', padding: '7px 0' }}><span>{i + 1}. {t.domain}</span><span style={{ color: SUB }}>#{t.position}</span></div>)}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 8 }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>{result.domain}</span><span style={{ fontSize: 12, fontWeight: 700, color: RED, background: '#fdecea', borderRadius: 100, padding: '3px 10px' }}>{r.yourPosition == null ? 'not in top 50' : `#${r.yourPosition}`}</span></div>
              </div>
            </div>
          ))}

          {/* per-AI cards (AI visibility) */}
          {sec.key === 'ai' && result.ai.reads.map((rd) => (
            <div key={rd.engine} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: INK }}>{engLabel(rd.engine)} {rd.mentioned ? <span style={{ color: GOOD, fontSize: 13 }}>mentions you ✓</span> : <span style={{ color: RED, fontSize: 13 }}>doesn’t mention you</span>}</div>
                {!rd.mentioned && <span style={{ fontSize: 12.5, fontWeight: 800, color: GOOD, background: '#eaf6ec', borderRadius: 100, padding: '4px 11px' }}>Agent can fix</span>}
              </div>
              <div style={{ fontSize: 12.5, color: SUB, margin: '8px 0 6px' }}>“{rd.question}”</div>
              <div style={{ fontSize: 13, color: '#3a453c', lineHeight: 1.55, maxHeight: 130, overflow: 'hidden', position: 'relative', background: PAPER, borderRadius: 10, padding: 12 }}>{rd.answer}<div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 44, background: `linear-gradient(transparent, ${PAPER})` }} /></div>
            </div>
          ))}
        </section>
      ))}

      <section style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `1px solid ${LINE}`, paddingBottom: 10, marginBottom: 14 }}>
          <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 800, color: INK }}><span style={{ color: SUB, fontWeight: 600, marginRight: 8 }}>{result.sections.length + 1}.</span>What it’s costing you</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: RED }}>−{money(result.revenueLostPerYear)}/yr</div>
        </div>
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16, fontSize: 14, color: SUB, lineHeight: 1.6 }}>A conservative estimate from the {result.problemCount} fixable problems above, the buyer searches where rivals take the click, and the AI assistants that skip you. Every one is something our agent fixes for you.</div>
      </section>
    </>
  )
}

function Gauge({ score, grade }: { score: number; grade: string }) {
  const r = 54, C = 2 * Math.PI * r, off = C * (1 - score / 100), col = score >= 60 ? GOOD : score >= 40 ? '#e0a92b' : RED
  return (
    <div style={{ textAlign: 'center', marginBottom: 18 }}>
      <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto' }}>
        <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}><circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="10" /><circle cx="70" cy="70" r={r} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} /></svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{score}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>of 100</div></div>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 10 }}>Search health grade</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: col, marginTop: 2 }}>{grade}</div>
    </div>
  )
}
function SubScore({ label, value }: { label: string; value: number }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '12px 14px', marginBottom: 10, background: 'rgba(255,255,255,.03)' }}><div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{label}</div><div style={{ fontSize: 13, color: value >= 60 ? GOOD : value >= 40 ? '#e0a92b' : RED, fontWeight: 800 }}>{value} of 100</div></div>
}

function Offer({ result, onBack, isMobile }: { result: Result; onBack: () => void; isMobile: boolean }) {
  const money = (n: number) => `${result.currency}${n.toLocaleString()}`
  return (
    <div style={{ minHeight: '100dvh', background: PAPER, fontFamily: 'Inter, system-ui, sans-serif', padding: isMobile ? '20px 16px 60px' : '40px 48px' }}>
      <button onClick={onBack} style={{ background: DARK, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 24 }}>← Back to report</button>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 380px', gap: 28, maxWidth: 1080 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 30 : 44, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.02, margin: '0 0 14px', color: INK }}>Fix all {result.problemCount} problems on {result.domain}</h1>
          <p style={{ fontSize: 16.5, color: SUB, lineHeight: 1.5, margin: '0 0 26px' }}>These problems cost {result.domain} ≈{money(result.revenueLostPerYear)}/yr. Your AI marketing team starts fixing them in the next 30 minutes — you approve every change.</p>
          <div style={{ fontSize: 13, fontWeight: 800, color: SUB, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 12 }}>What you get — priced like hiring it out</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12 }}>
            {[['$5,000/mo of work', 'SEO, content, catalog, competitor intel — a whole team'], ['Fixes in 30 min', 'Meta, alt text, schema — you approve each'], ['Real revenue', 'We bank the organic revenue against every fix'], ['First-Win Guarantee', '30 days or your money back — you keep the work']].map(([t, d], i) => (
              <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 14 }}><div style={{ color: GOOD, fontSize: 18, marginBottom: 6 }}>✓</div><div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{t}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 3, lineHeight: 1.4 }}>{d}</div></div>
            ))}
          </div>
        </div>
        <div style={{ background: DARK, borderRadius: 20, padding: 24, color: '#fff', alignSelf: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}><div style={{ fontSize: 19, fontWeight: 800 }}>Growth</div><div style={{ fontSize: 26, fontWeight: 800 }}>$149<span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>/mo</span></div></div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>Founding-100 price — locked for life</div>
          <div style={{ margin: '18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>{['Every SEO problem found & fixed for you', 'Blog + programmatic pages published monthly', 'Get cited in ChatGPT, Gemini & Perplexity', 'Competitor intel — take their traffic', 'Works with Shopify, WordPress & more'].map((t, i) => <div key={i} style={{ display: 'flex', gap: 9, fontSize: 13.5, color: 'rgba(255,255,255,.9)' }}><span style={{ color: GOOD }}>✓</span>{t}</div>)}</div>
          <button style={{ width: '100%', background: LIME, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Start — fix my site →</button>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.4)', textAlign: 'center', marginTop: 10 }}>First-Win Guarantee · cancel anytime</div>
        </div>
      </div>
    </div>
  )
}
