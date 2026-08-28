'use client'
/**
 * ScanTheater — the /scan funnel. It's an AUDIT of YOUR ads (Ryze-style live theater): read your ads,
 * score your ad presence, show the gaps — and spying on rivals is ONE part of it. Public, no login.
 * Input: pick your brand from the 611K directory, or paste your Meta Ad Library link.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { FullDnaResult, Tally } from '@/lib/dna/engine'
import { videoShotList, remakeScript, type CreativeBrief } from '@/lib/dna/creative'
import { useIsMobile } from '@/lib/useIsMobile'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', ORANGE = '#ef4a1e', PAPER = '#fbf4e2'
const DARK = '#1c1611', DARK2 = '#2a2016', CREAM = '#f3ece0', MUT = '#a99f92'

type Brand = { pageId: string; name: string; adCount?: number; industry?: string | null }
type StepId = 'ads' | 'rivals' | 'gaps' | 'score'
type Finding = { text: string; bad?: boolean }   // bad → red dot (a gap/problem), else green (a good signal)
type Step = { id: StepId; label: string; status: 'pending' | 'active' | 'done'; metric?: string; findings: Finding[] }
type RivalVideo = { adId: string; brand: string; daysRunning: number; hook: string; angle: string | null; hookType: string | null; videoUrl: string; posterUrl: string | null }
type ScanResult = FullDnaResult & { brand: { pageId: string; name: string; niche: string | null }; competitors: number; ownPending?: boolean; building?: boolean; briefs?: CreativeBrief[]; rivalToRemake?: { adId: string; brand: string; daysRunning: number; hook: string; format: string | null; thumb: string | null } | null; rivalVideo?: RivalVideo | null }
// One full-screen slide in the running theater. `stage` maps it to a sidebar step (so findings tick under
// the right heading); `render` returns the slide's big, screen-fitting content.
type Slide = { key: string; stage: StepId; render: () => ReactNode }

const STEPS0: Step[] = [
  { id: 'ads', label: 'Reading your ads', status: 'pending', findings: [] },
  { id: 'rivals', label: 'Spying on your rivals', status: 'pending', findings: [] },
  { id: 'gaps', label: 'Finding your gaps', status: 'pending', findings: [] },
  { id: 'score', label: 'Scoring your ad presence', status: 'pending', findings: [] },
]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Pull a Meta page id out of an Ad Library link (view_all_page_id=… / page_id=… / …/<id>) or a bare id —
// mirrors the server extractor, so a pasted competitor link resolves the same way in /api/scan/run.
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  if (m) return m[1]
  if (/^\d{7,}$/.test(t)) return t
  return null
}

// Live animation: staggered reveal + reduced-motion guard.
const REVEAL_CSS = `
@keyframes sf-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.sf-rise{animation:sf-rise .5s cubic-bezier(.2,.7,.2,1) both}
@keyframes sf-shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
.sf-shim{background:linear-gradient(90deg,#efe8da 25%,#f7f1e5 37%,#efe8da 63%);background-size:200% 100%;animation:sf-shim 1.3s ease-in-out infinite}
.sf-gauge{transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)}
@keyframes sf-glow{0%{box-shadow:0 0 0 0 rgba(224,47,6,.0)}30%{box-shadow:0 0 0 4px rgba(224,47,6,.28)}100%{box-shadow:0 0 0 0 rgba(224,47,6,0)}}
.sf-glow{animation:sf-glow 1.6s ease-out 1 both}
@media (prefers-reduced-motion:reduce){.sf-rise{animation:none}.sf-shim{animation:none}.sf-gauge{transition:none}.sf-glow{animation:none}}
/* MOBILE: the deck's two-column slides + panel grids stack to one column, and each slide flows from the
   top (the main pane scrolls on mobile — see isMobile below — instead of cropping a too-tall slide). */
@media (max-width:767px){
  .sf-two-col{grid-template-columns:1fr !important;height:auto !important;align-items:start !important;align-content:start !important;gap:18px !important;}
  .sf-panels{grid-template-columns:1fr !important;}
  .sf-frame{justify-content:flex-start !important;height:auto !important;overflow:visible !important;gap:16px !important;}
}
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

