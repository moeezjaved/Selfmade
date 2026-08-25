'use client'
/**
 * AuditTheater — the public SEO scan (Ryze-style). Enter a domain → a LIVE "scanning your website" theater
 * that streams REAL findings per step (spam %, catalog count, Google ranks, AI reads) via SSE → a gated
 * report (score gauge + sections, SERP ladder, per-AI cards, each finding "Agent can fix") → the offer.
 * Real data from /api/audit/stream. Mobile responsive. Preview/branch only.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'
import AuditLanding from '@/components/audit/AuditLanding'

// Matches the ads audit: orange accent, cream paper, dark sidebar, Fraunces serif headings, /hero.mp4 entry.
const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', GOOD = '#1f8f4e', RED = '#e5484d', LIME = '#ef4a1e', PAPER = '#fbf4e2', DARK = '#1c1611'
const ENTRY_BG = '#e02f06'
const SERIF = 'Fraunces, Georgia, serif'

type Finding = { id: string; title: string; detail: string; severity: 'high' | 'medium' | 'low'; sample?: string[]; fixable: boolean }
type LadderRow = { keyword: string; volume: number | null; yourPosition: number | null; top: { domain: string; position: number }[] }
type AiRead = { engine: string; mentioned: boolean; question: string; answer: string }
type CatalogProduct = { title: string; price: number | null; image: string | null; url: string; missingAlt: number; thin: boolean; noSchema: boolean }
type Section = { key: string; name: string; sub: string; score: number; findings: Finding[]; ladder?: LadderRow[]; ai?: { question: string; reads: AiRead[] }; read?: { urls: string[]; thumbs: (string | null)[]; total: number; metaMissing: number; h1Missing: number; altMissing: number }; speed?: { lcpS: number | null; cls: number | null }; products?: CatalogProduct[]; backlinks?: { mineRef: number; mineLinks: number; rivalRef: number | null; rivalDomain: string | null } }
type RevenueModel = { lostVisits: number; conversion: number; aov: number; fromSearch: number; fromCatalog: number; fromAi: number; catalogGapProducts: number; missReads: number; missTotal: number; keywordLeaks: { keyword: string; visits: number; rival: string | null }[] }
type Result = { domain: string; siteName: string; category: string; score: number; grade: string; websiteScore: number; visibilityScore: number; sections: Section[]; ai: { question: string; reads: AiRead[] }; revenueLostPerYear: number; currency: string; problemCount: number; revenueModel?: RevenueModel }

const STEPS = [
  { key: 'health', label: 'Website health' }, { key: 'speed', label: 'Website speed' }, { key: 'spam', label: 'Spam-update check' },
  { key: 'catalog', label: 'Your catalog' }, { key: 'google', label: 'Google visibility' }, { key: 'backlinks', label: 'Backlinks' }, { key: 'ai', label: 'AI visibility' }, { key: 'revenue', label: 'Revenue you’re losing' },
]
const engLabel = (e: string) => e === 'chatgpt' ? 'ChatGPT' : e === 'gemini' ? 'Gemini' : e === 'perplexity' ? 'Perplexity' : e
const shorten = (t: string, n = 30) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

/** Live sub-metrics shown under the active step in the sidebar (Ryze-style). */
function subRows(key: string, sec?: Section): { label: string; value: string; ok: boolean }[] {
  if (!sec) return []
  if (key === 'health' && sec.read) {
    const r = sec.read
    return [
      { label: 'Reading pages', value: String(r.total), ok: true },
      { label: 'Missing meta descriptions', value: String(r.metaMissing), ok: r.metaMissing === 0 },
      { label: 'Missing H1 headings', value: String(r.h1Missing), ok: r.h1Missing === 0 },
      { label: 'Images without alt text', value: String(r.altMissing), ok: r.altMissing === 0 },
    ]
  }
  if (key === 'speed' && sec.speed) {
    const out: { label: string; value: string; ok: boolean }[] = []
    if (sec.speed.lcpS != null) out.push({ label: 'Measuring load speed', value: `${sec.speed.lcpS}s`, ok: sec.speed.lcpS <= 2.5 })
    if (sec.speed.cls != null) out.push({ label: 'Measuring layout stability', value: String(sec.speed.cls), ok: sec.speed.cls <= 0.1 })
    return out
  }
  if (key === 'catalog' && sec.products?.length) {
    const alt = sec.products.reduce((a, p) => a + p.missingAlt, 0), thin = sec.products.filter((p) => p.thin).length
    return [{ label: 'Checking alt text', value: `${alt} Missing`, ok: alt === 0 }, { label: 'Checking copy depth', value: `${thin} products`, ok: thin === 0 }]
  }
  if (key === 'google' && sec.ladder?.length) {
    return sec.ladder.slice(0, 3).map((r) => ({ label: `Searching “${shorten(r.keyword, 15)}”`, value: r.yourPosition == null ? '50+' : `#${r.yourPosition}`, ok: r.yourPosition != null && r.yourPosition <= 10 }))
  }
  if (key === 'ai' && sec.ai?.reads.length) {
    return sec.ai.reads.map((r) => ({ label: `Asking ${engLabel(r.engine)}`, value: r.mentioned ? 'Mentioned' : 'Not Mentioned', ok: r.mentioned }))
  }
  if (key === 'revenue') {
    const s = sec as Section & { _lost?: number; _cur?: string; _leaks?: number; _visits?: number }
    if (s._lost == null) return []
    return [
      { label: 'Finding revenue leaks', value: String(s._leaks ?? 0), ok: false },
      { label: 'Adding up lost visits', value: `${s._visits ?? 0}/mo`, ok: false },
      { label: 'Pricing what’s at stake', value: `${s._cur || '$'}${(s._lost || 0).toLocaleString()}/yr`, ok: false },
    ]
  }
  if (sec.findings.length) return sec.findings.slice(0, 4).map((f) => ({ label: shorten(f.title), value: '', ok: false }))
  return [{ label: 'No issues found', value: '', ok: true }]
}

/** The per-step verdict shown as an orange stripe (returns null until the step has data). */
function remark(key: string, sec?: Section & { _lost?: number; _cur?: string }): { title: string; sub: string; ok: boolean } | null {
  if (!sec) return null
  switch (key) {
    case 'health': {
      const r = sec.read; if (!r) return null
      const gaps = r.metaMissing + r.h1Missing + r.altMissing
      return gaps > 0
        ? { title: `${gaps} search gaps found across your pages`, sub: 'Missing meta descriptions, H1s and alt text — all fixable', ok: false }
        : { title: 'Your pages are clean', sub: 'Meta, headings and alt text all present', ok: true }
    }
    case 'speed': {
      const v = sec.speed?.lcpS; if (v == null) return null
      return v <= 2.5
        ? { title: `${v}s load — under Google’s 2.5s bar`, sub: 'Speed isn’t costing you sales — keep it that way', ok: true }
        : { title: `${v}s load — over Google’s 2.5s bar`, sub: 'Slow pages lose rankings and buyers — fixable', ok: false }
    }
    case 'spam': {
      const risky = sec.findings.some((f) => /publish|mass|scaled|template/i.test(f.title))
      return risky
        ? { title: 'Some pages look mass-published', sub: 'At risk from Google’s spam update — fixable', ok: false }
        : { title: 'Your pages don’t match the scaled-content pattern', sub: 'Google’s spam update is unlikely to target your site', ok: true }
    }
    case 'catalog': {
      const P = sec.products || []
      if (P.length) {
        const need = P.filter((p) => p.missingAlt > 0 || p.thin || p.noSchema).length
        return need
          ? { title: `${need} of ${P.length} products need work`, sub: 'Missing alt text, schema or descriptions — all fixable', ok: false }
          : { title: 'Your product pages are complete', sub: 'Schema, alt text and descriptions all present', ok: true }
      }
      return sec.findings.length
        ? { title: sec.findings[0].title, sub: 'Fixable across your product pages — with your approval', ok: false }
        : { title: 'Your product pages are complete', sub: 'Schema, alt text and descriptions all present', ok: true }
    }
    case 'google': {
      const r = sec.ladder?.[0]; if (!r) return null
      return r.yourPosition == null
        ? { title: 'You’re not in the top 50 for your key searches', sub: 'Rivals are taking the clicks — fixable', ok: false }
        : { title: `You rank #${r.yourPosition} for “${r.keyword}”`, sub: r.yourPosition <= 10 ? 'On page one — let’s push higher' : 'Below the fold — we can lift this', ok: r.yourPosition <= 10 }
    }
    case 'ai': {
      const reads = sec.ai?.reads || []; if (!reads.length) return null
      const misses = reads.filter((r) => !r.mentioned).length
      return misses
        ? { title: `${misses} of ${reads.length} AI assistants don’t mention you`, sub: 'We publish the answer content that gets you cited', ok: false }
        : { title: 'AI assistants already mention you', sub: 'We’ll keep you cited as answers change', ok: true }
    }
    case 'backlinks':
      return { title: 'You’re behind rivals on authority', sub: 'We build DA 40+ backlinks — guest posts, PR, Reddit', ok: false }
    case 'revenue': {
      const lost = sec._lost; if (!lost) return null
      return { title: 'Modelled from your traffic and rankings × conversion × average order', sub: 'Every month this stays unfixed, the money goes to a rival', ok: false }
    }
  }
  return null
}