export default function ScanTheater({ embedded = false, seed, onDone, onError }: {
  embedded?: boolean
  seed?: { pageId?: string; adLibraryUrl?: string; name?: string; competitors?: { pageId: string; name: string }[] }
  onDone?: (res: any) => void
  onError?: () => void   // ads pull failed after retries — the combined audit continues with the SEO half
} = {}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Brand[]>([])
  const [showLink, setShowLink] = useState(false)
  const [adLink, setAdLink] = useState('')
  // After a brand is picked we ask for competitors BEFORE running, so the audit compares against the
  // right rivals from the start (not auto-guessed then corrected at the end).
  const [picked, setPicked] = useState<{ pageId?: string; adLibraryUrl?: string; name: string } | null>(null)
  const [comps, setComps] = useState<{ pageId: string; name: string }[]>([])
  const [cq, setCq] = useState('')
  const [cresults, setCresults] = useState<Brand[]>([])
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [steps, setSteps] = useState<Step[]>(STEPS0)
  const [stage, setStage] = useState<StepId>('ads')
  const [pct, setPct] = useState(0)
  const [res, setRes] = useState<ScanResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  // The running phase is a full-viewport SLIDE DECK (Ryze-style): run() builds an ordered deck from the
  // data and advances slideIdx on a timer; the main pane renders exactly ONE slide at a time, no scroll.
  const [slides, setSlides] = useState<Slide[]>([])
  const [slideIdx, setSlideIdx] = useState(0)
  const [errMsg, setErrMsg] = useState('')
  const running = useRef(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPayload = useRef<{ pageId?: string; adLibraryUrl?: string; competitors?: string[] }>({})
  const autoStarted = useRef(false)   // embedded mode: fire the seed-driven auto-run exactly once
  const retryCount = useRef(0)         // auto-retry a transient ads-scan blip before ever showing an error
  const mainRef = useRef<HTMLElement>(null)
  const isMobile = useIsMobile()   // stack the theater to one column on phones (client-only; SSR-safe)
  // Each act is a full-viewport frame that SWAPS in place (Ryze-style) — reset the pane to the top when
  // the stage changes or the report opens, so a new act always starts at the top of the window.
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [stage, revealed, phase])

  useEffect(() => {
    if (phase !== 'idle') return
    if (q.trim().length < 2) { setResults([]); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      fetch(`/api/scan/brands?q=${encodeURIComponent(q.trim())}`).then((r) => r.json())
        .then((j) => setResults(Array.isArray(j.results) ? j.results.slice(0, 8) : [])).catch(() => setResults([]))
    }, 220)
  }, [q, phase])

  // Competitor search (the upfront "add your rivals" step).
  useEffect(() => {
    if (!picked) return
    if (cq.trim().length < 2) { setCresults([]); return }
    const t = setTimeout(() => {
      fetch(`/api/scan/brands?q=${encodeURIComponent(cq.trim())}`).then((r) => r.json())
        .then((j) => setCresults(Array.isArray(j.results) ? j.results.slice(0, 6) : [])).catch(() => setCresults([]))
    }, 220)
    return () => clearTimeout(t)
  }, [cq, picked])

  const startAudit = useCallback(() => {
    if (!picked) return
    const base = picked.pageId ? { pageId: picked.pageId } : { adLibraryUrl: picked.adLibraryUrl }
    const competitors = comps.map((c) => c.pageId)
    run(competitors.length ? { ...base, competitors } : base)
  }, [picked, comps])

  const setStep = useCallback((id: StepId, status: Step['status'], metric?: string) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, status, metric: metric ?? x.metric } : x))), [])
  const addFinding = useCallback((id: StepId, text: string, bad?: boolean) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, findings: [...x.findings, { text, bad }] } : x))), [])

  const run = useCallback(async (payload: { pageId?: string; adLibraryUrl?: string; competitors?: string[] }) => {
    if (running.current) return
    running.current = true
    lastPayload.current = payload
    setRes(null); setRevealed(false); setSlides([]); setSlideIdx(0); setSteps(STEPS0); setPhase('running'); setStage('ads'); setStep('ads', 'active'); setPct(5)
    // Smooth, time-based progress creep (Ryze-style "13%… 57%…") — independent of the findings, so the
    // bar always drifts up instead of jumping. Cleared on every exit path. Reassignable so we can pause it
    // during a crawl-wait poll and restart it once the ads land.
    let prog = 5
    let progIv: ReturnType<typeof setInterval> | null = setInterval(() => { prog = Math.min(96, prog + 1); setPct(prog) }, 560)
    const stopProg = () => { if (progIv) { clearInterval(progIv); progIv = null } }
    const PER_SLIDE_MS = 2600          // dwell per slide — snappy; the data's already in the system, don't stall
    const F = (t: string, b?: boolean): [string, boolean?] => [t, b]
    try {
      // Hard timeout: a hanging fetch (never resolves) used to freeze the whole audit. Abort at 30s so a
      // hang becomes a normal error → auto-retry → (embedded) degrade to the SEO half. Never spins forever.
      const ctrl = new AbortController()
      const killT = setTimeout(() => ctrl.abort(), 30000)
      const r = await fetch('/api/scan/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal }).finally(() => clearTimeout(killT))
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Scan failed')
      let data: ScanResult = await r.json()
      setRes(data)
      // Cold brand with NOTHING to wait for (no crawl kicked off) → show the building/re-run state. But if
      // a crawl IS pending (ownPending), do NOT bail here — fall through to the WAIT-FOR-CRAWL path below so
      // the user waits on this step and sees REAL results, instead of a scoreless screen they'd never revisit.
      if (data.building && !data.ownPending) { stopProg(); setSteps((s) => s.map((x) => ({ ...x, status: 'done', metric: x.id === 'ads' ? 'crawling…' : '' }))); setPct(100); setPhase('done'); running.current = false; return }

      const brandNameOf = (d: ScanResult) => (d.brand?.name && d.brand.name !== 'your brand' ? d.brand.name : 'your brand')

      // ── WAIT FOR THE CRAWL ── first time we've seen this brand: ads aren't indexed yet but a priority
      // crawl was kicked off. Hold a "pulling your ads" slide + poll /api/scan/run until they land (or cap).
      if (!data.own.found && data.ownPending) {
        setStage('ads'); setStep('ads', 'active', 'crawling…')
        addFinding('ads', `Pulling your ads now — first time we’ve seen ${brandNameOf(data)}`)
        stopProg()
        // A cold, spy-priority full-archive crawl (same IPRoyal crawler as Brand Spy) usually takes a few
        // minutes, sometimes more for deep libraries. Wait up to ~8 min, re-polling and showing HONEST
        // progress (elapsed + a bar driven by elapsed + copy that deepens) so it never looks frozen.
        const STEP_MS = 18000, MAX_STEPS = 27          // ~8 min cap
        const capS = Math.round((MAX_STEPS * STEP_MS) / 1000)
        let data2 = data
        // FAST PULL — grab the brand's live ads on-demand (droplet, ~seconds) so the user sees REAL ads
        // immediately instead of staring at a spinner for minutes. URLs only — no IPRoyal media download.
        let liveAds: { thumb: string | null; isVideo?: boolean }[] = []
        const cold = data.brand?.pageId
        if (cold) {
          fetch(`/api/scan/live-ads?page_id=${encodeURIComponent(cold)}`).then((r) => r.ok ? r.json() : null).then((d) => {
            if (d?.ads?.length) { liveAds = d.ads; setSlides([{ key: 'pulling', stage: 'ads', render: () => pullingSlide(brandNameOf(data), 0, capS, liveAds) }]); setSlideIdx(0) }
          }).catch(() => {})
        }
        for (let t = 0; t < MAX_STEPS && !data2.own.found; t++) {
          const elapsedS = t * (STEP_MS / 1000)
          setSlides([{ key: 'pulling', stage: 'ads', render: () => pullingSlide(brandNameOf(data), elapsedS, capS, liveAds) }]); setSlideIdx(0)
          setPct(40 + Math.round((t / MAX_STEPS) * 35))   // sidebar bar creeps 40 → 75 over the wait
          await sleep(STEP_MS)
          try { const rr = await fetch('/api/scan/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lastPayload.current) }); if (rr.ok) data2 = await rr.json() } catch { /* keep polling */ }
        }
        if (!data2.own.found) {
          // Still nothing after the cap — honest "still pulling" copy, NEVER a fake "invisible/0".
          setSlides([{ key: 'timeout', stage: 'ads', render: () => timeoutSlide(brandNameOf(data2)) }]); setSlideIdx(0)
          setSteps((s) => s.map((x) => ({ ...x, status: x.id === 'ads' ? 'active' : 'pending', metric: x.id === 'ads' ? 'crawling…' : '' })))
          setPct(75); running.current = false; return
        }
        data = data2; setRes(data2)
        // Ads landed — restart the normal creep from where the wait left off.
        prog = 76
        progIv = setInterval(() => { prog = Math.min(96, prog + 1); setPct(prog) }, 560)
      }

      // ── BUILD THE DECK ── ordered, screen-fitting slides. Dense sets (DNA / vs) split into sub-slides.
      const ownD0 = data.own.dist as Record<string, Tally[]>, winD0 = data.winners.dist as Record<string, Tally[]>
      const dnaChunks = (dist: Record<string, Tally[]>) => (PANELS.filter(([k]) => (dist[k] || []).length).length > 4 ? 2 : 1)
      const buildDeck = (d: ScanResult): Slide[] => {
        const deck: Slide[] = []
        const oD = d.own.dist as Record<string, Tally[]>, wD = d.winners.dist as Record<string, Tally[]>
        const bn = brandNameOf(d)
        if (d.own.found) {
          deck.push({ key: 'ads', stage: 'ads', render: () => slideAdsStats(d.own, bn) })
          for (let i = 0; i < dnaChunks(oD); i++) deck.push({ key: `ads-dna-${i}`, stage: 'ads', render: () => slideDna(oD, 'Your creative DNA', i) })
        } else {
          deck.push({ key: 'ads', stage: 'ads', render: () => slideNoAds(bn) })
        }
        deck.push({ key: 'rivals', stage: 'rivals', render: () => slideRivals(d.winners) })
        if ((wD.hook_type || wD.angle || wD.usp)) deck.push({ key: 'rivals-formula', stage: 'rivals', render: () => slideFormula(d.winners) })
        for (let i = 0; i < dnaChunks(wD); i++) deck.push({ key: `rivals-dna-${i}`, stage: 'rivals', render: () => slideDna(wD, 'Their winning DNA', i) })
        const vsDims = PANELS.filter(([k]) => (oD[k] || []).length || (wD[k] || []).length).length
        for (let i = 0; i < (vsDims > 3 ? 2 : 1); i++) deck.push({ key: `vs-${i}`, stage: 'gaps', render: () => slideVs(oD, wD, i) })
        deck.push({ key: 'score', stage: 'score', render: () => slideScore(d) })
        return deck
      }
      const deck = buildDeck(data)
      setSlides(deck); setSlideIdx(0)

      // Per-slide sidebar findings (kept from the old theater copy) — tick a few as each slide shows.
      const topLabel = (dd: Record<string, Tally[]>, k: string) => (dd[k] || [])[0]?.label
      const slideFindings = (key: string): [string, boolean?][] => {
        if (key === 'ads' && data.own.found) {
          const f: [string, boolean?][] = [F(`Opened ${data.own.totalAds.toLocaleString()} ads — reading every one`), F(`${data.own.activeAds} live right now`)]
          if (data.own.media.length) f.push(F(`Format mix: ${data.own.media.slice(0, 3).map((m) => `${m.label} ${m.pct}%`).join(' · ')}`))
          return f
        }
        if (key === 'ads') return [F('No live ads we can see — that’s gap #1', true)]
        if (key.startsWith('ads-dna')) {
          const f: [string, boolean?][] = []
          if (topLabel(ownD0, 'hook_type')) f.push(F(`Your signature hook: ${topLabel(ownD0, 'hook_type')}`))
          if (topLabel(ownD0, 'angle')) f.push(F(`Your lead angle: ${topLabel(ownD0, 'angle')}`))
          if (topLabel(ownD0, 'emotion')) f.push(F(`Strongest emotion you pull: ${topLabel(ownD0, 'emotion')}`))
          return f.length ? f : [F('Mapping your creative DNA')]
        }
        if (key === 'rivals') {
          const f: [string, boolean?][] = [F(`Pulled ${data.winners.winnerCount.toLocaleString()} rival ads still running after 90 days`)]
          if (data.winners.media[0]) f.push(F(`They lean on ${data.winners.media[0].label} (${data.winners.media[0].pct}%)`))
          if (data.winners.examples[0]?.daysRunning) f.push(F(`Longest-running winner: ${data.winners.examples[0].daysRunning} days live`))
          return f
        }
        if (key === 'rivals-formula') {
          const f: [string, boolean?][] = []
          const hk = topLabel(winD0, 'hook_type'), an = topLabel(winD0, 'angle'), fm = data.winners.media[0]?.label
          if (an && hk) f.push(F(`Their recipe: ${hk} hook × ${an} angle`))
          if (fm) f.push(F(`Delivered mostly as ${fm}`))
          if (topLabel(winD0, 'usp')) f.push(F(`Promising: ${topLabel(winD0, 'usp')}`))
          return f.length ? f : [F('Synthesising their winning formula')]
        }
        if (key.startsWith('rivals-dna')) {
          const f: [string, boolean?][] = []
          if (topLabel(winD0, 'angle')) f.push(F(`Their favourite angle: ${topLabel(winD0, 'angle')}`))
          if (topLabel(winD0, 'hook_type')) f.push(F(`Their favourite hook: ${topLabel(winD0, 'hook_type')}`))
          if (topLabel(winD0, 'usp')) f.push(F(`Their strongest promise: ${topLabel(winD0, 'usp')}`))
          return f.length ? f : [F('Decoding their winning DNA')]
        }
        if (key.startsWith('vs')) {
          if (data.gaps.length) {
            const f: [string, boolean?][] = [F(`${data.gaps.length} winning move${data.gaps.length === 1 ? '' : 's'} you’re not running`, true)]
            for (const g of data.gaps.slice(0, 3)) f.push(F(`Missing: ${g.dimension} — ${g.label}`, true))
            return f
          }
          return [F('You’re already running the winners’ playbook')]
        }
        if (key === 'score') {
          const f: [string, boolean?][] = []
          for (const sc of data.score.subscores) { if (sc.value == null) continue; f.push(F(`${sc.label}: ${sc.value}/100`, sc.value < 50)) }
          return f.length ? f : [F(`${data.score.total}/100 · ${data.score.band}`)]
        }
        return []
      }
      const stageMetric = (id: StepId): string =>
        id === 'ads' ? (data.own.found ? `${data.own.totalAds} ads` : 'none')
          : id === 'rivals' ? `${data.winners.winnerCount} winners`
            : id === 'gaps' ? `${data.gaps.length} gaps`
              : `${data.score.total}/100`

      // ── STEP THE DECK ── one full-screen slide at a time; tick its findings, then dwell.
      await sleep(700)
      for (let i = 0; i < deck.length; i++) {
        const s = deck[i]
        setSlideIdx(i); setStage(s.stage); setStep(s.stage, 'active')
        let used = 0
        for (const [text, bad] of slideFindings(s.key)) { addFinding(s.stage, text, bad); await sleep(1000); used += 1000 }
        // last slide of this stage → mark the sidebar step done
        if (i === deck.length - 1 || deck[i + 1].stage !== s.stage) setStep(s.stage, 'done', stageMetric(s.stage))
        // Dense slides need longer to read (the score slide packs the $100k→$1M benchmark + ad-presence
        // score; formula/DNA carry a lot). Give them extra dwell so they don't fly past.
        const dwell = s.key === 'score' ? 13000 : (s.key === 'rivals-formula' || s.key.includes('dna')) ? 9500 : PER_SLIDE_MS
        await sleep(Math.max(1400, dwell - used))
      }
      stopProg(); setPct(100); await sleep(600)
      setPhase('done'); running.current = false; retryCount.current = 0
      if (embedded) onDone?.(data)   // ONLY on true success — never on the building/timeout non-complete exits above
    } catch (e) {
      stopProg(); running.current = false
      // A transient blip shouldn't dead-end the audit: auto-retry a couple of times before ever showing
      // an error. If it STILL fails, embedded mode hands off (onError) so the SEO/AI half still runs.
      if (retryCount.current < 2) { retryCount.current++; setTimeout(() => { run(lastPayload.current) }, 2500); return }
      retryCount.current = 0
      if (embedded) { setPhase('done'); onError?.(); return }   // combined audit → stop spinner, parent runs the SEO half
      setErrMsg(String((e as Error).message || 'Scan failed')); setPhase('error')
    }
  }, [setStep, addFinding, embedded, onDone, onError])

  // EMBEDDED — auto-start from the seed once (Act 1 of the combined audit page). Placed after run() so it
  // sits in scope; a ref guards against re-firing. No effect at all in standalone mode.
  useEffect(() => {
    if (!embedded || !seed || autoStarted.current) return
    if (!(seed.pageId || seed.adLibraryUrl)) return
    if (phase !== 'idle') return
    autoStarted.current = true
    run({ pageId: seed.pageId, adLibraryUrl: seed.adLibraryUrl, competitors: (seed.competitors || []).map((c) => c.pageId) })
  }, [embedded, seed, phase, run])

  // ── IDLE — audit framing + brand picker (or ad-library link) ──
  if (phase === 'idle') {
    // EMBEDDED — the combined page owns the picker; never show the standalone brand/competitor screen.
    // While the seed-driven auto-run is spinning up, show a minimal centered loader (not the hero form).
    if (embedded) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: SUB, fontSize: 15 }}>Preparing…</div>
      )
    }
    return (
      <div style={{ position: 'relative', minHeight: '100vh', background: '#e02f06', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: 'clamp(32px,6vw,80px)', color: '#fff', overflow: 'hidden' }}>
        {/* full-bleed hero film, like the landing page */}
        <video src="/hero.mp4" autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
        {/* orange wash for legibility — heavy over the text on the left, thinning to reveal the film right */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(100deg, rgba(224,47,6,.95) 0%, rgba(224,47,6,.88) 40%, rgba(224,47,6,.5) 100%)' }} />
        <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 1040 }}>
          {/* the pitch + brand picker */}
          <div style={{ minWidth: 0, maxWidth: 560 }}>
            <div style={{ fontFamily: 'Fraunces,serif', fontStyle: 'italic', color: 'rgba(255,255,255,.92)', fontSize: 20, marginBottom: 10 }}>free · 90 seconds · no login</div>
            <h1 style={{ fontFamily: 'Fraunces,Georgia,serif', fontSize: 'clamp(40px,6.4vw,64px)', lineHeight: .98, letterSpacing: '-.02em', color: '#fff', margin: '0 0 16px' }}>Audit your ads.</h1>
            <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 18, lineHeight: 1.5, margin: '0 0 28px', maxWidth: 460 }}>See exactly where your ads stand — your presence, your gaps, and what your rivals are winning with.</p>

            {picked ? (
              /* STEP 2 — add competitors before we run (or skip → auto-detect) */
              <div style={{ maxWidth: 480 }}>
                {/* brand is LOCKED IN — a confirmed chip so it's obvious it was added, not still asking */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.32)', borderRadius: 100, padding: '8px 16px 8px 10px', marginBottom: 22 }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', color: ORANGE, fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                  <span style={{ color: '#fff', fontSize: 15 }}>{picked.name && picked.name !== 'your brand'
                    ? <><b>{picked.name}</b> <span style={{ opacity: .7 }}>· your brand, added</span></>
                    : <><b>Your Meta page</b> <span style={{ opacity: .7 }}>· added from your Ad Library link</span></>}</span>
                </div>
                <div style={{ fontFamily: 'Fraunces,Georgia,serif', fontWeight: 700, color: '#fff', fontSize: 'clamp(24px,3.4vw,30px)', lineHeight: 1.05, margin: '0 0 8px' }}>Now — who do you compete with?</div>
                <p style={{ color: 'rgba(255,255,255,.9)', fontSize: 16, lineHeight: 1.5, margin: '0 0 16px' }}>Add the rival brands you want to be measured against — or skip and we&rsquo;ll find them for you.</p>
                <div style={{ position: 'relative' }}>
                  <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Add a competitor — name or Ad Library link…" autoFocus
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      const id = extractPageId(cq)   // pasted a Meta Ad Library link / page id → add directly
                      if (id && id !== picked.pageId && !comps.some((c) => c.pageId === id)) { setComps((s) => [...s, { pageId: id, name: `Competitor · ${id}` }]); setCq(''); setCresults([]) }
                    }}
                    style={{ width: '100%', padding: '14px 16px', borderRadius: cresults.length ? '14px 14px 0 0' : 100, border: 'none', fontSize: 15, background: '#fff', color: INK, outline: 'none', boxShadow: '0 18px 44px -20px rgba(0,0,0,.5)' }} />
                  {cresults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: '0 0 14px 14px', overflow: 'hidden', zIndex: 5, boxShadow: '0 24px 44px -18px rgba(0,0,0,.5)' }}>
                      {cresults.map((b) => (
                        <button key={b.pageId} onClick={() => { if (b.pageId !== picked.pageId && !comps.some((c) => c.pageId === b.pageId)) setComps((s) => [...s, { pageId: b.pageId, name: b.name }]); setCq(''); setCresults([]) }}
                          style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 15px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', textAlign: 'left' }}>
                          <span style={{ fontWeight: 700, fontSize: 14.5, color: INK }}>{b.name}</span>
                          <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 11.5, color: SUB }}>{b.adCount ? `${b.adCount.toLocaleString()} ads` : '+ add'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,.8)' }}>Search our directory, or paste their <b style={{ color: '#fff' }}>Meta Ad Library link</b> and hit Enter.</div>
                {comps.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                    {comps.map((c) => (
                      <span key={c.pageId} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 100, padding: '6px 8px 6px 14px', fontSize: 13.5, fontWeight: 700, color: '#fff' }}>
                        {c.name}
                        <button onClick={() => setComps((s) => s.filter((x) => x.pageId !== c.pageId))} aria-label="Remove" style={{ border: 'none', background: 'rgba(255,255,255,.25)', borderRadius: 100, width: 20, height: 20, cursor: 'pointer', color: '#fff', fontWeight: 800, lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 18 }}>
                  <button onClick={startAudit} style={{ background: '#fff', color: ORANGE, border: 'none', borderRadius: 100, padding: '15px 28px', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>
                    {comps.length ? `Audit vs ${comps.length} rival${comps.length === 1 ? '' : 's'} →` : 'Start audit →'}
                  </button>
                  {comps.length > 0 && <button onClick={() => { setComps([]); run(picked.pageId ? { pageId: picked.pageId } : { adLibraryUrl: picked.adLibraryUrl }) }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', fontSize: 14, cursor: 'pointer' }}>skip — find them for me</button>}
                </div>
                <button onClick={() => { setPicked(null); setComps([]); setCq('') }} style={{ marginTop: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,.75)', fontSize: 13.5, cursor: 'pointer' }}>← change brand</button>
              </div>
            ) : !showLink ? (
              <div style={{ position: 'relative', maxWidth: 460 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your brand…" autoFocus
                  style={{ width: '100%', padding: '16px 18px', borderRadius: results.length ? '16px 16px 0 0' : 100, border: 'none', fontSize: 16, background: '#fff', color: INK, outline: 'none', boxShadow: '0 18px 44px -20px rgba(0,0,0,.5)' }} />
                {results.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: '0 0 16px 16px', overflow: 'hidden', zIndex: 5, boxShadow: '0 24px 44px -18px rgba(0,0,0,.5)' }}>
                    {results.map((b) => (
                      <button key={b.pageId} onClick={() => { setPicked({ pageId: b.pageId, name: b.name }); setQ(''); setResults([]) }}
                        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: INK }}>{b.name}</span>
                        <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, color: SUB }}>{b.adCount ? `${b.adCount.toLocaleString()} ads` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 16, fontSize: 14, color: 'rgba(255,255,255,.85)' }}>
                  Can&rsquo;t find it? <button onClick={() => setShowLink(true)} style={{ background: 'none', border: 'none', color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 3 }}>Paste your Meta Ad Library link →</button>
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: 480 }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input value={adLink} onChange={(e) => setAdLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adLink.trim() && setPicked({ adLibraryUrl: adLink.trim(), name: 'your brand' })} placeholder="facebook.com/ads/library/?…view_all_page_id=…" autoFocus
                    style={{ flex: 1, minWidth: 0, padding: '15px 16px', borderRadius: 100, border: 'none', fontSize: 14, background: '#fff', color: INK, outline: 'none', boxShadow: '0 18px 44px -20px rgba(0,0,0,.5)' }} />
                  <button onClick={() => adLink.trim() && setPicked({ adLibraryUrl: adLink.trim(), name: 'your brand' })} style={{ background: '#fff', color: ORANGE, border: 'none', borderRadius: 100, padding: '15px 24px', fontSize: 15, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' }}>Next →</button>
                </div>
                <button onClick={() => setShowLink(false)} style={{ marginTop: 14, background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', fontSize: 14, cursor: 'pointer' }}>← Search by brand name instead</button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const winners = res?.winners
  const own = res?.own

  // EMBEDDED — never own the viewport: flow inside the parent's scroll container (Act 1 of the combined
  // page). Running still gets a 100dvh deck pane (below) so the slides fill a screen; the report flows.
  const rootFrame: CSSProperties = embedded
    ? { minHeight: 'auto', height: 'auto', overflow: 'visible' }
    : { minHeight: '100dvh', height: phase === 'done' ? 'auto' : '100dvh', overflow: phase === 'done' ? 'visible' : 'hidden' }

  return (
    <div style={{ ...rootFrame, background: PAPER, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,300px) minmax(0,1fr)', gridTemplateRows: isMobile && phase !== 'done' ? 'auto minmax(0,1fr)' : undefined }}>
      <style>{REVEAL_CSS}</style>
      {/* Sidebar → on phones a COMPACT top bar (title + progress only; the step/findings list is hidden so
          the slide gets the whole screen). On desktop it's the full sticky rail. */}
      <aside style={{ background: DARK, color: CREAM, display: 'flex', ...(isMobile
        ? { flexDirection: 'row', alignItems: 'center', gap: 14, padding: '11px 16px', position: 'sticky', top: 0, zIndex: 5 }
        : { flexDirection: 'column', padding: '28px 24px', position: 'sticky', top: 0, alignSelf: 'start', height: '100dvh' }) }}>
        <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: isMobile ? 16 : 22, color: '#fff', flex: 'none' }}>{phase === 'done' ? (res?.building ? 'Crawling your ads…' : 'Audit complete') : 'Auditing your ads'}</div>
        <div style={{ display: isMobile ? 'none' : 'block', color: MUT, fontSize: 13.5, margin: '6px 0 24px', lineHeight: 1.45 }}>{res?.brand?.name || 'Your brand'}{res?.brand?.niche ? ` · ${res.brand.niche}` : ''}</div>
        <div style={{ display: isMobile ? 'none' : 'block', flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {steps.map((s) => (
            <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 18, textAlign: 'center', color: s.status === 'done' ? ORANGE : s.status === 'active' ? '#fff' : MUT, fontWeight: 800 }}>{s.status === 'done' ? '✓' : s.status === 'active' ? '◐' : '○'}</span>
                <span style={{ fontSize: 14.5, fontWeight: s.status === 'active' ? 800 : 600, color: s.status === 'pending' ? MUT : '#fff' }}>{s.label}</span>
                {s.metric && <span style={{ marginLeft: 'auto', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 11.5, color: ORANGE }}>{s.metric}</span>}
              </div>
              {s.findings.length > 0 && (
                <div style={{ margin: '7px 0 2px', paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {s.findings.map((f, i) => (
                    <div key={i} className="sf-rise" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, lineHeight: 1.35, color: 'rgba(255,255,255,.82)' }}>
                      <span style={{ flex: 'none', width: 6, height: 6, borderRadius: 6, marginTop: 5, background: f.bad ? '#ff6a3d' : '#3fbf7f' }} />
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: isMobile ? 0 : 18, flex: isMobile ? '1 1 auto' : 'none', minWidth: isMobile ? 100 : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: MUT, marginBottom: 6 }}><span>{phase === 'done' ? 'Done' : 'Working…'}</span><span>{pct}%</span></div>
          <div style={{ height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 100 }}><div style={{ height: 4, width: `${pct}%`, background: ORANGE, borderRadius: 100, transition: 'width .5s' }} /></div>
        </div>
      </aside>

      {/* RUNNING: a fixed 100dvh pane holding ONE slide (no scroll). DONE: the report flows + scrolls with
          the page (root goes overflow:visible), which Moeez approved. */}
      <main ref={mainRef} style={{ padding: isMobile ? 'clamp(18px,5vw,24px)' : 'clamp(28px,4vw,56px)', minWidth: 0, ...(phase === 'done' ? {} : { height: embedded ? '100dvh' : '100%', overflow: isMobile ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }) }}>
        {phase === 'error' && (
          <div><h2 style={h2}>{errMsg}</h2><button onClick={() => { autoStarted.current = false; running.current = false; retryCount.current = 0; setPhase('idle'); setSteps(STEPS0); setPct(0) }} style={btn}>Try again</button></div>
        )}
        {phase === 'running' && (slides.length
          ? <SlideFrame key={slides[slideIdx]?.key}>{slides[slideIdx]?.render()}</SlideFrame>
          : <SlideFrame><h2 style={h2}>Reading your ads…</h2><p style={sub}>Pulling every ad on your page.</p></SlideFrame>)}
        {phase === 'done' && res && (res.building
          ? <BuildingScreen res={res} onRerun={() => run(lastPayload.current)} />
          : (embedded || revealed)   // embedded skips the manual unlock gate → report renders directly
            ? <FullReport res={res} own={own!} winners={winners!} onReaudit={(ids) => run({ ...lastPayload.current, competitors: ids })} embedded={embedded} />
            : <ScanSummary res={res} onUnlock={() => setRevealed(true)} />)}
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
          <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 12 }}>{label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(dist[k] || []).slice(0, 6).map((t, i) => <span key={i} style={{ fontSize: 15, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 14px', color: INK, fontWeight: 600 }}>{t.label} <b style={{ color: SUB }}>{t.count}</b></span>)}
          </div>
        </div>
      ))}
    </div>
  )
}
const pill = (hot: boolean): CSSProperties => ({ fontSize: 15, fontWeight: 600, background: hot ? ORANGE : PAPER, color: hot ? '#fff' : INK, border: `1px solid ${hot ? ORANGE : LINE}`, borderRadius: 100, padding: '7px 14px' })
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

// ════════════ RUNNING THEATER — full-viewport SLIDE DECK ════════════
// Each slide fills one screen and swaps in place (auto-advance on a timer). Content is sized with clamp()
// + grids so it FITS one screen; dense sets are split into sub-slides upstream — a slide NEVER scrolls.
function SlideFrame({ children }: { children: ReactNode }) {
  return (
    <div className="sf-rise sf-frame" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
      {children}
    </div>
  )
}
const slideEyebrow: CSSProperties = { fontSize: 'clamp(11px,1.4vw,13px)', fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: ORANGE, marginBottom: 8 }
const slideH: CSSProperties = { fontFamily: 'Fraunces,Georgia,serif', fontWeight: 700, fontSize: 'clamp(26px,4.4vw,52px)', letterSpacing: '-.02em', lineHeight: 1.02, color: INK, margin: 0 }
const slideHead = (eyebrow: string, title: ReactNode) => (
  <div style={{ flex: 'none' }}><div style={slideEyebrow}>{eyebrow}</div><h2 style={slideH}>{title}</h2></div>
)

// SLIDE 1 — your ad presence: narrative column (verdict + hero numbers + media bar) beside a FEATURED
// own ad shown large + a filmstrip. Mirrors the Rivals slide so "you" and "them" read as a matched set.
function slideAdsStats(own: FullDnaResult['own'], brandName: string) {
  const vid = own.media.find((m) => m.label === 'Video')?.pct ?? 0
  const ex = own.examples
  const hero = ex.find((e) => e.thumb) || ex[0]
  const strip = ex.filter((e) => e.adId !== hero?.adId).slice(0, 4)
  return (
    <div className="sf-two-col" style={{ display: 'grid', gridTemplateColumns: hero ? 'minmax(0,1.15fr) minmax(0,.85fr)' : '1fr', gap: 'clamp(18px,3vw,44px)', alignItems: 'center', height: '100%' }}>
      {/* LEFT — the narrative */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(14px,2.2vw,24px)', minWidth: 0 }}>
        <div>
          <div style={slideEyebrow}>Reading your ads</div>
          <h2 style={slideH}>{brandName === 'your brand' ? "You're" : brandName + ' is'} <span style={{ color: ORANGE }}>in market</span>.</h2>
        </div>
        <div style={{ display: 'flex', gap: 'clamp(14px,3vw,40px)', flexWrap: 'wrap' }}>
          <HeroStat n={own.totalAds} label="ads in market" color={ORANGE} />
          <HeroStat n={own.activeAds} label="live right now" />
          <HeroStat n={vid} suffix="%" label="are video" />
        </div>
        <div><MediaBar media={own.media} /></div>
      </div>
      {/* RIGHT — one of your ads, featured */}
      {hero && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <FeaturedAdCard ex={hero} badge={hero.daysRunning ? `${hero.daysRunning}d live` : 'your ad'} />
          <Filmstrip items={strip} />
        </div>
      )}
    </div>
  )
}

// SLIDE — no live ads (honest, only for genuinely-not-found brands; never shown for a pending crawl).
function slideNoAds(brandName: string) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto' }}>
      {slideHead('Reading your ads', <>No live ads we can see — that’s gap #1</>)}
      <p style={{ ...sub, margin: '16px auto 0', textAlign: 'center' }}>We couldn’t find ads running for {brandName === 'your brand' ? 'your page' : brandName} right now. Showing up is the first fix — here’s what winning looks like in your market.</p>
    </div>
  )
}

// SLIDE — creative DNA, chunked 4 panels per slide (so 7 dims split 4+3, never scroll). Each panel leads
// with its #1 move BIG (Fraunces + a share bar), then the runners-up as chips — editorial, not a flat list.
// Plain-English gloss for each DNA dimension — so "Emotion: trust" reads as "the feeling their ads lean on".
const DNA_GLOSS: Record<string, string> = {
  emotion: 'the feeling their ads lean on',
  themes: 'what the ad is mostly about',
  hook_type: 'how the ad grabs you in the first line',
  angle: 'the reason they give you to buy',
  persona: 'who they’re speaking to',
  usp: 'the promise they make',
  desire: 'the outcome they’re selling',
  format_style: 'the look & style of the creative',
}
function slideDna(dist: Record<string, Tally[]>, title: string, chunk: number) {
  const panels = PANELS.filter(([k]) => (dist[k] || []).length).slice(chunk * 4, chunk * 4 + 4)
  return (
    <>
      {slideHead('Creative DNA', title)}
      <div className="sf-panels" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 'clamp(12px,1.6vw,16px)' }}>
        {panels.map(([k, label], i) => {
          const items = dist[k] || []
          const top = items[0]
          const max = items.reduce((m, t) => Math.max(m, t.count), 1)
          return (
            <div key={k} className="sf-rise" style={{ ...rise(i), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 'clamp(13px,1.7vw,19px)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 2 }}>{label}</div>
              {DNA_GLOSS[k] && <div style={{ fontSize: 11, color: MUT, marginBottom: 9, lineHeight: 1.3 }}>{DNA_GLOSS[k]}</div>}
              {top && (
                <div style={{ marginBottom: items.length > 1 ? 11 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(17px,2.1vw,23px)', color: INK, lineHeight: 1.05, letterSpacing: '-.01em' }}>{top.label}</span>
                    <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 13, fontWeight: 700, color: ORANGE, flex: 'none' }}>{top.pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 100, background: '#eee6d7', marginTop: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(8, Math.round((top.count / max) * 100))}%`, background: ORANGE, borderRadius: 100 }} />
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {items.slice(1, 5).map((t, j) => <span key={j} style={{ fontSize: 'clamp(12px,1.4vw,14px)', background: PAPER, border: `1px solid ${LINE}`, borderRadius: 100, padding: '5px 12px', color: INK, fontWeight: 600 }}>{t.label} <b style={{ color: SUB }}>{t.pct}%</b></span>)}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// A hero stat — one huge Fraunces number + a small caption. The theater's "big words" workhorse.
function HeroStat({ n, label, suffix = '', color = INK }: { n: number; label: string; suffix?: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(40px,6.4vw,72px)', color, lineHeight: .88, letterSpacing: '-.03em' }}><Count n={n} />{suffix}</div>
      <div style={{ fontSize: 'clamp(12px,1.5vw,14px)', color: SUB, fontWeight: 600, marginTop: 5 }}>{label}</div>
    </div>
  )
}

type Ex = FullDnaResult['winners']['examples'][number]
// A single ad shown large — the theater's image-dominant "hero". Real R2 thumb, badge + brand/hook overlay.
function FeaturedAdCard({ ex, badge }: { ex: Ex; badge?: string }) {
  return (
    <div className="sf-rise" style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', border: `1px solid ${LINE}`, aspectRatio: '4 / 5', maxHeight: '54vh', background: ex.thumb ? `#f1ece2 url(${ex.thumb}) center/cover` : '#eee6d7', boxShadow: '0 18px 50px -22px rgba(26,20,16,.5)' }}>
      {badge && <div style={{ position: 'absolute', top: 11, left: 11, background: ORANGE, color: '#fff', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, fontWeight: 800, padding: '5px 11px', borderRadius: 100 }}>{badge}</div>}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '30px 13px 11px', background: 'linear-gradient(transparent,rgba(20,14,8,.78))', color: '#fff' }}>
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>{ex.brand}</div>
        {ex.hook && <div style={{ fontSize: 11.5, opacity: .82, lineHeight: 1.3, maxHeight: 30, overflow: 'hidden', marginTop: 2 }}>{ex.hook}</div>}
      </div>
    </div>
  )
}
// A row of small ad thumbnails under a featured card — "there's more where that came from".
function Filmstrip({ items }: { items: Ex[] }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length},1fr)`, gap: 8 }}>
      {items.map((e, i) => (
        <div key={e.adId} className="sf-rise" style={{ ...rise(i + 2), aspectRatio: '4 / 5', borderRadius: 10, border: `1px solid ${LINE}`, background: e.thumb ? `#f1ece2 url(${e.thumb}) center/cover` : '#eee6d7' }} title={`${e.brand} · ${e.daysRunning}d`} />
      ))}
    </div>
  )
}

// SLIDE — spying on rivals: a narrative column (headline + surveillance stats + rival names + media bar)
// beside a FEATURED winning ad shown large, with a filmstrip of more. Image-dominant, Ryze theater.
function slideRivals(winners: FullDnaResult['winners']) {
  const ex = winners.examples
  const hero = ex.find((e) => e.thumb) || ex[0]
  const strip = ex.filter((e) => e.adId !== hero?.adId).slice(0, 4)
  const brands = Array.from(new Set(ex.map((e) => e.brand).filter(Boolean))).slice(0, 6)
  const topDays = ex.reduce((m, e) => Math.max(m, e.daysRunning || 0), 0)
  return (
    <div className="sf-two-col" style={{ display: 'grid', gridTemplateColumns: hero ? 'minmax(0,1.15fr) minmax(0,.85fr)' : '1fr', gap: 'clamp(18px,3vw,44px)', alignItems: 'center', height: '100%' }}>
      {/* LEFT — the narrative */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(14px,2.2vw,24px)', minWidth: 0 }}>
        <div>
          <div style={slideEyebrow}>Spying on your rivals</div>
          <h2 style={slideH}>Your rivals have a <span style={{ color: ORANGE }}>formula</span>.</h2>
        </div>
        <div style={{ display: 'flex', gap: 'clamp(14px,3vw,40px)', flexWrap: 'wrap' }}>
          <HeroStat n={winners.winnerCount} label="proven winners (90+ days live)" color={ORANGE} />
          {topDays > 0 && <HeroStat n={topDays} suffix=" days" label="longest still running" />}
        </div>
        {brands.length > 0 && (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: SUB, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 9 }}>Who you’re up against</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {brands.map((b, i) => (
                <span key={i} className="sf-rise" style={{ ...rise(i), fontSize: 'clamp(12px,1.4vw,14.5px)', fontWeight: 700, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 15px' }}>{b}</span>
              ))}
            </div>
          </div>
        )}
        <div><MediaBar media={winners.media} /></div>
      </div>
      {/* RIGHT — the featured winner + a filmstrip of runners-up */}
      {hero && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <FeaturedAdCard ex={hero} badge={`${hero.daysRunning}d running`} />
          <Filmstrip items={strip} />
        </div>
      )}
    </div>
  )
}

// SLIDE — the winning formula: synthesize the rivals' recipe into ONE big line (Hook × Angle × Format ×
// Promise), each part the #1 in that dimension. The "aha" theater beat between the rival grid and their DNA.
function slideFormula(winners: FullDnaResult['winners']) {
  const d = winners.dist as Record<string, Tally[]>
  const fmt = winners.media[0]
  const parts = ([
    ['Hook', d.hook_type?.[0]],
    ['Angle', d.angle?.[0]],
    ['Format', fmt ? { label: fmt.label, pct: fmt.pct } : d.format_style?.[0]],
    ['Promise', d.usp?.[0]],
  ] as [string, { label: string; pct: number } | undefined][]).filter(([, v]) => v && v.label)
  const lead = d.angle?.[0] || d.hook_type?.[0]
  // Plain-English gloss so a non-marketer gets it at a glance.
  const DIM_GLOSS: Record<string, string> = {
    Hook: 'the first line that stops the scroll',
    Angle: 'the reason they give you to buy',
    Format: 'the kind of ad they run most',
    Promise: 'what they promise you’ll get',
  }
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'clamp(16px,2.6vw,30px)', height: '100%' }}>
      <div>
        <div style={{ ...slideEyebrow, textAlign: 'center' }}>The winning formula</div>
        <h2 style={{ ...slideH, textAlign: 'center' }}>Their winners share <span style={{ color: ORANGE }}>one recipe</span>.</h2>
        <p style={{ ...sub, textAlign: 'center', margin: '8px auto 0', maxWidth: 560 }}>The pattern behind the ads that keep running — in plain words.</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', justifyContent: 'center', gap: 'clamp(8px,1.2vw,14px)' }}>
        {parts.map(([dim, v], i) => (
          <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,1.2vw,14px)' }}>
            {i > 0 && <span style={{ fontFamily: 'Fraunces,serif', fontSize: 'clamp(20px,3vw,34px)', color: MUT, fontWeight: 400 }}>×</span>}
            <div className="sf-rise" style={{ ...rise(i), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 'clamp(12px,1.8vw,20px) clamp(14px,2vw,24px)', minWidth: 'clamp(120px,15vw,180px)', maxWidth: 210, boxShadow: '0 10px 30px -18px rgba(26,20,16,.4)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, marginBottom: 3 }}>{dim}</div>
              <div style={{ fontSize: 10.5, color: MUT, marginBottom: 8, lineHeight: 1.3 }}>{DIM_GLOSS[dim] || ''}</div>
              <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(18px,2.4vw,28px)', color: INK, lineHeight: 1.05, letterSpacing: '-.01em' }}>{v!.label}</div>
              <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, fontWeight: 700, color: SUB, marginTop: 6 }}>{v!.pct}% of winners</div>
            </div>
          </div>
        ))}
      </div>
      {lead && (
        <p style={{ ...sub, textAlign: 'center', margin: '0 auto' }}>
          <b style={{ color: INK }}>{lead.pct}%</b> of their proven winners lead with the <b style={{ color: INK }}>{lead.label}</b> {d.angle?.[0] ? 'angle' : 'hook'}. That’s the pattern to beat.
        </p>
      )}
    </div>
  )
}

// SLIDE — you vs the winners, reframed as "the moves you're NOT making": a hero count of missing moves
// + per-dimension rows of the winners' proven tactics, with the ones you don't run flagged orange (⚡).
// 3 dims per slide (7 dims split across 2 slides); the missing count is over ALL dims, stable across both.
function slideVs(own: Record<string, Tally[]>, winners: Record<string, Tally[]>, chunk: number) {
  const all = PANELS.map(([k, label]) => ({ k, label, o: own[k] || [], w: winners[k] || [] })).filter((r) => r.w.length || r.o.length)
  const missingTotal = all.reduce((acc, { o, w }) => {
    const oSet = new Set(o.map((t) => t.label.toLowerCase()))
    return acc + w.slice(0, 6).filter((t) => !oSet.has(t.label.toLowerCase())).length
  }, 0)
  const rows = all.slice(chunk * 3, chunk * 3 + 3)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', flex: 'none' }}>
        <div>
          <div style={slideEyebrow}>You vs the winners</div>
          <h2 style={{ ...slideH, fontSize: 'clamp(24px,3.6vw,42px)' }}>The moves you’re <span style={{ color: ORANGE }}>not</span> making</h2>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(32px,5vw,54px)', color: ORANGE, lineHeight: .88, letterSpacing: '-.03em' }}><Count n={missingTotal} /></div>
          <div style={{ fontSize: 12.5, color: SUB, fontWeight: 600 }}>winning moves you’re missing</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 'clamp(10px,1.4vw,14px)' }}>
        {rows.map(({ k, label, o, w }, ri) => {
          const oSet = new Set(o.map((t) => t.label.toLowerCase()))
          return (
            <div key={k} className="sf-rise" style={{ ...rise(ri), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 'clamp(12px,1.6vw,18px) clamp(14px,1.8vw,22px)', display: 'grid', gridTemplateColumns: 'clamp(84px,10vw,120px) 1fr', gap: 'clamp(12px,1.6vw,20px)', alignItems: 'center' }}>
              <div style={{ fontSize: 'clamp(13px,1.6vw,17px)', fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>{label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {w.slice(0, 6).map((t, i) => {
                  const missing = !oSet.has(t.label.toLowerCase())
                  return (
                    <span key={i} style={{ ...pill(missing), display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'clamp(12px,1.4vw,14.5px)' }}>
                      {missing && <span style={{ fontSize: 11, lineHeight: 1 }}>⚡</span>}{t.label} <b style={{ color: missing ? '#fff' : SUB }}>{t.pct}%</b>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12.5, color: SUB, flex: 'none' }}>
        <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, background: ORANGE, marginRight: 7, verticalAlign: '-1px' }} />
        Orange ⚡ = a proven move the winners run that you don’t. Percentages = share of winners using it.
      </div>
    </>
  )
}

// The big centered score ring (mimics ScanSummary's gauge) — its own component so the draw animates.
function ScoreGauge({ total }: { total: number }) {
  const color = total < 40 ? '#c0281a' : total < 60 ? '#b7791f' : '#1e7a4f'
  const size = 220, r = 94, C = 2 * Math.PI * r
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 80); return () => clearTimeout(t) }, [])
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(26,20,16,.1)" strokeWidth="14" />
        <circle className="sf-gauge" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={drawn ? C * (1 - total / 100) : C} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(48px,8vw,64px)', color: INK, lineHeight: 1 }}><Count n={total} dur={1200} /></div>
        <div style={{ fontSize: 12, color: SUB, letterSpacing: '.1em' }}>OF 100</div>
      </div>
    </div>
  )
}

// SLIDE — the finale: big gauge on the left, the subscore breakdown as labelled bars on the right, so the
// number is earned, not asserted. Falls back to a centered gauge if we have no subscores to show.
function slideScore(res: ScanResult) {
  const s = res.score
  const color = s.total < 40 ? '#c0281a' : s.total < 60 ? '#b7791f' : '#1e7a4f'
  const subs = s.subscores.filter((x) => x.value != null).slice(0, 5)
  const left = (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={slideEyebrow}>Your ad-presence score</div>
      <ScoreGauge total={s.total} />
      <div style={{ display: 'inline-block', background: `${color}18`, color, fontWeight: 800, fontSize: 15, padding: '8px 18px', borderRadius: 100 }}>{s.band}</div>
    </div>
  )
  if (!subs.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {left}
        <p style={{ ...sub, margin: '0 auto', textAlign: 'center' }}>Your ad-presence score across coverage, format mix, angles and the tactics you’re missing.</p>
      </div>
    )
  }
  return (
    <div className="sf-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.85fr) minmax(0,1.15fr)', gap: 'clamp(20px,4vw,56px)', alignItems: 'center', height: '100%' }}>
      {left}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(10px,1.5vw,15px)', minWidth: 0 }}>
        <h2 style={{ ...slideH, fontSize: 'clamp(22px,3.2vw,36px)' }}>Where the <span style={{ color }}>{s.total}</span> comes from</h2>
        {subs.map((sc, i) => {
          const c = (sc.value as number) < 50 ? '#c0281a' : (sc.value as number) < 70 ? '#b7791f' : '#1e7a4f'
          return (
            <div key={sc.key} className="sf-rise" style={{ ...rise(i) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <span style={{ fontSize: 'clamp(13px,1.5vw,15px)', fontWeight: 700, color: INK }}>{sc.label}</span>
                <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 700, fontSize: 13, color: c }}>{sc.value}/100</span>
              </div>
              <div style={{ height: 9, borderRadius: 100, background: '#eee6d7', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${sc.value}%`, background: c, borderRadius: 100 }} />
              </div>
              {sc.note && <div style={{ fontSize: 12, color: SUB, marginTop: 4, lineHeight: 1.35 }}>{sc.note}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// SLIDE — waiting for the crawl (never a fake "invisible/0" — we're actively pulling the ads). Shows HONEST
// progress: an elapsed-driven bar + elapsed readout + copy that deepens, so a longer wait never looks frozen.
function pullingSlide(brandName: string, elapsedS = 0, capS = 480, liveAds: { thumb: string | null; isVideo?: boolean }[] = []) {
  const name = brandName === 'your brand' ? 'your brand' : brandName
  const withThumb = liveAds.filter((a) => a.thumb)
  const line = withThumb.length
    ? <>We pulled <b>{withThumb.length}</b> of {name}’s live ads instantly — the full library is finishing its deep crawl now for the complete breakdown.</>
    : elapsedS < 90
    ? <>First time we’ve seen {name} — we kicked off a <b>priority</b> crawl of your full ad library. This usually takes a few minutes.</>
    : elapsedS < 240
      ? <>Still going — we’re reading every ad {name} is running. First-time crawls take a few minutes; hang tight, your audit builds itself.</>
      : <>Almost there — deep libraries take a little longer. We’re finishing up {name}’s ads now.</>
  const barPct = Math.min(80, 12 + Math.round((elapsedS / Math.max(1, capS)) * 68))
  const elapsedLabel = elapsedS < 60 ? 'just started' : `~${Math.round(elapsedS / 60)} min so far`
  return (
    <div style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ fontSize: 'clamp(48px,9vw,84px)', lineHeight: 1 }}>⏳</div>
      <h2 style={slideH}>{withThumb.length ? 'Found your ads' : 'Pulling your ads now'}</h2>
      <p style={{ ...sub, textAlign: 'center', margin: '0 auto' }}>{line}</p>
      {withThumb.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(84px,1fr))', gap: 8, width: 'min(560px,88vw)' }}>
          {withThumb.slice(0, 12).map((a, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <div key={i} style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,.06)', position: 'relative' }}>
              <img src={a.thumb as string} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {a.isVideo && <span style={{ position: 'absolute', bottom: 4, right: 4, fontSize: 10 }}>▶</span>}
            </div>
          ))}
        </div>
      )}
      <div style={{ width: 'min(440px,82vw)' }}>
        <div style={{ height: 8, background: 'rgba(26,20,16,.1)', borderRadius: 100, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${barPct}%`, background: ORANGE, borderRadius: 100, transition: 'width .7s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, color: SUB }}>
          <span>Crawling your library…</span>
          <span>{elapsedLabel}</span>
        </div>
      </div>
    </div>
  )
}

// SLIDE — still crawling after the cap. Honest, no fake score.
function timeoutSlide(brandName: string) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ fontSize: 'clamp(44px,8vw,72px)', lineHeight: 1 }}>🐢</div>
      <h2 style={slideH}>Still pulling your ads</h2>
      <p style={{ ...sub, textAlign: 'center', margin: '0 auto' }}>We’ve been crawling for a few minutes and {brandName === 'your brand' ? 'your' : brandName + "’s"} library is a deep one — it’s still indexing. It’ll be ready shortly. Skip the wait — connect Meta and we’ll pull your complete ad account right now.</p>
      <div style={{ marginTop: 4 }}><MetaCta size="lg" align="center" label="Connect Meta — get your full audit now" note="Free to start. Or re-run the audit in a few minutes for the crawled breakdown." /></div>
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
            {/* BIG glanceable numbers first — read the headline without scrolling. */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '20px 0 6px' }}>
              {([['Total ads', own.totalAds, ''], ['Active now', own.activeAds, ''], ['Video', vid, '%']] as [string, number, string][]).map(([l, v, suf], i) => (
                <div key={l} className="sf-rise" style={{ ...rise(i), flex: '1 1 150px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '20px 24px' }}>
                  <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(40px,6.5vw,58px)', color: INK, lineHeight: .95, letterSpacing: '-.02em' }}><Count n={v} />{suf}</div>
                  <div style={{ fontSize: 13.5, color: SUB, marginTop: 6, fontWeight: 600 }}>{l}</div>
                </div>
              ))}
            </div>
            <MediaBar media={own.media} />
            {own.examples.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 10, margin: '22px 0 4px' }}>
                {own.examples.slice(0, 12).map((ex, i) => (
                  <div key={ex.adId} className="sf-rise" style={{ ...rise(Math.min(i, 10)), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ aspectRatio: '4 / 5', background: ex.thumb ? `#f1ece2 url(${ex.thumb}) center/cover` : '#eee6d7' }} />
                    <div style={{ padding: '7px 9px 9px', fontSize: 11, color: SUB, lineHeight: 1.3, maxHeight: 44, overflow: 'hidden' }}>{ex.format || ex.hook || '—'}</div>
                  </div>
                ))}
              </div>
            )}
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
  if (stage === 'rivals') {
    const rivalBrands = Array.from(new Set(winners.examples.map((e) => e.brand).filter(Boolean)))
    return (
    <div>
      <h2 style={h2}>What your rivals are <span style={{ color: ORANGE }}>winning</span> with</h2>
      <p style={sub}>Of {winners.sampleSize.toLocaleString()} rival ads, {winners.winnerCount.toLocaleString()} have run 90+ days — proven money-makers.</p>
      {/* WHO we're scanning — name the rivals + let them correct it. */}
      {rivalBrands.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 18px', margin: '18px 0 4px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 9 }}>Scanning your rivals</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {rivalBrands.slice(0, 8).map((b, i) => (
              <span key={i} className="sf-rise" style={{ ...rise(i), fontSize: 14, fontWeight: 700, color: INK, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 14px' }}>{b}</span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: SUB, marginTop: 12 }}>Not who you compete with? <b style={{ color: ORANGE }}>You can swap in your own competitors in the report ↓</b></div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 10, padding: '18px 0 8px' }}>
        {winners.examples.slice(0, 12).map((ex, i) => (
          <div key={ex.adId} className="sf-rise" style={{ ...rise(Math.min(i, 12)), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ aspectRatio: '4 / 5', background: ex.thumb ? `#f1ece2 url(${ex.thumb}) center/cover` : '#eee6d7' }} />
            <div style={{ padding: '7px 9px 9px' }}>
              <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 10.5, fontWeight: 700, color: ORANGE }}>{ex.daysRunning}d running</div>
              <div style={{ fontSize: 11, color: INK, lineHeight: 1.3, marginTop: 3, maxHeight: 44, overflow: 'hidden' }}>{ex.hook || ex.brand}</div>
            </div>
          </div>
        ))}
      </div>
      <MediaBar media={winners.media} />
      <DnaPanels dist={winners.dist as Record<string, Tally[]>} />
    </div>
    )
  }
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
              <div className={on && a.tier === 'starter' ? 'sf-glow' : undefined} style={{ height: 8, background: 'rgba(26,20,16,.08)', borderRadius: 100, overflow: 'hidden' }}>
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

function BuildingScreen({ res, onRerun }: { res: ScanResult; onRerun: () => void }) {
  const named = res.brand.name && res.brand.name !== 'your brand'
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={h2}>⏳ Building your audit…</h2>
      <p style={sub}>{named ? <><b style={{ color: INK }}>{res.brand.name}</b> isn&rsquo;t</> : 'Your brand isn&rsquo;t'} in our index yet — so we just kicked off a <b style={{ color: INK }}>priority crawl</b> of your ad library. This usually takes a few minutes.</p>
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '20px 22px', marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: SUB, marginBottom: 10 }}>What happens next</div>
        <ol style={{ margin: 0, paddingLeft: 18, color: '#4a4038', fontSize: 14.5, lineHeight: 1.8 }}>
          <li>We pull every ad on your page, plus your niche rivals.</li>
          <li>We decode the DNA — hooks, angles, personas, formats, offers.</li>
          <li>Re-run in a few minutes for your full audit, gaps &amp; score.</li>
        </ol>
        <button onClick={onRerun} style={{ ...btn, marginTop: 18 }}>↻ Re-run now</button>
      </div>
      <p style={{ color: MUT, fontSize: 13, marginTop: 14 }}>Tip: big brands are usually indexed already — try one to see a full audit instantly.</p>
    </div>
  )
}

function ScoreAct({ res, embedded }: { res: ScanResult; embedded?: boolean }) {
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
            <circle className="sf-gauge" cx="90" cy="90" r="78" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={drawn ? C * (1 - s.total / 100) : C} transform="rotate(-90 90 90)" />
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
              <span style={{ width: 52, textAlign: 'right', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, color: ss.value != null ? INK : MUT }}>{ss.value != null ? ss.value : 'n/a'}</span>
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
          {!embedded && <a href="/signup" style={{ display: 'inline-block', marginTop: 20, background: ORANGE, color: '#fff', borderRadius: 100, padding: '13px 28px', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Let Selfmade make these →</a>}
        </div>
      )}
    </div>
  )
}

// ── ACT 5 — "The fix" payoff: live free ads, scripted video, gated CTA + rival remake ──
type CreativeState = { status: 'loading' | 'ready' | 'error'; imageUrl?: string }
// Zero-cost ad TEMPLATE — a CSS mockup built from the brief + the brand's already-crawled product image.
// Replaces the per-brief Pro image render (gemini-3-pro-image 2K) that cost ~$1/card and looked off-brand.
// The finished, fully-rendered creatives are generated later in the account (with credits) — not here.
const TPL_THEMES = [
  { bg: 'linear-gradient(160deg,#f4efe1,#e6dcc6)', ink: '#22281b', accent: '#c8410f', sub: 'rgba(34,40,27,.62)' },
  { bg: 'linear-gradient(160deg,#1b2a1d,#0f150f)', ink: '#f4efe1', accent: '#ff9f7a', sub: 'rgba(244,239,225,.7)' },
  { bg: 'linear-gradient(160deg,#ff6a3d,#e5401a)', ink: '#fff', accent: '#ffe1d4', sub: 'rgba(255,255,255,.82)' },
  { bg: 'linear-gradient(160deg,#2a1c14,#3a2417)', ink: '#f7ecd9', accent: '#f2b48a', sub: 'rgba(247,236,217,.72)' },
  { bg: 'linear-gradient(160deg,#e9e1cf,#d8ccae)', ink: '#22281b', accent: '#c8410f', sub: 'rgba(34,40,27,.6)' },
]
function FixCard({ brief, thumb, i }: { brief: CreativeBrief; thumb?: string | null; i: number }) {
  const t = TPL_THEMES[i % TPL_THEMES.length]
  return (
    <div className="sf-rise" style={{ ...rise(i), background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ position: 'relative', aspectRatio: '4 / 5', background: t.bg, display: 'flex', flexDirection: 'column', padding: 'clamp(16px,2.4vw,22px)' }}>
        {/* honest badge — this is a layout template, not a finished render */}
        <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 9.5, fontWeight: 800, letterSpacing: '.18em', color: t.sub, border: `1px solid ${t.sub}`, borderRadius: 100, padding: '3px 9px' }}>TEMPLATE</span>
        <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: '.02em', color: t.sub }}>{brief.headline ? '' : ''}{/* brand */}</div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: t.sub, textTransform: 'uppercase', letterSpacing: '.06em' }}>Ad concept #{i + 1}</div>
        <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(20px,2.9vw,28px)', color: t.ink, lineHeight: 1.08, letterSpacing: '-.01em', marginTop: 8 }}>{brief.headline}</div>
        {brief.angle && <div style={{ fontSize: 13, color: t.sub, marginTop: 8, lineHeight: 1.4 }}>{brief.angle}</div>}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ background: t.accent, color: t.bg.includes('#fff') || i === 2 ? '#7a1e08' : '#fff', fontSize: 12.5, fontWeight: 800, borderRadius: 100, padding: '9px 16px', alignSelf: 'flex-end' }}>Shop Now →</span>
          {thumb && <div style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,.5)', flex: 'none', background: '#fff' }}><img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
        </div>
      </div>
      <div style={{ padding: '12px 14px 14px' }}>
        <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: '#c8410f', background: `${ORANGE}14`, border: `1px solid ${ORANGE}33`, borderRadius: 100, padding: '3px 10px' }}>Fills: {brief.gapLabel}</span>
        <div style={{ fontSize: 14, color: INK, fontWeight: 700, marginTop: 8, lineHeight: 1.35 }}>{brief.headline}</div>
      </div>
    </div>
  )
}
function TheFix({ res, embedded }: { res: ScanResult; embedded?: boolean }) {
  if (!res.briefs?.length) return null
  const briefs = res.briefs.slice(0, 5)
  // The brand's own best crawled ad image → the product thumb on the template cards.
  const ownThumb = res.own?.examples?.[0]?.thumb || null
  const rv = res.rivalVideo || null
  // If a rival has a proven VIDEO, we script a remake of THAT (and show it playing); else a fresh template.
  const script = rv ? remakeScript(rv, res.brand.name, res.brand.niche) : videoShotList(res.briefs[0], res.brand.name, res.brand.niche)
  const rival = res.rivalToRemake
  return (
    <div style={{ marginTop: 40 }}>
      {/* CSS layout-template cards — ONLY on the standalone /scan (logged-out). In the embedded store-audit
          the founder is logged in, so we render REAL ads (5 free + 5 on credits) in the audit page instead. */}
      {!embedded && <>
        <h2 style={h2}>The fix — 5 ad concepts <span style={{ color: ORANGE }}>built for you</span></h2>
        <p style={sub}>Templates from the winning DNA you&rsquo;re missing. Sign up and Mello renders them as finished ads with your product — plus 5 more of your choice.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(230px,100%),1fr))', gap: 16, marginTop: 22 }}>
          {briefs.map((b, i) => <FixCard key={b.key} brief={b} thumb={ownThumb} i={i} />)}
        </div>
      </>}

      {/* Rival-video remake: play their proven winner, script it beat-by-beat for the user's product */}
      <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 22, color: INK, margin: '34px 0 4px' }}>
        {rv ? <>Steal this winning video — <span style={{ color: ORANGE }}>remade as yours</span></> : <>Your {script.totalSeconds}-second video, scripted</>}
      </div>
      <p style={{ ...sub, fontSize: 15 }}>{rv ? `${rv.brand}'s video has run ${rv.daysRunning} days. Here's the same ${script.totalSeconds}s arc, shot for ${res.brand.name}.` : `${script.title} — beat by beat, ready to shoot.`}</p>

      <div style={{ display: 'grid', gridTemplateColumns: rv ? 'minmax(0, 260px) minmax(0, 1fr)' : '1fr', gap: 20, marginTop: 16, alignItems: 'start' }}>
        {rv && (
          <div style={{ background: '#000', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', position: 'sticky', top: 16 }}>
            <video src={rv.videoUrl} poster={rv.posterUrl || undefined} controls muted playsInline loop preload="metadata"
              style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', display: 'block', background: '#000' }} />
            <div style={{ padding: '10px 12px', background: DARK, color: CREAM }}>
              <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 11, fontWeight: 700, color: ORANGE }}>Their winner · {rv.daysRunning}d live</div>
              <div style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.35, maxHeight: 52, overflow: 'hidden' }}>{rv.hook || rv.brand}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {script.beats.map((beat, i) => (
            <div key={i} className="sf-rise" style={{ ...rise(i), display: 'flex', gap: 14, alignItems: 'baseline', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
              <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 12, fontWeight: 700, color: ORANGE, flex: 'none', minWidth: 78 }}>{beat.t}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: INK, fontWeight: 700, lineHeight: 1.35 }}>{beat.onScreen}</div>
                <div style={{ fontSize: 13, color: SUB, marginTop: 3, lineHeight: 1.45 }}>{beat.vo}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!embedded && (
        <div style={{ marginTop: 18 }}>
          <div aria-disabled style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(26,20,16,.14)', color: '#7c7266', borderRadius: 100, padding: '13px 28px', fontSize: 15, fontWeight: 800, cursor: 'not-allowed', userSelect: 'none' }}>
            <span>🎬 Generate this video →</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(26,20,16,.1)', borderRadius: 100, padding: '3px 10px' }}>Included in your trial</span>
          </div>
          <div style={{ fontSize: 12, color: MUT, marginTop: 8 }}>🔒 Unlocks when you start your trial.</div>
        </div>
      )}

      {/* Fallback image-remake teaser — only when there's no rival VIDEO to show above */}
      {!rv && rival && (
        <div style={{ marginTop: 36 }}>
          <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 22, color: INK, margin: '0 0 4px' }}>Your rival&rsquo;s best ad — <span style={{ color: ORANGE }}>remade as yours</span></div>
          <p style={{ ...sub, fontSize: 15 }}>Running {rival.daysRunning} days for {rival.brand}. Here&rsquo;s the same idea in your brand.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 16, marginTop: 16 }}>
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '1 / 1', background: `#f1ece2 ${rival.thumb ? `url(${rival.thumb}) center/cover` : ''}` }} />
              <div style={{ padding: '11px 14px 13px' }}>
                <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 11, fontWeight: 700, color: ORANGE }}>Their ad · {rival.daysRunning}d</div>
                <div style={{ fontSize: 13, color: INK, lineHeight: 1.35, marginTop: 3, maxHeight: 46, overflow: 'hidden' }}>{rival.hook || rival.brand}</div>
              </div>
            </div>
            {!embedded && (
              <div style={{ position: 'relative', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '1 / 1', background: rival.thumb ? `#f1ece2 url(${rival.thumb}) center/cover` : 'linear-gradient(135deg,#ff5a2e,#e02f06)', filter: 'blur(14px)', transform: 'scale(1.1)' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px 20px', background: 'rgba(28,22,17,.28)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>🔒</div>
                    <div style={{ fontSize: 13.5, color: '#fff', fontWeight: 800, lineHeight: 1.4, textShadow: '0 2px 10px rgba(0,0,0,.4)' }}>Start free trial to see it in your brand</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scan-complete SUMMARY — the click gate before the full report ──
function ScanSummary({ res, onUnlock }: { res: ScanResult; onUnlock: () => void }) {
  const s = res.score
  const color = s.total < 40 ? '#c0281a' : s.total < 60 ? '#b7791f' : '#1e7a4f'
  const C = 2 * Math.PI * 78
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 80); return () => clearTimeout(t) }, [])
  const lost = res.cost.lostPerYear
  const gaps = res.gaps.length
  const headline = lost <= 0
    ? `Here’s where your ads stand`
    : gaps > 0
      ? `Close ${gaps} gap${gaps === 1 ? '' : 's'} to add ~$${lost.toLocaleString()}/yr`
      : `~$${lost.toLocaleString()}/yr of upside left on the table`
  return (
    <div className="sf-rise" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center', padding: '10px 0 40px' }}>
      <div style={{ position: 'relative', width: 180, height: 180, margin: '0 auto 26px' }}>
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="78" fill="none" stroke="rgba(26,20,16,.1)" strokeWidth="12" />
          <circle className="sf-gauge" cx="90" cy="90" r="78" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={drawn ? C * (1 - s.total / 100) : C} transform="rotate(-90 90 90)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 46, color: INK, lineHeight: 1 }}><Count n={s.total} dur={1200} /></div>
          <div style={{ fontSize: 11, color: SUB, letterSpacing: '.1em' }}>OF 100</div>
        </div>
      </div>
      <div style={{ display: 'inline-block', background: `${color}18`, color, fontWeight: 800, fontSize: 13, padding: '6px 14px', borderRadius: 100, marginBottom: 18 }}>{s.band}</div>
      <h2 style={{ ...h2, margin: '0 0 12px' }}>{headline}</h2>
      <p style={{ ...sub, margin: '0 auto 26px', textAlign: 'center' }}>One score across your ads, your rivals, and the winning tactics you&rsquo;re missing.</p>
      <button onClick={onUnlock} style={{ ...btn, padding: '15px 32px', fontSize: 16 }}>Unlock your full report →</button>
    </div>
  )
}

// ── The FULL REPORT — everything stacked, scrollable, nothing hidden ──
// The REPORT is deliberately compact (Ryze-sized): the rich DNA panels + ad grids + side-by-side live in
// the THEATER (the reveal acts). Here we show only the distilled result — score, the gaps that matter, the
// upside (gated on connecting Meta), the fixes, and the door.
function FullReport({ res, onReaudit, embedded }: { res: ScanResult; own: FullDnaResult['own']; winners: FullDnaResult['winners']; onReaudit: (ids: string[]) => void; embedded?: boolean }) {
  return (
    <div>
      <ScoreAct res={res} embedded={embedded} />
      <div style={{ marginTop: 40 }}><TopGaps gaps={res.gaps} /></div>
      <div style={{ marginTop: 40 }}><CompetitorRefine pageId={res.brand.pageId} onReaudit={onReaudit} /></div>
      <div style={{ marginTop: 40 }}><UpsideTeaser cost={res.cost} gaps={res.gaps.length} embedded={embedded} /></div>
      <div style={{ marginTop: 40 }}><TheFix res={res} embedded={embedded} /></div>
      {/* embedded: the combined page owns ONE shared conversion CTA — suppress this standalone door. */}
      {!embedded && <div style={{ marginTop: 40 }}><ForwardCta brand={res.brand} /></div>}
    </div>
  )
}

// Let the user CORRECT their competitors — auto-matching is imperfect, so the surest path to an accurate
// audit is to name the rivals yourself. Adds brands (from the same directory search) → re-runs the audit.
function CompetitorRefine({ pageId, onReaudit }: { pageId: string; onReaudit: (ids: string[]) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Brand[]>([])
  const [picked, setPicked] = useState<{ pageId: string; name: string }[]>([])
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    if (deb.current) clearTimeout(deb.current)
    deb.current = setTimeout(() => {
      fetch(`/api/scan/brands?q=${encodeURIComponent(q.trim())}`).then((r) => r.json())
        .then((j) => setResults(Array.isArray(j.results) ? j.results.slice(0, 6) : [])).catch(() => setResults([]))
    }, 220)
  }, [q])
  const add = (b: Brand) => { if (b.pageId !== pageId && !picked.some((p) => p.pageId === b.pageId)) setPicked((s) => [...s, { pageId: b.pageId, name: b.name }]); setQ(''); setResults([]) }
  return (
    <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 18, padding: '24px 26px' }}>
      <h2 style={{ ...h2, fontSize: 'clamp(22px,3vw,28px)', margin: '0 0 6px' }}>These aren&rsquo;t your real rivals?</h2>
      <p style={{ ...sub, fontSize: 15 }}>We match competitors automatically — but you know yours best. Add them and we&rsquo;ll re-run the whole audit against the right brands.</p>
      <div style={{ position: 'relative', maxWidth: 460, marginTop: 16 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a competitor brand…"
          style={{ width: '100%', padding: '13px 16px', borderRadius: results.length ? '14px 14px 0 0' : 100, border: `1.5px solid ${LINE}`, fontSize: 15, background: '#fff', color: INK, outline: 'none' }} />
        {results.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1.5px solid ${LINE}`, borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden', zIndex: 5, boxShadow: '0 20px 40px -20px rgba(0,0,0,.3)' }}>
            {results.map((b) => (
              <button key={b.pageId} onClick={() => add(b)} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 15px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontWeight: 700, fontSize: 14.5, color: INK }}>{b.name}</span>
                <span style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontSize: 11.5, color: SUB }}>{b.adCount ? `${b.adCount.toLocaleString()} ads` : '+ add'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {picked.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {picked.map((p) => (
            <span key={p.pageId} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '6px 8px 6px 14px', fontSize: 13.5, fontWeight: 700, color: INK }}>
              {p.name}
              <button onClick={() => setPicked((s) => s.filter((x) => x.pageId !== p.pageId))} aria-label="Remove" style={{ border: 'none', background: 'rgba(26,20,16,.08)', borderRadius: 100, width: 20, height: 20, cursor: 'pointer', color: SUB, fontWeight: 800, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <button onClick={() => picked.length && onReaudit(picked.map((p) => p.pageId))} disabled={!picked.length}
        style={{ ...btn, marginTop: 16, padding: '13px 26px', opacity: picked.length ? 1 : .5, cursor: picked.length ? 'pointer' : 'not-allowed' }}>
        Re-audit against {picked.length || 'these'} competitor{picked.length === 1 ? '' : 's'} →
      </button>
    </div>
  )
}

// The winning moves you're not running — the distilled you-vs-winners, Ryze-style "N problems" list.
function TopGaps({ gaps }: { gaps: ScanResult['gaps'] }) {
  if (!gaps.length) return (
    <div>
      <h2 style={h2}>No gaps — you&rsquo;re running the winners&rsquo; playbook</h2>
      <p style={sub}>You already run the tactics winning brands rely on. The edge now is volume, velocity and creative quality.</p>
    </div>
  )
  return (
    <div>
      <h2 style={h2}>{gaps.length} winning move{gaps.length === 1 ? '' : 's'} you&rsquo;re <span style={{ color: ORANGE }}>not running</span></h2>
      <p style={sub}>The tactics proven rivals lean on that you don&rsquo;t — biggest first.</p>
      <div style={{ marginTop: 18 }}>
        {gaps.slice(0, 6).map((g, i) => (
          <div key={i} className="sf-rise" style={{ ...rise(i), display: 'flex', alignItems: 'center', gap: 14, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '13px 16px', marginBottom: 8 }}>
            <span style={{ color: ORANGE, fontWeight: 900, fontSize: 18, flex: 'none' }}>→</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{g.dimension}: {g.label}</div>
              <div style={{ fontSize: 13, color: SUB }}>{g.winnerPct}% of winners use it — you&rsquo;re at {g.yourPct}%.</div>
            </div>
            <span style={{ flex: 'none', fontSize: 11, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: '#0a7d4b', background: 'rgba(10,125,75,.1)', border: '1px solid rgba(10,125,75,.25)', borderRadius: 100, padding: '4px 11px' }}>Agent can make this</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The money — POSITIVE upside framing, and the REAL number is gated behind connecting Meta (we can't see
// spend/revenue from outside). Before connect: the potential-sales-lift teaser + the connect CTA.
function UpsideTeaser({ cost, gaps, embedded }: { cost: ScanResult['cost']; gaps: number; embedded?: boolean }) {
  const upside = cost.lostPerYear
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '26px 28px' }}>
      <h2 style={{ ...h2, margin: '0 0 6px' }}>How much could this add?</h2>
      <p style={{ ...sub, fontSize: 15.5 }}>Brands that close gaps like these typically lift ROAS <b style={{ color: INK }}>15–30%</b>. {gaps > 0 ? `On your volume, that's real money.` : `Volume and velocity are your next lever.`}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginTop: 18 }}>
        {upside > 0 && (
          <div style={{ flex: 'none' }}>
            <div style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(34px,6vw,52px)', color: '#0a7d4b', lineHeight: 1 }}>+$<Count n={upside} dur={1200} />/yr</div>
            <div style={{ fontSize: 12, color: MUT, marginTop: 4 }}>estimated potential — from your ad volume + benchmarks</div>
          </div>
        )}
        {!embedded && (
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <MetaCta size="lg" label="Connect Meta to see your real number" note="Sign up free, then connect Meta — we’ll replace this estimate with your true numbers: real revenue at risk and the exact lift from fixing it." />
          </div>
        )}
      </div>
    </div>
  )
}

// ── The forward door — real sign-up (Google/email). We stash the scanned brand so onboarding can pick
// up where the audit left off. Personal email is fine (the business-email gate is off). ──
function ForwardCta({ brand }: { brand: { name: string; pageId: string } }) {
  const go = () => { try { localStorage.setItem('sf_scan', JSON.stringify({ pageId: brand.pageId, name: brand.name, at: Date.now() })) } catch { /* private mode */ } }
  return (
    <div style={{ background: DARK, borderRadius: 20, padding: '34px 32px', color: CREAM }}>
      <h2 style={{ fontFamily: 'Fraunces,serif', fontWeight: 700, fontSize: 'clamp(26px,4vw,34px)', letterSpacing: '-.02em', lineHeight: 1.1, color: '#fff', margin: '0 0 10px' }}>Ready to run these?</h2>
      <p style={{ color: MUT, fontSize: 15.5, margin: '0 0 22px', maxWidth: 560, lineHeight: 1.5 }}>Start free — we&rsquo;ll generate these ads to your account and you approve every one before it launches.</p>
      <a href={`/signup?ref=scan&brand=${encodeURIComponent(brand.pageId)}`} onClick={go} style={{ ...btn, display: 'inline-block', textDecoration: 'none', padding: '15px 32px', fontSize: 16 }}>Start free → unlock your ads</a>
    </div>
  )
}

const h2: CSSProperties = { fontFamily: 'Fraunces,Georgia,serif', fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', letterSpacing: '-.02em', lineHeight: 1.05, color: INK, margin: '0 0 10px' }
const sub: CSSProperties = { color: SUB, fontSize: 17, maxWidth: 620, margin: 0, lineHeight: 1.5 }
const btn: CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }

// A small "connect / link" chain icon (white) — signals "connect your account" on the Meta CTA.
function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  )
}
// The highest-intent action in the funnel — bold, glowing, full-width pill so "Connect Meta" stands out
// wherever the scan hands the visitor over (the money section + the crawl-timeout dead-end).
function MetaCta({ label, note, size = 'md', align = 'left' }: { label?: string; note?: string; size?: 'md' | 'lg'; align?: 'left' | 'center' }) {
  const lg = size === 'lg'
  return (
    <div style={{ maxWidth: lg ? 480 : 440, margin: align === 'center' ? '0 auto' : undefined, width: '100%' }}>
      <a href="/signup?ref=scan-meta" className="sf-glow" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, width: '100%',
        background: ORANGE, color: '#fff', border: 'none', borderRadius: 100,
        padding: lg ? '17px 30px' : '15px 26px', fontSize: lg ? 17 : 15.5, fontWeight: 900,
        textDecoration: 'none', letterSpacing: '-.01em', boxShadow: '0 16px 38px -12px rgba(239,74,30,.62)',
      }}><LinkIcon /> {label || 'Connect Meta — see your real numbers'} →</a>
      {note && <p style={{ color: MUT, fontSize: 12.5, marginTop: 10, lineHeight: 1.5, textAlign: align }}>{note}</p>}
    </div>
  )
}