export default function AuditTheater() {
  const isMobile = useIsMobile()
  const [phase, setPhase] = useState<'idle' | 'running' | 'ready' | 'report' | 'offer'>('idle')
  const [domain, setDomain] = useState('')
  const [rival, setRival] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [live, setLive] = useState<Record<string, Section>>({})   // sections as they stream in
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const timer = useRef<any>(null)
  const doneRef = useRef<Result | null>(null)
  const liveRef = useRef<Record<string, Section>>({})   // director reads streamed sections without stale closures

  const run = useCallback(async () => {
    const d = domain.trim()
    if (!d || !d.includes('.')) { setError('Enter a real website, like yourstore.com'); return }
    setError(null); setPhase('running'); setStep(0); setLive({}); doneRef.current = null; liveRef.current = {}
    // Director: walk each step at a deliberate, Ryze-slow pace. Every step dwells DWELL ms so its
    // visual is actually seen; a step that yields data waits (up to MAXWAIT) for it before advancing.
    // Data arrival never fast-forwards the theater — only fills each slide in as the director lands on it.
    const MAXWAIT = 16000                               // speed depends on a ~25s API — give it room to land
    const OPTIONAL = new Set(['backlinks'])             // may yield nothing (no rival) — don't stall waiting
    // health lingers longest (many live screenshots load); speed waits on PageSpeed; others steady.
    const dwellFor = (key: string) => (key === 'health' ? 13000 : key === 'google' ? 12000 : key === 'speed' ? 11000 : 8000)
    let i = 0, stopped = false
    const finish = () => { if (doneRef.current) { setResult(doneRef.current); setPhase('ready') } }
    const walk = () => {
      if (stopped) return
      setStep(i)
      const key = STEPS[i].key
      const D = dwellFor(key)
      const started = Date.now()
      const check = () => {
        if (stopped) return
        const elapsed = Date.now() - started
        if (i >= STEPS.length - 1) {                      // last slide: hold until the final result lands
          if (doneRef.current && elapsed >= D) { finish(); return }
          timer.current = setTimeout(check, 200); return
        }
        const hasData = !!liveRef.current[key]
        const ceil = OPTIONAL.has(key) ? D : MAXWAIT
        if (elapsed >= D && (hasData || elapsed >= ceil)) { i++; walk() }
        else timer.current = setTimeout(check, 200)
      }
      timer.current = setTimeout(check, 200)
    }
    const stop = () => { stopped = true; clearTimeout(timer.current) }
    walk()
    try {
      const rv = rival.trim()
      const res = await fetch(`/api/audit/stream?domain=${encodeURIComponent(d)}${rv ? `&rival=${encodeURIComponent(rv)}` : ''}`)
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() || ''
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data: ')); if (!line) continue
          const ev = JSON.parse(line.slice(6))
          if (ev.type === 'section') {
            liveRef.current = { ...liveRef.current, [ev.section.key]: ev.section }
            setLive((m) => ({ ...m, [ev.section.key]: ev.section }))
          } else if (ev.type === 'done') {
            doneRef.current = ev.result
            // Feed the revenue slide its number so the final tally has something to count to.
            const rev = { key: 'revenue', name: 'Revenue', sub: '', score: 0, findings: [], _lost: ev.result.revenueLostPerYear, _cur: ev.result.currency, _leaks: ev.result.problemCount, _visits: Math.max(20, Math.round(ev.result.revenueLostPerYear / 120)) } as any
            liveRef.current = { ...liveRef.current, revenue: rev }
            setLive((m) => ({ ...m, revenue: rev }))
          } else if (ev.type === 'error') { stop(); setError(ev.error); setPhase('idle') }
        }
      }
      if (!doneRef.current) { stop(); setError('Scan didn’t finish — try again.'); setPhase('idle') }
    } catch { stop(); setError('Network error — try again.'); setPhase('idle') }
  }, [domain, rival])
  useEffect(() => () => clearTimeout(timer.current), [])

  if (phase === 'idle') return (
    <>
      <section id="audit-top" style={{ position: 'relative', minHeight: '92vh', background: ENTRY_BG, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: 'clamp(32px,6vw,80px)', color: '#fff', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <video src="/hero.mp4" autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(100deg, rgba(224,47,6,.96) 0%, rgba(224,47,6,.9) 42%, rgba(224,47,6,.5) 100%)' }} />
        <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 560 }}>
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', color: 'rgba(255,255,255,.92)', fontSize: 20, marginBottom: 10 }}>free · under a minute · no login</div>
          <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(38px,6.2vw,60px)', lineHeight: .98, letterSpacing: '-.02em', color: '#fff', margin: '0 0 16px' }}>Audit your SEO.</h1>
          <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 18, lineHeight: 1.5, margin: '0 0 28px', maxWidth: 470 }}>See exactly where your store stands on Google &amp; AI — your search health, your catalog, and whether ChatGPT even mentions you.</p>
          <div style={{ display: 'flex', gap: 10, flexDirection: isMobile ? 'column' : 'row', maxWidth: 480 }}>
            <input id="audit-domain" value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="yourstore.com" autoFocus
              style={{ flex: 1, padding: '16px 18px', fontSize: 16, borderRadius: 100, border: 'none', background: '#fff', color: INK, fontFamily: 'inherit', outline: 'none', boxShadow: '0 18px 44px -20px rgba(0,0,0,.5)' }} />
            <button onClick={run} style={{ background: '#fff', color: LIME, border: 'none', borderRadius: 100, padding: '16px 28px', fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Scan my site →</button>
          </div>
          <input value={rival} onChange={(e) => setRival(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="your #1 competitor (optional) — e.g. rival.com"
            style={{ width: '100%', maxWidth: 480, marginTop: 10, padding: '13px 18px', fontSize: 14.5, borderRadius: 100, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.12)', color: '#fff', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          {error && <div style={{ color: '#ffe0d6', fontSize: 14, marginTop: 12 }}>{error}</div>}
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: 14 }}>Add your competitor for a head-to-head, or we’ll pick a real one. Reads only what’s public — no account, no card.</div>
        </div>
      </section>
      <AuditLanding onScan={() => document.getElementById('audit-domain')?.focus()} />
    </>
  )

  const Sidebar = () => (
    <aside style={{ background: DARK, color: '#fff', padding: isMobile ? 20 : 26, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {phase === 'report' && result ? (
        <>
          <Gauge score={result.score} grade={result.grade} />
          <SubScore label="Your website" value={result.websiteScore} />
          <SubScore label="Search visibility" value={result.visibilityScore} />
          <div style={{ background: ENTRY_BG, borderRadius: 14, padding: 16, marginTop: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.82)' }}>Revenue at stake</div>
            <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1.05, marginTop: 5 }}>−{result.currency}{result.revenueLostPerYear.toLocaleString()}<span style={{ fontSize: 15, fontWeight: 700, opacity: .8 }}>/yr</span></div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.9)', marginTop: 3 }}>{result.problemCount} problems · all fixable</div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginBottom: 11 }}>Your agent will</div>
            {['Fix titles, metas, schema & alt text', 'Publish content that ranks', 'Get you cited in AI answers', 'Build DA 40+ backlinks', 'Track every rank daily'].map((t) => (
              <div key={t} style={{ display: 'flex', gap: 9, fontSize: 13, color: 'rgba(255,255,255,.82)', marginBottom: 9, lineHeight: 1.35 }}><span style={{ color: GOOD, flex: 'none' }}>✓</span>{t}</div>
            ))}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 24 }}>
            <button onClick={() => setPhase('offer')} style={{ width: '100%', background: LIME, color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>⚡ Fix in 30 minutes</button>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', textAlign: 'center', marginTop: 10 }}>Read-only until you approve each fix</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: SERIF, fontSize: isMobile ? 19 : 23, fontWeight: 700 }}>Scanning your website</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginTop: 8, lineHeight: 1.5 }}>Checks across search, speed, catalog and competitors. No setup needed.</div>
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {STEPS.map((s, i) => {
              const sec = live[s.key]
              const active = i === step, doneStep = i < step
              const subs = active ? subRows(s.key, sec) : []
              return (
                <div key={s.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, opacity: i <= step ? 1 : 0.4, background: active ? 'rgba(255,255,255,.06)' : 'transparent', borderRadius: 10, padding: active ? '9px 10px' : '5px 10px', transition: 'background .3s' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 100, flex: 'none', border: `2px solid ${doneStep ? GOOD : active ? LIME : 'rgba(255,255,255,.25)'}`, background: doneStep ? GOOD : 'transparent', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{doneStep ? '✓' : active ? <span style={{ width: 8, height: 8, borderRadius: 100, border: `2px solid ${LIME}`, borderTopColor: 'transparent', animation: 'aOrbit .9s linear infinite' }} /> : ''}</span>
                    <span style={{ fontSize: 14.5, fontWeight: active ? 800 : 600, flex: 1 }}>{s.label}</span>
                  </div>
                  {subs.length > 0 && (
                    <div style={{ marginLeft: 18, borderLeft: '1px solid rgba(255,255,255,.14)', paddingLeft: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {subs.map((r, ri) => (
                        <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 9, animation: `aPop .35s ease ${ri * 0.1}s both` }}>
                          <span style={{ width: 7, height: 7, borderRadius: 100, flex: 'none', background: r.ok ? GOOD : RED }} />
                          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.8)', flex: 1 }}>{r.label}</span>
                          {r.value && <span style={{ fontSize: 12.5, fontWeight: 800, color: r.ok ? GOOD : '#ffb37a' }}>{r.value}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 24 }}>
            <div style={{ height: 6, borderRadius: 100, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(((step + 1) / STEPS.length) * 100)}%`, background: LIME, transition: 'width .5s' }} /></div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 8 }}>About {Math.max(3, (STEPS.length - 1 - step) * 8)} seconds remaining · {Math.round(((step + 1) / STEPS.length) * 100)}%</div>
          </div>
        </>
      )}
    </aside>
  )

  if (phase === 'ready' && result) return <Ready result={result} onSee={() => setPhase('report')} isMobile={isMobile} />
  if (phase === 'offer' && result) return <Offer result={result} onBack={() => setPhase('report')} isMobile={isMobile} />

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,300px) minmax(0,1fr)', background: PAPER, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar />
      <main style={{ padding: isMobile ? '22px 18px 60px' : '40px 48px 80px', minWidth: 0, background: PAPER }}>
        {phase === 'running' ? <RunningStage step={step} live={live} isMobile={isMobile} domain={domain.trim()} />
          : result ? <Report result={result} open={open} setOpen={setOpen} isMobile={isMobile} onFix={() => setPhase('offer')} /> : null}
      </main>
    </div>
  )
}

/* ── Running stage (real data when it has streamed in) ─────────────────────────────────────────── */
function RunningStage({ step, live, isMobile, domain }: { step: number; live: Record<string, Section>; isMobile: boolean; domain: string }) {
  const s = STEPS[step]
  // The verdict stripe only appears once the step has had time to "work" — never the instant it opens.
  const [showRemark, setShowRemark] = useState(false)
  useEffect(() => { setShowRemark(false); const t = setTimeout(() => setShowRemark(true), 5200); return () => clearTimeout(t) }, [step])
  const titles: Record<string, string> = { health: 'Reading your key pages', speed: 'How fast your site really loads', spam: 'Did Google’s spam update target you?', catalog: 'Your catalog, product by product', google: 'Where you rank on Google', backlinks: 'Who links to you?', ai: 'Do the AIs recommend you?', revenue: 'What it’s costing you' }
  const blurbs: Record<string, string> = {
    health: 'A sample of your collections, products and pages — opened, rendered and measured the way a real buyer loads them.',
    speed: 'Measured on real Chrome visitors over the last 28 days — not a lab test. Google ranks slow sites lower and buyers leave them sooner.',
    spam: 'Google’s spam update demotes scaled, template-generated content. We read your sitemap and estimate how much of your site matches that pattern.',
    catalog: 'We open your product pages and check what Google and shoppers need to see.',
    google: 'Running the exact searches your buyers make — and finding where your website actually shows up.',
    backlinks: 'Comparing your backlink profile to the rivals who outrank you.',
    ai: 'Your buyers ask ChatGPT, Claude, Perplexity and Gemini before they ever open Google. Here’s what each one says.',
    revenue: 'Adding up what all of this is costing you.',
  }
  return (
    <>
      <style>{`@keyframes aSweep{from{stroke-dashoffset:var(--c)}to{stroke-dashoffset:var(--off)}}@keyframes aOrbit{to{transform:rotate(360deg)}}@keyframes aFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes aFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes aScan{0%{top:6%}100%{top:92%}}@keyframes aPulseDot{0%,100%{opacity:.3}50%{opacity:1}}@keyframes aBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes aPop{0%{opacity:0;transform:translateY(8px) scale(.96)}100%{opacity:1;transform:none}}@keyframes aSerp{0%,14%{transform:translateY(0)}86%,100%{transform:translateY(-46%)}}`}</style>
      <div style={{ minHeight: isMobile ? 'auto' : 'calc(100dvh - 120px)', display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: '#fff', border: `1px solid ${LINE}`, borderRadius: isMobile ? 18 : 26, boxShadow: '0 40px 100px -60px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', padding: isMobile ? '26px 20px 24px' : 'clamp(32px,3.5vw,52px)' }}>
          {/* faint blueprint grid, like Ryze */}
          <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(26,20,16,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(26,20,16,.04) 1px, transparent 1px)', backgroundSize: '36px 36px', WebkitMaskImage: 'radial-gradient(circle at 55% 42%, #000 55%, transparent 92%)', maskImage: 'radial-gradient(circle at 55% 42%, #000 55%, transparent 92%)' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ maxWidth: 760, animation: 'aFade .4s ease' }} key={s.key}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: LIME, marginBottom: 12 }}>Step {step + 1} of {STEPS.length}</div>
              <h1 style={{ fontFamily: SERIF, fontSize: isMobile ? 30 : 'clamp(38px,4vw,52px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.0, margin: '0 0 12px', color: INK }}>{titles[s.key]}</h1>
              <p style={{ fontSize: isMobile ? 15 : 18, color: SUB, lineHeight: 1.45, margin: 0, maxWidth: 720 }}>{blurbs[s.key]}</p>
            </div>
            <div style={{ flex: 1, minHeight: isMobile ? 260 : 0, animation: 'aFade .5s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '22px 0' : '18px 0' }} key={s.key + '-v'}>
              {s.key === 'health' ? <HealthGrid sec={live.health} domain={domain} isMobile={isMobile} />
                : s.key === 'speed' ? <Speedometer sec={live.speed} isMobile={isMobile} />
                : s.key === 'spam' ? <SpamGauge sec={live.spam} isMobile={isMobile} />
                : s.key === 'catalog' ? <CatalogCards sec={live.catalog} isMobile={isMobile} />
                : s.key === 'google' ? <SerpBrowser rows={live.google?.ladder || []} domain={domain} isMobile={isMobile} />
                : s.key === 'ai' ? <AiGrid sec={live.ai} domain={domain} isMobile={isMobile} />
                : s.key === 'backlinks' ? <BacklinkGap sec={live.backlinks} isMobile={isMobile} />
                : s.key === 'revenue' ? <RevenueTally sec={live.revenue as any} live={live} domain={domain} isMobile={isMobile} />
                : <ScanPulse isMobile={isMobile} />}
            </div>
            {/* Remark — the verdict, revealed only after the step has worked. Green when good, orange when a real problem. */}
            {(() => { const rk = remark(s.key, live[s.key] as any); const bg = rk?.ok ? GOOD : ENTRY_BG; return showRemark && rk ? (
              <div style={{ width: '100%', background: bg, borderRadius: 16, padding: isMobile ? '16px 18px' : '18px 26px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: `0 18px 40px -24px ${bg}`, animation: 'aPop .5s ease both' }}>
                <span style={{ width: 32, height: 32, borderRadius: 100, flex: 'none', background: 'rgba(255,255,255,.22)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 17 }}>{rk.ok ? '✓' : '!'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: isMobile ? 15.5 : 18, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{rk.title}</div>
                  <div style={{ fontSize: isMobile ? 12.5 : 14, color: 'rgba(255,255,255,.9)', marginTop: 2 }}>{rk.sub}</div>
                </div>
              </div>
            ) : null })()}
          </div>
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

/** Catalog — flips through your real products one by one, each with its image + an orange gap pill. */
function CatalogCards({ sec, isMobile }: { sec?: Section; isMobile: boolean }) {
  const products = (sec?.products || []).filter((p) => p.image || p.title)
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (products.length < 2) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const t = setInterval(() => setIdx((n) => (n + 1) % products.length), 1400)
    return () => clearInterval(t)
  }, [products.length])
  const p = products[idx % Math.max(1, products.length)]
  const gap = p ? (p.missingAlt > 0 ? `${p.missingAlt} images missing alt text` : p.noSchema ? 'No product schema' : p.thin ? 'Thin description' : null) : null
  const ORANGE = ENTRY_BG
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 620, height: isMobile ? 260 : 300 }}>
      {[2, 1, 0].map((depth) => (
        <div key={depth} style={{ position: 'absolute', inset: 0, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, boxShadow: '0 16px 40px -20px rgba(0,0,0,.28)', transform: `translate(${depth * 9}px, ${depth * -9}px) rotate(${depth * 1.2}deg)`, opacity: depth === 0 ? 1 : 0.5 - depth * 0.14, zIndex: 10 - depth, overflow: 'hidden' }}>
          {depth === 0 && (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 26, padding: isMobile ? 16 : 26, height: '100%', animation: 'aPop .45s ease both', boxSizing: 'border-box' }}>
              <div style={{ width: isMobile ? 110 : 150, height: isMobile ? 110 : 150, borderRadius: 16, background: '#f6f2ec', flex: 'none', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {p?.image || p?.url
                  ? <PageThumb full={p.url} og={p.image} i={0} />
                  : <span style={{ fontSize: 36 }}>🛍️</span>}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: SERIF, fontSize: isMobile ? 20 : 27, fontWeight: 700, color: INK, letterSpacing: '-.01em', lineHeight: 1.1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p?.title || 'Product'}</div>
                {p?.price != null && <div style={{ fontSize: isMobile ? 16 : 19, color: SUB, marginTop: 6, fontWeight: 600 }}>{p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                {gap && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, background: '#ffe7df', color: ORANGE, borderRadius: 100, padding: '8px 15px', fontSize: isMobile ? 12.5 : 14, fontWeight: 800 }}><span style={{ width: 7, height: 7, borderRadius: 100, background: ORANGE }} /> {gap}</div>}
              </div>
            </div>
          )}
        </div>
      ))}
      {products.length > 1 && <div style={{ position: 'absolute', bottom: -26, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>{products.slice(0, 8).map((_, i) => <span key={i} style={{ width: i === idx % Math.min(products.length, 8) ? 18 : 6, height: 6, borderRadius: 100, background: i === idx % Math.min(products.length, 8) ? ENTRY_BG : LINE, transition: 'width .3s' }} />)}</div>}
    </div>
  )
}
/** Google — a fake Google SERP that scrolls the full first page for each buyer keyword, landing on your rank. */
function SerpBrowser({ rows, domain, isMobile }: { rows: LadderRow[]; domain: string; isMobile: boolean }) {
  const CYCLE = 4000
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (rows.length < 2) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const t = setInterval(() => setIdx((n) => (n + 1) % rows.length), CYCLE)
    return () => clearInterval(t)
  }, [rows.length])
  const r = rows.length ? rows[idx % rows.length] : null
  const kw = r?.keyword || 'your buyer keywords'
  const you = (domain || 'your store').replace(/^www\./, '')
  const rivals = (r?.top || []).filter((t) => t.domain.replace(/^www\./, '') !== you).slice(0, 8)
  const scroll = rows.length > 0 && rivals.length >= 4   // only scroll when there's a full page to scroll through
  const chrome = '#e9ebee'
  const titleCase = (d: string) => d.replace(/^www\./, '').split('.')[0].replace(/\b\w/g, (c) => c.toUpperCase())
  const Row = ({ dom, pos, i }: { dom: string; pos: number; i: number }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}><span style={{ width: 22, height: 22, borderRadius: 100, background: '#f0f1f3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: SUB }}>{dom[0]?.toUpperCase()}</span><span style={{ fontSize: 12.5, color: '#3a3a3a' }}>{dom.replace(/^www\./, '')}</span><span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: SUB }}>#{pos}</span></div>
      <div style={{ fontSize: isMobile ? 15 : 17, color: '#1a0dab', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleCase(dom)} — {kw}</div>
      <div style={{ fontSize: 12.5, color: SUB, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>The {titleCase(dom)} guide to {kw} — shop the range and compare.</div>
    </div>
  )
  return (
    <div style={{ width: '100%', maxWidth: 720, borderRadius: 16, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#fff', boxShadow: '0 24px 60px -30px rgba(0,0,0,.45)' }}>
      <div style={{ background: chrome, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'flex', gap: 6 }}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 11, height: 11, borderRadius: 100, background: c }} />)}</span>
        <span style={{ background: '#fff', borderRadius: '8px 8px 0 0', padding: '6px 14px', fontSize: 12, color: INK, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 160 : 280 }}>{kw} – Google Search</span>
      </div>
      <div style={{ background: '#fff', padding: '8px 14px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: SUB }}>🔒</span>
        <span style={{ fontSize: 12.5, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>google.com/search?q={kw.replace(/ /g, '+')}</span>
      </div>
      <div style={{ height: isMobile ? 250 : 340, overflow: 'hidden', padding: isMobile ? '16px 16px 0' : '22px 26px 0' }}>
        <div key={idx} style={{ animation: scroll ? `aSerp ${CYCLE}ms ease-in-out both` : 'aFade .5s ease both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <span style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#4285F4' }}>Google</span>
            <span style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 100, padding: '8px 16px', fontSize: 13.5, color: INK, boxShadow: '0 1px 4px rgba(0,0,0,.06)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kw}</span>
          </div>
          <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${LINE}`, paddingBottom: 8, marginBottom: 16, fontSize: 12.5 }}>
            <span style={{ color: '#4285F4', fontWeight: 700, borderBottom: '2px solid #4285F4', paddingBottom: 8 }}>All</span>
            {['Images', 'Shopping', 'Videos', 'News'].map((t) => <span key={t} style={{ color: SUB }}>{t}</span>)}
          </div>
          {!rows.length ? (
            [0, 1, 2, 3].map((i) => <div key={i} style={{ marginBottom: 18 }}><div style={{ height: 10, width: '30%', borderRadius: 4, background: '#eef0f2', marginBottom: 8 }} /><div style={{ height: 14, width: '60%', borderRadius: 4, background: '#e6ecf6', marginBottom: 6 }} /><div style={{ height: 9, width: '90%', borderRadius: 4, background: '#f0f1f3' }} /></div>)
          ) : (
            <>
              {rivals.map((t, i) => <Row key={i} dom={t.domain} pos={t.position} i={i} />)}
              {/* the reveal at the bottom of the page: where YOU actually land */}
              <div style={{ borderLeft: `3px solid ${ENTRY_BG}`, background: '#fff2ee', borderRadius: '0 10px 10px 0', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 20 }}>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, color: '#3a3a3a' }}>you</div><div style={{ fontSize: isMobile ? 15 : 17, color: ENTRY_BG, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{you}</div></div>
                <span style={{ flex: 'none', fontSize: 12, fontWeight: 800, color: '#fff', background: ENTRY_BG, borderRadius: 100, padding: '5px 13px' }}>{r?.yourPosition == null ? 'NOT IN TOP 50' : `#${r?.yourPosition}`}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
function ScanPulse({ isMobile }: { isMobile: boolean }) {
  const size = isMobile ? 220 : 300
  return <div style={{ position: 'relative', width: size, height: size }}>{[0.5, 0.38, 0.26].map((f, i) => <div key={i} style={{ position: 'absolute', inset: `${(0.5 - f) * size}px`, border: '1.5px dashed #e2e6ea', borderRadius: '50%' }} />)}<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: size * 0.3, height: size * 0.3, borderRadius: '50%', border: `3px solid ${LINE}`, borderTopColor: LIME, animation: 'aOrbit 1s linear infinite' }} /></div></div>
}

/** Page thumbnail: the real og:image first (reliable — product photos), then a live screenshot, then skeleton. */
const shotUrl = (full: string) => `https://s0.wp.com/mshots/v1/${encodeURIComponent(full)}?w=640&h=480`
function PageThumb({ full, og, i }: { full: string; og: string | null; i: number }) {
  const chain = og ? [og, shotUrl(full)] : [shotUrl(full)]
  const [idx, setIdx] = useState(0)
  const src = idx < chain.length ? chain[idx] : null
  if (!src) return (
    <>
      <div style={{ position: 'absolute', left: '12%', right: '14%', top: '20%', height: 5, borderRadius: 4, background: 'rgba(0,0,0,.08)' }} />
      <div style={{ position: 'absolute', left: '12%', right: '34%', top: '38%', height: 5, borderRadius: 4, background: 'rgba(0,0,0,.06)' }} />
      <div style={{ position: 'absolute', left: '12%', right: '48%', top: '56%', height: 5, borderRadius: 4, background: 'rgba(0,0,0,.05)' }} />
    </>
  )
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={idx} src={src} alt="" loading={i < 8 ? undefined : 'lazy'} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} onError={() => setIdx((n) => n + 1)} />
}

/** Health — a big live grid of your key pages being opened and rendered, with a huge counter (Ryze-style). */
function HealthGrid({ sec, domain, isMobile }: { sec?: Section; domain: string; isMobile: boolean }) {
  const urls = sec?.read?.urls || []
  const thumbs = sec?.read?.thumbs || []
  const total = sec?.read?.total || urls.length || 0
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!total) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setN(total); return }
    let raf = 0; const t0 = performance.now(), dur = 1800
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setN(Math.round(total * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [total])
  const cols = isMobile ? 3 : 7
  const cellCount = Math.min(Math.max(urls.length, cols * 3), isMobile ? 12 : 21)   // fill at least 3 rows
  const cells = Array.from({ length: cellCount }, (_, i) => ({ url: urls[i] || '', thumb: thumbs[i] || null }))
  const tints = ['#f6efe6', '#efe7f1', '#e7f1ea', '#eef2f8', '#f7f0e0', '#eef3ee', '#f5eef0']
  return (
    <div style={{ width: '100%', maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 8, marginBottom: 18 }}>
        <span style={{ fontFamily: SERIF, fontSize: isMobile ? 48 : 72, fontWeight: 800, color: INK, lineHeight: .9, fontVariantNumeric: 'tabular-nums' }}>{total ? n.toLocaleString() : '··'}</span>
        <span style={{ fontSize: 14, color: SUB }}>of {total ? total.toLocaleString() : '···'} pages</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: isMobile ? 8 : 12 }}>
        {cells.map((c, i) => {
          const real = !!c.url
          return (
            <div key={i} style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#fff', boxShadow: '0 8px 18px -12px rgba(0,0,0,.3)', animation: real ? `aPop .4s ease ${Math.min(i, 20) * 0.06}s both` : 'none', opacity: real ? 1 : 0.4 }}>
              <div style={{ aspectRatio: '4 / 3', background: `linear-gradient(135deg, ${tints[i % tints.length]}, #ffffff)`, position: 'relative', overflow: 'hidden' }}>
                {real ? <PageThumb full={`https://${domain}${c.url}`} og={c.thumb} i={i} />
                  : <><div style={{ position: 'absolute', left: '12%', right: '14%', top: '20%', height: 5, borderRadius: 4, background: 'rgba(0,0,0,.08)' }} /><div style={{ position: 'absolute', left: '12%', right: '34%', top: '38%', height: 5, borderRadius: 4, background: 'rgba(0,0,0,.06)' }} /><div style={{ position: 'absolute', left: '12%', right: '48%', top: '56%', height: 5, borderRadius: 4, background: 'rgba(0,0,0,.05)' }} /></>}
                <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 8, fontWeight: 800, letterSpacing: '.08em', color: '#fff', background: LIME, borderRadius: 4, padding: '1px 5px', zIndex: 1 }}>SM</span>
              </div>
              <div style={{ fontSize: 10, color: SUB, padding: '5px 7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{real ? shorten(c.url, isMobile ? 11 : 15) : '…'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Speed — a real speedometer (0–7s) whose needle swings slowly while measuring, then settles. */
function Speedometer({ sec, isMobile }: { sec?: Section; isMobile: boolean }) {
  const lcp = sec?.speed?.lcpS ?? null
  const size = isMobile ? 300 : 420
  const cx = size / 2, cy = size * 0.5, R = size * 0.38, MAX = 7
  const degFor = (v: number) => -120 + (Math.min(MAX, Math.max(0, v)) / MAX) * 240
  const rad = (d: number) => (d * Math.PI) / 180
  const ptAt = (v: number, r: number) => { const d = rad(degFor(v)); return [cx + r * Math.sin(d), cy - r * Math.cos(d)] as const }
  const arc = (v1: number, v2: number, color: string) => {
    const [ax, ay] = ptAt(v1, R), [bx, by] = ptAt(v2, R)
    const large = degFor(v2) - degFor(v1) > 180 ? 1 : 0
    return <path d={`M ${ax} ${ay} A ${R} ${R} 0 ${large} 1 ${bx} ${by}`} fill="none" stroke={color} strokeWidth={size * 0.055} strokeLinecap="butt" />
  }
  const col = lcp == null ? SUB : lcp <= 2.5 ? GOOD : lcp <= 4 ? '#e08a1a' : RED
  const [deg, setDeg] = useState(-40)
  const degRef = useRef(-40)
  useEffect(() => { degRef.current = deg })
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    if (lcp != null) {
      if (reduce) { setDeg(degFor(lcp)); return }
      const from = degRef.current, to = degFor(lcp), t0 = performance.now(), dur = 1200
      const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); setDeg(from + (to - from) * e); if (p < 1) raf = requestAnimationFrame(tick) }
      raf = requestAnimationFrame(tick)
    } else {
      if (reduce) { setDeg(-16); return }
      const t0 = performance.now()
      const tick = (t: number) => { setDeg(-16 + 54 * Math.sin((t - t0) / 1600)); raf = requestAnimationFrame(tick) }
      raf = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lcp])
  const [rx, ry] = ptAt(4.15, R * 1.12)
  return (
    <div style={{ width: '100%', maxWidth: size, margin: '0 auto', textAlign: 'center' }}>
      <svg width="100%" viewBox={`0 0 ${size} ${size * 0.68}`} style={{ display: 'block' }}>
        {arc(0, 2.5, GOOD)}{arc(2.5, 4, '#e08a1a')}{arc(4, 7, RED)}
        {Array.from({ length: 8 }, (_, k) => k).map((k) => {
          const [ix, iy] = ptAt(k, R * 0.82), [ox, oy] = ptAt(k, R * 0.92), [tx, ty] = ptAt(k, R * 0.68)
          return <g key={k}><line x1={ix} y1={iy} x2={ox} y2={oy} stroke="#c8ccd2" strokeWidth="2" /><text x={tx} y={ty} fill={SUB} fontSize={size * 0.038} fontWeight="700" textAnchor="middle" dominantBaseline="middle">{k}</text></g>
        })}
        <text x={rx} y={ry} fill={RED} fontSize={size * 0.032} fontWeight="800" letterSpacing="1.5" textAnchor="middle">REDLINE</text>
        <g transform={`rotate(${deg} ${cx} ${cy})`}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - R * 0.9} stroke={INK} strokeWidth={size * 0.014} strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r={size * 0.028} fill="#fff" stroke={INK} strokeWidth={size * 0.012} />
      </svg>
      <div style={{ fontFamily: SERIF, fontSize: isMobile ? 44 : 60, fontWeight: 800, color: col, lineHeight: 1, marginTop: -size * 0.13 }}>{lcp != null ? lcp : '··'}<span style={{ fontSize: '0.5em' }}>s</span></div>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: SUB, marginTop: 8 }}>{lcp != null ? 'real-visitor load time' : 'analyzing speed of all your pages…'}</div>
    </div>
  )
}

/** AI — 2×2 grid of assistants, each showing the buyer's question, the real answer, and a verdict pill. */
const AI_LOGO: Record<string, string> = { chatgpt: '/logos/openai.svg', claude: '/logos/claude.svg', gemini: '/logos/gemini.svg', perplexity: '/logos/perplexity.svg' }
function AiGrid({ sec, domain, isMobile }: { sec?: Section; domain: string; isMobile: boolean }) {
  const reads = sec?.ai?.reads || []
  const question = sec?.ai?.question || 'What are the best brands in this category?'
  const you = domain || 'your store'
  const engines = reads.length ? reads.map((r) => r.engine) : ['chatgpt', 'gemini', 'perplexity']
  return (
    <div style={{ width: '100%', maxWidth: 820, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 12 : 16 }}>
      {engines.map((e, i) => {
        const rd = reads.find((r) => r.engine === e)
        return (
          <div key={e} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: isMobile ? 16 : 20, boxShadow: '0 12px 32px -20px rgba(0,0,0,.28)', animation: `aPop .4s ease ${i * 0.08}s both`, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: `1px solid ${LINE}`, marginBottom: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={AI_LOGO[e]} alt="" width={24} height={24} style={{ width: 24, height: 24, objectFit: 'contain' }} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }} />
              <span style={{ fontFamily: SERIF, fontSize: isMobile ? 17 : 19, fontWeight: 700, color: INK }}>{engLabel(e)}</span>
            </div>
            <div style={{ background: '#f4f2ef', borderRadius: 12, padding: '10px 13px', fontSize: 12.5, color: '#3a352c', lineHeight: 1.4, marginBottom: 10 }}>{question}</div>
            <div style={{ position: 'relative', maxHeight: isMobile ? 84 : 96, overflow: 'hidden' }}>
              <div style={{ fontSize: 12.5, color: '#4a453b', lineHeight: 1.5 }}>{rd ? rd.answer.slice(0, 320) : <span style={{ color: SUB, animation: 'aPulseDot 1.2s ease infinite' }}>asking {engLabel(e)}…</span>}</div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 34, background: 'linear-gradient(transparent, #fff)' }} />
            </div>
            {rd && (rd.mentioned
              ? <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, background: '#eaf6ec', color: GOOD, borderRadius: 100, padding: '5px 12px', fontSize: 12, fontWeight: 800 }}>✓ {you} — mentioned</div>
              : <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, background: '#ffe7df', color: ENTRY_BG, borderRadius: 100, padding: '5px 12px', fontSize: 12, fontWeight: 800 }}>✕ {you} — not mentioned</div>)}
          </div>
        )
      })}
    </div>
  )
}

/** Backlinks — real referring-domain counts: you vs the rival who outranks you. */
function BacklinkGap({ sec, isMobile }: { sec?: Section; isMobile: boolean }) {
  const bl = sec?.backlinks
  if (!bl) return <ScanPulse isMobile={isMobile} />
  const rivalName = bl.rivalDomain?.replace(/^www\./, '') || null
  const bars = [
    rivalName && bl.rivalRef != null ? { label: rivalName, val: bl.rivalRef, col: '#3a453c', you: false } : null,
    { label: `${sec?.name && ''}you`, val: bl.mineRef, col: ENTRY_BG, you: true },
  ].filter(Boolean) as { label: string; val: number; col: string; you: boolean }[]
  const max = Math.max(1, ...bars.map((b) => b.val))
  return (
    <div style={{ width: '100%', maxWidth: 560, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: isMobile ? 20 : 28, boxShadow: '0 10px 30px rgba(0,0,0,.06)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: SUB, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 18 }}>Referring domains</div>
      {bars.map((b, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13.5, marginBottom: 6 }}>
            <span style={{ fontWeight: b.you ? 800 : 600, color: b.you ? ENTRY_BG : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.you ? 'You' : b.label}</span>
            <span style={{ fontWeight: 800, color: b.you ? ENTRY_BG : INK, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{b.val.toLocaleString()}</span>
          </div>
          <div style={{ height: 14, borderRadius: 8, background: '#eef0f2', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.max(4, (b.val / max) * 100)}%`, background: b.col, borderRadius: 8, transformOrigin: 'left', animation: `aBar 1s cubic-bezier(.2,.8,.2,1) ${i * 0.18}s both` }} /></div>
        </div>
      ))}
      <div style={{ fontSize: 13.5, color: SUB, marginTop: 4, lineHeight: 1.5 }}>{bl.mineLinks.toLocaleString()} total backlinks from {bl.mineRef.toLocaleString()} domains{rivalName && bl.rivalRef != null ? ` · ${rivalName} has ${bl.rivalRef.toLocaleString()}` : ''}.</div>
    </div>
  )
}

/** Revenue — big loss counting up + a grounded breakdown of where the money goes. */
function RevenueTally({ sec, live, isMobile }: { sec?: (Section & { _lost?: number; _cur?: string }); live: Record<string, Section>; domain: string; isMobile: boolean }) {
  const target = sec?._lost ?? 0
  const cur = sec?._cur ?? '$'
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!target) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setN(target); return }
    let raf = 0; const t0 = performance.now(), dur = 1800
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setN(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  // Grounded counts from what streamed in; the dollar split is modelled from the total.
  const searches = live.google?.ladder?.filter((r) => r.yourPosition == null || r.yourPosition > 3).length ?? 0
  const catalogGaps = (live.catalog?.products || []).filter((p) => p.missingAlt > 0 || p.thin || p.noSchema).length
  const aiMiss = (live.ai?.ai?.reads || []).filter((r) => !r.mentioned).length
  const aiTotal = live.ai?.ai?.reads?.length ?? 0
  const money = (v: number) => `−${cur}${Math.round(v).toLocaleString()}/yr`
  const lines = [
    searches > 0 && { icon: '🔍', title: 'Searches where rivals take the click', sub: `${searches} buyer ${searches === 1 ? 'search' : 'searches'} where you’re not #1`, amt: target * 0.86 },
    catalogGaps > 0 && { icon: '📦', title: 'Product pages under-optimised', sub: `${catalogGaps} products with catalog gaps`, amt: target * 0.05 },
    aiMiss > 0 && { icon: '🤖', title: 'AI assistants recommending rivals', sub: `${aiMiss} of ${aiTotal} AI answers skip you`, amt: target * 0.09 },
  ].filter(Boolean) as { icon: string; title: string; sub: string; amt: number }[]
  return (
    <div style={{ width: '100%', maxWidth: 680 }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontFamily: SERIF, fontSize: isMobile ? 52 : 82, fontWeight: 800, color: ENTRY_BG, lineHeight: 1, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>
          {target ? <>−{cur}{n.toLocaleString()}<span style={{ fontSize: '0.4em', color: SUB, fontWeight: 700 }}>/yr</span></> : <span style={{ fontSize: '0.5em', color: SUB, animation: 'aPulseDot 1.2s ease infinite' }}>adding it up…</span>}
        </div>
        <div style={{ fontSize: 13.5, color: SUB, marginTop: 8 }}>estimated revenue going to competitors</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: isMobile ? '13px 15px' : '15px 20px', boxShadow: '0 8px 24px -16px rgba(0,0,0,.2)', animation: `aPop .4s ease ${i * 0.1}s both` }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: '#fff2ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flex: 'none' }}>{l.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: isMobile ? 14.5 : 16, fontWeight: 800, color: INK }}>{l.title}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>{l.sub}</div></div>
            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: ENTRY_BG, flex: 'none' }}>{money(l.amt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Report ───────────────────────────────────────────────────────────────────────────────────── */
function Report({ result, open, setOpen, isMobile, onFix }: { result: Result; open: Record<string, boolean>; setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void; isMobile: boolean; onFix: () => void }) {
  const money = (n: number) => `${result.currency}${n.toLocaleString()}`
  return (
    <>
      <h1 style={{ fontFamily: SERIF, fontSize: isMobile ? 26 : 34, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px', color: INK }}>Your full report — {result.problemCount} problems found</h1>
      <p style={{ fontSize: 15.5, color: SUB, margin: '0 0 18px', lineHeight: 1.5, maxWidth: 640 }}>Everything we found across Google, your catalog, AI assistants and your site — and what fixing it is worth.</p>
      <div style={{ background: ENTRY_BG, borderRadius: 16, padding: isMobile ? '16px 18px' : '18px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: isMobile ? 14 : 28, marginBottom: 34, boxShadow: '0 18px 40px -24px rgba(224,47,6,.7)' }}>
        {[[`${result.problemCount}`, 'problems found'], [`−${money(result.revenueLostPerYear)}/yr`, 'at stake'], ['30 min', 'to first fixes'], ['You', 'approve each one']].map(([big, sub], i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontFamily: SERIF, fontSize: isMobile ? 20 : 24, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{big}</span>
            <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.85)', marginTop: 3 }}>{sub}</span>
          </div>
        ))}
      </div>

      {result.sections.map((sec, si) => (
        <section key={sec.key} style={{ marginBottom: 34 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${LINE}`, paddingBottom: 10, marginBottom: 14 }}>
            <div><div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 800, color: INK }}><span style={{ color: LIME, fontWeight: 800, marginRight: 8 }}>{si + 1}.</span>{sec.name}</div><div style={{ fontSize: 13.5, color: SUB, marginTop: 2 }}>{sec.sub}</div></div>
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
              {open[f.id] && f.sample?.length ? <div style={{ borderTop: `1px solid ${LINE}`, padding: '10px 16px', background: PAPER }}>{f.sample.slice(0, 6).map((s, i) => <div key={i} style={{ fontSize: 12.5, color: '#4a544c', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", padding: '5px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>{s}</div>)}</div> : null}
            </div>
          ))}

          {/* SERP ladder (Google visibility) */}
          {sec.ladder && sec.ladder.length > 0 && sec.ladder.map((r) => (
            <div key={r.keyword} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16, marginBottom: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>“{r.keyword}”{r.volume ? <span style={{ color: SUB, fontWeight: 500, fontSize: 13 }}> · {r.volume.toLocaleString()} searches/mo</span> : ''}</div>
              <div style={{ marginTop: 10 }}>
                {r.top.slice(0, 3).map((t, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#3a453c', borderTop: i ? `1px solid ${LINE}` : 'none', padding: '7px 0' }}><span>{i + 1}. {t.domain}</span><span style={{ color: SUB }}>#{t.position}</span></div>)}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 8 }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>{result.domain}</span><span style={{ fontSize: 12, fontWeight: 700, color: ENTRY_BG, background: '#ffe7df', borderRadius: 100, padding: '3px 10px' }}>{r.yourPosition == null ? 'not in top 50' : `#${r.yourPosition}`}</span></div>
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

      <section style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `1px solid ${LINE}`, paddingBottom: 10, marginBottom: 14 }}>
          <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 800, color: INK }}><span style={{ color: LIME, fontWeight: 800, marginRight: 8 }}>{result.sections.length + 1}.</span>What it’s costing you</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: LIME }}>−{money(result.revenueLostPerYear)}/yr</div>
        </div>
        {(() => {
          const m = result.revenueModel
          if (!m) return <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16, fontSize: 14, color: SUB, lineHeight: 1.6 }}>A conservative estimate from the {result.problemCount} fixable problems above. Every one is something our agent fixes for you.</div>
          const lines = [
            m.fromSearch > 0 && { icon: '🔍', title: 'Searches where rivals take the click', sub: `${m.keywordLeaks.length} buyer ${m.keywordLeaks.length === 1 ? 'search' : 'searches'} where you’re not #1`, amt: m.fromSearch },
            m.fromCatalog > 0 && { icon: '📦', title: 'Product pages under-optimised', sub: `${m.catalogGapProducts} products with catalog gaps`, amt: m.fromCatalog },
            m.fromAi > 0 && { icon: '🤖', title: 'AI assistants recommending rivals', sub: `${m.missReads} of ${m.missTotal} AI answers skip you`, amt: m.fromAi },
          ].filter(Boolean) as { icon: string; title: string; sub: string; amt: number }[]
          return (
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden' }}>
              {lines.map((l, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: isMobile ? '13px 15px' : '15px 20px', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, background: '#fff2ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flex: 'none' }}>{l.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: isMobile ? 14 : 15.5, fontWeight: 800, color: INK }}>{l.title}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>{l.sub}</div></div>
                  <span style={{ fontSize: isMobile ? 13.5 : 15, fontWeight: 800, color: LIME, flex: 'none' }}>−{money(l.amt)}/yr</span>
                </div>
              ))}
              {m.keywordLeaks.slice(0, 5).map((k, i) => (
                <div key={`k${i}`} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: isMobile ? '10px 15px' : '11px 20px', borderTop: `1px solid ${LINE}`, background: PAPER }}>
                  <span style={{ width: 26, flex: 'none', textAlign: 'center', fontSize: 12, color: SUB }}>{k.rival ? k.rival[0].toUpperCase() : '·'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>“{k.keyword}”</div><div style={{ fontSize: 12, color: SUB }}>~{k.visits} visits/mo{k.rival ? ` · ${k.rival.replace(/^www\./, '')} ranks #1` : ''}</div></div>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: isMobile ? '14px 15px' : '16px 20px', borderTop: `2px solid ${LINE}` }}>
                <div style={{ fontSize: isMobile ? 12.5 : 13.5, color: SUB }}>Total — ≈{m.lostVisits.toLocaleString()} lost visits/mo × {(m.conversion * 100).toFixed(1)}% conversion × {result.currency}{m.aov.toLocaleString()} avg order</div>
                <span style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: LIME, flex: 'none' }}>−{money(result.revenueLostPerYear)}/yr</span>
              </div>
            </div>
          )
        })()}
      </section>

      {/* Bottom CTA — dark card, our agent fixes it */}
      <div style={{ background: DARK, borderRadius: 18, padding: isMobile ? '24px 20px' : '32px 36px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 20, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: isMobile ? 22 : 27, fontWeight: 700, color: '#fff', letterSpacing: '-.01em', lineHeight: 1.1 }}>Every problem here — our agent fixes automatically.</div>
          <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,.62)', marginTop: 8, lineHeight: 1.5, maxWidth: 520 }}>Hire your AI team and watch the fixes go live in the next 30 minutes. Nothing ships without your approval.</div>
        </div>
        <button onClick={onFix} style={{ flex: 'none', background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: isMobile ? '14px 26px' : '16px 32px', fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Fix in 30 minutes →</button>
      </div>
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
      <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, color: col, marginTop: 2 }}>{grade}</div>
    </div>
  )
}
function SubScore({ label, value }: { label: string; value: number }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: '12px 14px', marginBottom: 10, background: 'rgba(255,255,255,.03)' }}><div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{label}</div><div style={{ fontSize: 13, color: value >= 60 ? GOOD : value >= 40 ? '#e0a92b' : RED, fontWeight: 800 }}>{value} of 100</div></div>
}

/** Completion gate — the theater stops here; the report opens only on click (Ryze-style). */
function Ready({ result, onSee, isMobile }: { result: Result; onSee: () => void; isMobile: boolean }) {
  const money = (n: number) => `${result.currency}${n.toLocaleString()}`
  const [n, setN] = useState(0)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setN(result.score); return }
    let raf = 0; const t0 = performance.now(), dur = 1100
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setN(Math.round(result.score * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [result.score])
  const R = 78, C = 2 * Math.PI * R, off = C * (1 - n / 100)
  return (
    <div style={{ minHeight: '100dvh', background: ENTRY_BG, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '40px 22px' : 60, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <video src="/hero.mp4" autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(224,47,6,.92), rgba(224,47,6,.97))' }} />
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: 560, animation: 'aPop .5s ease both' }}>
        <div style={{ fontFamily: MONO_G, fontSize: 12, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,.85)', marginBottom: 22 }}>Scan complete</div>
        <div style={{ position: 'relative', width: 190, height: 190, margin: '0 auto 26px' }}>
          <svg width="190" height="190" style={{ transform: 'rotate(-90deg)' }}><circle cx="95" cy="95" r={R} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="12" /><circle cx="95" cy="95" r={R} fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} /></svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{n}</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>of 100 · {result.grade}</div></div>
        </div>
        <h1 style={{ fontFamily: SERIF, color: '#fff', fontSize: isMobile ? 34 : 46, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.02, margin: '0 0 12px' }}>Your report is ready.</h1>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,.9)', lineHeight: 1.5, margin: '0 0 30px' }}>We found <b style={{ color: '#fff' }}>{result.problemCount} problems</b> across your site, catalog, Google and AI — worth about <b style={{ color: '#fff' }}>{money(result.revenueLostPerYear)}/yr</b>.</p>
        <button onClick={onSee} style={{ background: '#fff', color: LIME, border: 'none', borderRadius: 100, padding: isMobile ? '15px 30px' : '17px 38px', fontSize: 17, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>See your full report →</button>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', marginTop: 16 }}>Free · no login · read-only until you approve a fix</div>
      </div>
    </div>
  )
}
const MONO_G = "'Helvetica Neue', Helvetica, Arial, sans-serif"

function Offer({ result, onBack, isMobile }: { result: Result; onBack: () => void; isMobile: boolean }) {
  const money = (n: number) => `${result.currency}${n.toLocaleString()}`
  const [name, setName] = useState('')
  // Stash the scanned domain, then hand off to signup (Gmail OK) — the app claims the scan on login.
  const start = () => { document.cookie = `sf_scan_domain=${encodeURIComponent(result.domain)}; path=/; max-age=2592000`; if (name.trim()) document.cookie = `sf_scan_signer=${encodeURIComponent(name.trim())}; path=/; max-age=2592000`; window.location.href = `/signup?ref=seo-scan&next=${encodeURIComponent('/mission/seo')}` }
  const MONO = "'Helvetica Neue', Helvetica, Arial, sans-serif"
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '14px 0', borderTop: `1px solid ${LINE}` }}>
      <span style={{ fontSize: 15, color: SUB }}>{k}</span><span style={{ fontSize: 15.5, fontWeight: 800, color: INK, textAlign: 'right' }}>{v}</span>
    </div>
  )
  return (
    <div style={{ minHeight: '100dvh', background: PAPER, fontFamily: 'Inter, system-ui, sans-serif', padding: isMobile ? '20px 16px 60px' : '40px 48px' }}>
      <button onClick={onBack} style={{ background: DARK, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 24 }}>← Back to report</button>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <h1 style={{ fontFamily: SERIF, fontSize: isMobile ? 32 : 46, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.0, margin: '0 0 14px', color: INK }}>Fix all {result.problemCount} problems on {result.domain}</h1>
        <p style={{ fontSize: 16.5, color: SUB, lineHeight: 1.5, margin: '0 0 26px', maxWidth: 620 }}>These problems cost {result.domain} ≈{money(result.revenueLostPerYear)}/yr. Sign below and your AI SEO team starts fixing them in the next 30 minutes — you approve every change.</p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginBottom: 34 }}>
          {[['$5,000/mo of work', 'SEO, content, catalog, competitor intel — a whole team'], ['Fixes in 30 min', 'Meta, alt text, schema — you approve each'], ['Real revenue', 'We bank the organic revenue against every fix'], ['First-Win Guarantee', '30 days or your money back — you keep the work']].map(([t, d], i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 14 }}><div style={{ color: GOOD, fontSize: 18, marginBottom: 6 }}>✓</div><div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{t}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 3, lineHeight: 1.4 }}>{d}</div></div>
          ))}
        </div>

        {/* Employment Agreement — the sign moment (from the landing) */}
        <div style={{ maxWidth: 660, margin: '0 auto', background: '#f4efe1', border: `1px solid ${LINE}`, borderRadius: 18, padding: isMobile ? '24px 20px' : '38px 40px', boxShadow: '0 30px 60px -30px rgba(0,0,0,.25)' }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.14em', color: LIME, marginBottom: 12 }}>EMPLOYMENT AGREEMENT · FOR YOUR SIGNATURE</div>
          <h2 style={{ fontFamily: SERIF, fontSize: isMobile ? 30 : 40, fontWeight: 700, letterSpacing: '-.01em', margin: '0 0 4px', color: INK }}>Employment Agreement</h2>
          <div style={{ fontFamily: MONO, fontSize: 12, color: SUB, marginBottom: 18 }}>Prepared this morning · for {result.domain}</div>
          <Row k="Employee" v="Mello" />
          <Row k="Position" v="Your AI growth team" />
          <Row k="Handles" v="SEO · ads · content · your store" />
          <Row k="First task" v={`Fix ${result.problemCount} problems on ${result.domain}`} />
          <Row k="Working hours" v="24/7 — nights included" />
          <Row k="Reports to" v="You" />
          <Row k="Approvals" v="Every change — nothing ships without your yes" />
          <Row k="Salary" v="$1 to start · then $149/mo" />
          <Row k="Starts" v="In the next 30 minutes" />
          <p style={{ fontSize: 14.5, color: '#4a453b', lineHeight: 1.6, margin: '18px 0 24px', borderTop: `1px solid ${LINE}`, paddingTop: 18 }}>I&rsquo;ll run your growth end to end — fix your site, publish your pages, launch your ads, and get you cited in AI answers — you approve everything. <b style={{ color: INK }}>First-Win Guarantee: 30 days or your money back, and you keep the work.</b></p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 22 }}>
            <div><div style={{ fontFamily: SERIF, fontSize: 24, color: INK, borderBottom: `1px solid ${INK}`, paddingBottom: 6 }}>Mello</div><div style={{ fontFamily: MONO, fontSize: 10.5, color: SUB, marginTop: 6, letterSpacing: '.04em' }}>MELLO · YOUR AI GROWTH TEAM</div></div>
            <div><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && start()} placeholder="Type your name to sign" style={{ width: '100%', fontFamily: SERIF, fontSize: 22, color: INK, border: 'none', borderBottom: `1px solid ${INK}`, background: 'transparent', outline: 'none', paddingBottom: 6 }} /><div style={{ fontFamily: MONO, fontSize: 10.5, color: SUB, marginTop: 6, letterSpacing: '.04em' }}>YOU · EMPLOYER</div></div>
          </div>
          <button onClick={start} disabled={!name.trim()} style={{ width: '100%', background: name.trim() ? LIME : '#d8cdb4', color: '#fff', border: 'none', borderRadius: 12, padding: '16px', fontSize: 16.5, fontWeight: 800, cursor: name.trim() ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'background .2s' }}>Hire Mello — run my growth →</button>
          <div style={{ fontSize: 12, color: SUB, textAlign: 'center', marginTop: 10 }}>$1 for 3 days, then $149/mo · cancel in one email · we pick up where this report left off</div>
        </div>
      </div>

      {/* Testimonials — like Ryze's "Hear from other website owners" */}
      <div style={{ maxWidth: 1080, marginTop: 34 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: SUB, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 12 }}>Hear from other store owners</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          {[['Set it up on a Tuesday, forgot about it. Three months later organic is our second-biggest channel.', 'DTC skincare'], ['Clicks tripled in a quarter. I check the dashboard once a week and it just keeps climbing.', 'Supplements brand']].map(([q, who], i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 18 }}>
              <div style={{ fontSize: 15, color: INK, lineHeight: 1.5 }}>“{q}”</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 10, fontWeight: 700 }}>— {who}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
