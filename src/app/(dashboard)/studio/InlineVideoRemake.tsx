'use client'
/**
 * Inline video remake — the video-clone flow lives INSIDE the studio canvas now (no separate modal).
 * Same proven engine as CloneVideoModal (enqueue → free script → approve → render → poll), just the
 * few controls the founder actually needs: language, voice (by gender), a FREE script to approve, then
 * render. Product photo + brand come from the studio around it.
 *
 *   setup   → pick language + voice → "Write my free script" (free)
 *   review  → edit the script + pick length → "Create video · N cr" (spends on approve)
 *   done    → the video, download, make another
 */
import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Loader2, Film, Download, Wand2, Play } from 'lucide-react'
import { useCredits, confirmCredits, refreshCredits } from '@/components/credits/CreditCounter'
import Storyboard from '@/components/video/Storyboard'
// The Remotion editor is browser-only (@remotion/player) — load it client-side and show it INLINE the
// moment a video finishes, so editing (captions/CTA/logo/aspect) happens in the same window, no click.
const RemotionEditor = dynamic(() => import('@/components/video/RemotionEditor'), { ssr: false, loading: () => <div style={{ fontSize: 13, color: '#6f6d5a' }}>Loading the editor…</div> })

const FOREST = '#141d15', LIME = '#ff5a2c', INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', GREEN = '#ef4a1e'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── ONE-SHOT PROMPT PREVIEW — mirrors the exact prompt the worker (video-clone-worker.mjs, oneshot
// branch) sends to Seedance 2.5, so the founder SEES what the model receives before spending credits.
// Keep the two craft blocks below byte-identical to the worker's STYLE_LOCK / DIRECTOR_STYLE constants.
const OS_STYLE_LOCK = ' STYLE LOCK: full colour, bright natural lighting, one consistent realistic colour grade across the whole ad — never black-and-white, never a different mood or film look from the other scenes.'
const OS_DIRECTOR_STYLE = ' CINEMATIC DIRECTION: photorealistic, shot on a physical cine lens with natural motion blur — no 3D/CGI/game-engine look. A motivated camera move (a real reason to push or track). Natural motivated lighting with gentle atmospheric depth. Pore-level skin realism, catch-lights in living eyes, Hollywood micro-acting — micro-pauses, real breathing, precise eye-line, always reacting, never a static pose. Real gravity and weight, correct contact shadows. Smooth 24fps, sharp detail.'
function buildOneShotPreview(o: { secs: number; isService: boolean; productCount: number; script: string; langLabel: string; aspect?: string }): string {
  const aspect = o.aspect || '9:16'
  // Storyboard-first always yields an approved opening frame → it leads the refs as [Image1], so the
  // product photos start at [Image2]. (If no keyframe exists, the worker slides these down by one.)
  const prodFirst = 2
  const productRef = o.productCount ? `[Image${prodFirst}]${o.productCount > 1 ? `–[Image${prodFirst + o.productCount - 1}]` : ''}` : 'the product'
  const spoken = String(o.script || '').trim()
  let p = [
    `A polished ${o.secs}-second vertical ${aspect} social ad — ONE continuous piece, real people, authentic energy.`,
    o.isService
      ? 'This promotes a SERVICE / app — no physical product to hold; show a real person and, if provided, the app/screen, or a lifestyle moment.'
      : o.productCount ? `The product is ${productRef} — render it EXACTLY as the attached photo (same shape, cap/label, colours), at its true real-world size; get it big by moving the CAMERA close, never by enlarging it.` : '',
    '[Image1] is the approved opening frame — begin from it and keep its look and person.',
    spoken
      ? `The on-camera person speaks these EXACT words aloud, clearly lip-synced, in ${o.langLabel}: "${spoken.replace(/"/g, "'")}". Natural, confident delivery, real mouth movement in sync. Ambient sound only — NO background music.`
      : 'Ambient sound only, no music, no on-screen captions.',
  ].filter(Boolean).join(' ')
  p += OS_STYLE_LOCK + OS_DIRECTOR_STYLE
  return p
}

// ── UGC RECORDING BOOTH — UGC is one continuous selfie take, so there are no shots to strip. The
// honest, alive wait: a phone viewfinder RECORDING your creator, with your REAL approved script
// running as a karaoke teleprompter (the words they're speaking), a live waveform, a REC dot and a
// ticking timecode. True to what's rendering (a talking-head saying these exact words); reduced motion
// stops the animation but keeps the frame + full caption.
function UgcRecording({ script }: { script: string }) {
  const words = (script || '').trim().split(/\s+/).filter(Boolean)
  const [n, setN] = useState(0)      // words revealed
  const [sec, setSec] = useState(0)  // recording timecode
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(words.length); return }
    const w = setInterval(() => setN((x) => (x + 1 > words.length ? 0 : x + 1)), 360)   // ~natural speaking cadence, loops
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => { clearInterval(w); clearInterval(t) }
  }, [script])   // eslint-disable-line react-hooks/exhaustive-deps
  const mm = Math.floor(sec / 60), ss = String(sec % 60).padStart(2, '0')
  const shown = words.slice(Math.max(0, n - 14), n)   // a rolling teleprompter window
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, marginBottom: 4 }}>
      <style>{`@keyframes ugcrec{0%,100%{opacity:1}50%{opacity:.25}}@keyframes ugcwave{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}@media(prefers-reduced-motion:reduce){.ugc-rec,.ugc-wave span{animation:none!important}}`}</style>
      <div style={{ position: 'relative', width: 236, aspectRatio: '9 / 16', borderRadius: 22, overflow: 'hidden', background: 'radial-gradient(120% 80% at 50% 22%, #2a3b2e 0%, #141d16 60%, #0c120e 100%)', boxShadow: '0 24px 60px -22px rgba(14,27,18,.55), inset 0 0 0 1px rgba(255,90,44,.08)' }}>
        {/* REC + timecode */}
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, zIndex: 3 }}>
          <span className="ugc-rec" style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff4d4d', display: 'inline-block', boxShadow: '0 0 10px 1px rgba(255,77,77,.7)', animation: 'ugcrec 1.2s ease-in-out infinite' }} />
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', color: '#fff' }}>REC</span>
        </div>
        <div style={{ position: 'absolute', top: 12, right: 12, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.85)', fontVariantNumeric: 'tabular-nums', zIndex: 3, fontFamily: 'ui-monospace, Menlo, monospace' }}>{mm}:{ss}</div>
        {/* the creator — a soft on-camera silhouette (identity is what's rendering; this is the viewfinder) */}
        <div style={{ position: 'absolute', left: '50%', top: '30%', transform: 'translateX(-50%)', width: 84, height: 84, borderRadius: '50%', background: 'linear-gradient(#e9efe2,#c3d0b6)', opacity: .5 }} />
        <div style={{ position: 'absolute', left: '50%', top: '52%', transform: 'translateX(-50%)', width: 150, height: 120, borderRadius: '50% 50% 0 0', background: 'linear-gradient(#e9efe2,#c3d0b6)', opacity: .45 }} />
        {/* teleprompter — the REAL script, karaoke reveal */}
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 46, zIndex: 3 }}>
          <div style={{ background: 'rgba(10,15,11,.55)', borderRadius: 10, padding: '9px 11px', backdropFilter: 'blur(3px)' }}>
            <div style={{ fontSize: 13, lineHeight: 1.5, fontWeight: 700, color: 'rgba(255,255,255,.55)', letterSpacing: '-.01em', minHeight: 38 }}>
              {shown.map((w, i) => {
                const isLast = i === shown.length - 1
                return <span key={n - shown.length + i} style={{ color: isLast ? '#ff5a2c' : 'rgba(255,255,255,.85)', transition: 'color .2s' }}>{w} </span>
              })}
              {words.length > 0 && <span style={{ display: 'inline-block', width: 2, height: 14, background: '#ff5a2c', verticalAlign: '-2px' }} />}
            </div>
          </div>
        </div>
        {/* live waveform */}
        <div className="ugc-wave" style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'center', height: 20, zIndex: 3 }}>
          {[0, .12, .28, .05, .34, .18, .4, .1, .3, .22, .38, .08, .26, .15].map((d, i) => (
            <span key={i} style={{ width: 3, height: 18, borderRadius: 3, background: '#ff5a2c', opacity: .85, transformOrigin: 'center', animation: `ugcwave ${0.7 + (i % 4) * 0.12}s ease-in-out ${d}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── RENDER FILMSTRIP — "Mello is filming your ad, shot by shot." The approved storyboard keyframes sit
// in a strip; as each scene actually renders, its cell lights up (done ✓ / now filming / up next),
// driven by the worker's real "scene X of N" progress. Honest — it mirrors the actual render, not a
// decorative loop. Falls back to nothing (caller keeps the plain bar) if we can't load the keyframes.
function RenderFilmstrip({ jobId, progress }: { jobId: string; progress: { label?: string; pct?: number } | null }) {
  const [frames, setFrames] = useState<(string | null)[]>([])
  useEffect(() => {
    let live = true
    fetch(`/api/discovery/clone-video/storyboard?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(b => { if (live && b?.scenes?.length) setFrames(b.scenes.map((s: any) => s.preview || s.thumb || null)) })
      .catch(() => {})
    return () => { live = false }
  }, [jobId])
  // Only show the strip when the render is genuinely shot-by-shot: a cinematic 'scene X of N' progress
  // label, OR we actually have scene keyframes. UGC is ONE continuous take ('Filming your video…', no
  // keyframes) — a filmstrip there would imply discrete shots that don't exist, so it keeps the plain
  // bar (UGC untouched, and honest).
  const m = /scene\s*(\d+)\s*of\s*(\d+)/i.exec(progress?.label || '')
  const hasFrames = frames.some(Boolean)
  if (!m && !hasFrames) return null
  const total = m ? Math.max(Number(m[2]), frames.length) : frames.length
  if (total < 2) return null
  const cur = m ? Number(m[1]) : Math.max(1, Math.ceil(((progress?.pct || 8) / 100) * total))
  const cells = Array.from({ length: total }, (_, i) => frames[i] || null)
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 4, flexWrap: 'wrap' }}>
      <style>{`@keyframes vfilm{0%,100%{box-shadow:0 0 0 0 rgba(63,143,79,.5)}50%{box-shadow:0 0 0 4px rgba(63,143,79,0)}}@media(prefers-reduced-motion:reduce){.vfilm-active{animation:none!important}}`}</style>
      {cells.map((src, i) => {
        const done = i + 1 < cur, active = i + 1 === cur
        return (
          <div key={i} className={active ? 'vfilm-active' : undefined} style={{ position: 'relative', width: 52, height: 66, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#0d120e', border: active ? `2px solid ${GREEN}` : `1px solid ${LINE}`, opacity: done ? 1 : active ? 1 : 0.45, transition: 'opacity .4s ease, border-color .4s ease', animation: active ? 'vfilm 2.2s ease-in-out infinite' : undefined }}>
            {src
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: done ? 'none' : active ? 'none' : 'grayscale(.5)' }} />
              : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#5d675c', fontSize: 13, fontWeight: 700 }}>{i + 1}</div>}
            {done && <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,29,21,.55)', display: 'grid', placeItems: 'center', color: LIME, fontSize: 15, fontWeight: 900 }}>✓</div>}
            {active && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#ef4a1e', color: '#fff', fontSize: 8, fontWeight: 800, letterSpacing: '.04em', textAlign: 'center', padding: '2px 0' }}>FILMING</div>}
          </div>
        )
      })}
    </div>
  )
}
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }
const field: React.CSSProperties = { border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 13px', fontSize: 13.5, color: INK, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', appearance: 'auto' as any }

// Same languages the modal transcreates into.
const LANGS = [
  { code: 'en', label: 'English' }, { code: 'ur', label: 'اردو Urdu' }, { code: 'hi', label: 'हिन्दी Hindi' },
  { code: 'ar', label: 'العربية Arabic' }, { code: 'es', label: 'Español' }, { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
]
// OpenAI TTS voices, framed by the gender the founder actually asks for.
const VOICES = [
  { id: 'nova', label: 'Female · warm' }, { id: 'shimmer', label: 'Female · bright' },
  { id: 'onyx', label: 'Male · deep' }, { id: 'echo', label: 'Male · calm' }, { id: 'alloy', label: 'Neutral' },
]

export default function InlineVideoRemake({ sourceAdId, sourceVideoUrl, sourcePoster, brandId, brandType, productImages, brandName, onDone }: {
  sourceAdId: string; sourceVideoUrl?: string | null; sourcePoster?: string | null; brandId?: string | null; brandType?: string; productImages: string[]; brandName?: string | null; onDone?: () => void
}) {
  const { balance } = useCredits()
  const [phase, setPhase] = useState<'setup' | 'scripting' | 'review' | 'rendering' | 'done'>('setup')
  const [style, setStyle] = useState<'ugc' | 'cinematic' | 'oneshot'>('oneshot')   // One-shot = the reliable default (one Seedance 2.5 gen)
  const [language, setLanguage] = useState('en')
  const [voice, setVoice] = useState('nova')
  // Parity with the old video modal — these feed the analysis/generation, so keep collecting them.
  const [productName, setProductName] = useState('')
  const [benefit, setBenefit] = useState('')
  const [look, setLook] = useState('match')   // recast the on-camera person (default: keep original)
  const [jobId, setJobId] = useState<string | null>(null)
  // Cinematic is LIVE (2026-08-17): Higgsfield-method asset-lock now wired — product sheet, hero
  // character sheet (single-face body trick), per-location plates locking the colour grade, shot-list
  // director prompts on Seedance 2.5, and self-heal via 2.5-Edit. Both styles ship publicly.
  const [cineOn, setCineOn] = useState(true)
  const [styleTouched, setStyleTouched] = useState(false)   // did the user manually pick a mode? (else auto-pick from analysis)
  const [srcScenes, setSrcScenes] = useState(3)   // analyzed scene count, used for cinematic cost + approve
  const [sbScenes, setSbScenes] = useState(0)     // scenes the founder KEPT in the embedded storyboard
  const [shotList, setShotList] = useState<{ t: string; secs?: number; action: string; lens?: string; shows?: string; line?: string }[]>([])   // one-shot timestamped scene list (from the beat sheet)
  const [removedShots, setRemovedShots] = useState<Set<number>>(new Set())   // scenes the founder cut from the one-shot shot list
  useEffect(() => { try { if (new URLSearchParams(window.location.search).get('cinematic') === '1') setCineOn(true) } catch {} }, [])   // admin backdoor while parked
  const [script, setScript] = useState('')
  const [srcSecs, setSrcSecs] = useState<number | null>(null)
  const [bucket, setBucket] = useState<'15' | '30' | '60' | 'match'>('15')
  const bucketTouched = useRef(false)   // did the user pick a length? (else auto-default to match the source)
  const [progress, setProgress] = useState<{ label?: string; pct?: number; eta_sec?: number } | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rescripting, setRescripting] = useState(false)

  // Product type is inherited from the selected brand, but a per-video override chip lets the founder
  // correct a mis-typed brand without leaving the flow (physical / app / service).
  const [typeOverride, setTypeOverride] = useState<string | undefined>(undefined)
  const effType = typeOverride || brandType || 'physical'
  const isService = effType === 'service' || effType === 'app'   // app OR service = no physical product to render
  // "Match theirs" targets the ACTUAL source length (clamped 8–60s), not a snapped 15/30/60 bucket —
  // so a ~20s ad clones at ~20s instead of collapsing to 15s and race-reading the script.
  const resolvedBucket = bucket === 'match' ? Math.max(8, Math.min(60, Math.round(srcSecs || 15))) : Number(bucket)
  const nSegs = resolvedBucket >= 60 ? 4 : resolvedBucket >= 30 ? 2 : 1
  // Cinematic is priced per scene (video_clone_xN); UGC per 15s clip. Actual charge is server-side.
  // Cinematic: the CHOSEN length drives the scene count (~1 scene per 3s — 15s → 5, 30s → 10, 60s → 16),
  // capped by what the source actually has. This is what the user pays for and what renders.
  const cineScenes = Math.max(2, Math.min(sbScenes || srcScenes || 2, Math.floor(resolvedBucket / 3), 16))
  const cost = style === 'cinematic' ? 600 * cineScenes : style === 'oneshot' ? (resolvedBucket > 22 ? 1200 : 600) : (nSegs > 1 ? 600 * nSegs : 600)

  // Speaking-time meter — same per-language rates as the old modal. Longer than the target = talks fast.
  const RATE: Record<string, number> = { en: 2.3, ur: 2.0, hi: 2.1, ar: 1.8, es: 2.6, fr: 2.4, de: 2.2 }
  const words = script.trim() ? script.trim().split(/\s+/).length : 0
  const spokenSecs = words ? Math.round(words / (RATE[language] || 2.3)) : 0
  const overLength = spokenSecs > 0 && spokenSecs > resolvedBucket + 2   // script won't fit the chosen length

  // Bumped whenever the script is re-paced, so the embedded storyboard re-splits its scenes to the
  // NEW script (otherwise picking 30s would re-pace the render but leave the storyboard showing the old
  // lines). The value is the new script; the tick forces the storyboard's re-split effect to run.
  const [rescriptTick, setRescriptTick] = useState(0)

  // Pick a length → re-pace the script to fill/trim to that many seconds (free, like the old modal).
  async function pickLength(b: '15' | '30' | '60' | 'match') {
    bucketTouched.current = true
    setBucket(b)
    if (!script.trim() || rescripting) return
    const target = b === 'match' ? ((srcSecs || 15) <= 22 ? 15 : (srcSecs || 15) <= 45 ? 30 : 60) : Number(b)
    setRescripting(true)
    try {
      const r = await fetch('/api/discovery/clone-video/rescript', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ script, targetSecs: target, language }),
      }).then(x => x.json())
      if (r.script) { setScript(r.script); setRescriptTick(t => t + 1) }   // re-pace render AND storyboard
    } catch { /* keep current script */ } finally { setRescripting(false) }
  }

  const pollUntil = async (id: string, leave: string, maxMs = 800_000): Promise<any> => {
    const iters = Math.ceil(maxMs / 4000)
    for (let i = 0; i < iters; i++) {
      await sleep(4000)
      const st = await fetch(`/api/discovery/clone-video/status?id=${id}`).then(r => r.json()).catch(() => ({}))
      if (st.progress) setProgress(st.progress)
      if (st.error) return { error: st.error }
      if (st.status && st.status !== leave) return st
    }
    return { timedOut: true }
  }

  async function writeScript() {
    setErr(null)
    if (!productImages.length && !isService) { setErr('Pick a product photo on the right first (analyze your site or upload).'); return }
    setPhase('scripting')
    try {
      const start = await fetch('/api/discovery/clone-video', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceAdId, sourceVideoUrl: sourceVideoUrl || undefined, brandId: brandId || undefined, productImages, tier: 'premium', productType: effType, language, voice,
          characterLook: look !== 'match' ? look : undefined,
          productDetails: { name: productName.trim() || undefined, benefit: benefit.trim() || undefined } }),
      }).then(r => r.json())
      if (!start.jobId) { setErr(start.error === 'insufficient_credits' ? 'Not enough credits.' : (start.error || 'Couldn’t start the script.')); setPhase('setup'); return }
      setJobId(start.jobId)
      const st = await pollUntil(start.jobId, 'analyzing', 400_000)
      if (st.timedOut) { setErr('The script is taking longer than usual — try again in a moment.'); setPhase('setup'); return }
      if (st.error) { setErr(st.error); setPhase('setup'); return }
      let drafted = st.script || ''
      setShotList(Array.isArray(st.shotList) ? st.shotList : [])   // the timestamped scene decode for one-shot
      const srcS = Number(st.sourceSeconds) || null
      setSrcSecs(srcS)
      setSrcScenes(Math.max(2, Math.min(10, Number(st.sceneCount) || 3)))
      // One-shot is the default (one reliable Seedance 2.5 gen). We NO LONGER auto-switch to UGC/Cinematic
      // from the analysis — the user opts into those explicitly. (Keeps the dependable path as the default.)
      // AUTO-LENGTH: default to "Match theirs" so a 51s ad clones at ~51s, not a hardcoded 15s (which
      // race-read a 61s script). The user can still override; once they do, bucketTouched locks their pick.
      if (!bucketTouched.current) setBucket('match')
      // The drafted script is often paced to the source's slow rate → one short line. Auto-fill it to the
      // resolved length (the source-matched bucket, NOT a hardcoded 15s) so the review shows a full script.
      try {
        const target = srcS ? Math.max(8, Math.min(60, Math.round(srcS))) : 15
        const wc = drafted.trim() ? drafted.trim().split(/\s+/).length : 0
        if (wc && wc < target * (RATE[language] || 2.3) * 0.75) {
          const r = await fetch('/api/discovery/clone-video/rescript', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ script: drafted, targetSecs: target, language }),
          }).then(x => x.json())
          if (r?.script) drafted = r.script
        }
      } catch { /* keep the drafted script */ }
      setScript(drafted)
      setPhase('review')
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('setup') }
  }

  async function render() {
    if (!jobId) return
    if (!confirmCredits('remake this video', cost, balance)) return
    setErr(null); setProgress(null); setPhase('rendering')
    try {
      const cinematic = style === 'cinematic'
      const apiMode = style === 'cinematic' ? 'faithful' : style === 'oneshot' ? 'oneshot' : 'ugc'
      const ap = await fetch('/api/discovery/clone-video/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, script, mode: apiMode, durationBucket: bucket, sceneCount: cinematic ? cineScenes : nSegs, overlays: [], extraLangs: [], endCard: null, hookVariants: false,
          // One-shot: the shots the founder KEPT (indices into the shot list). Worker filters the beat
          // sheet to these, so removing scenes actually reaches Seedance. Omitted = keep all.
          keepShots: apiMode === 'oneshot' && removedShots.size ? shotList.map((_, i) => i).filter(i => !removedShots.has(i)) : undefined }),
      }).then(r => r.json())
      if (ap.error) { setErr(ap.error === 'insufficient_credits' ? 'Not enough credits.' : ap.error); setPhase('review'); return }
      refreshCredits()
      const st = await pollUntil(jobId, 'processing', (cinematic || nSegs > 1) ? 1_680_000 : 800_000)
      if (st.timedOut) { setErr('Still rendering — multi-scene videos take a bit longer. It’ll appear in My Creatives when it’s ready (credits reserved, auto-refunded if it fails).'); setPhase('review'); return }
      if (st.error || !st.url) { setErr((st.error || 'The render failed') + ' — credits were refunded.'); setPhase('review'); refreshCredits(); return }
      setVideoUrl(st.url); setPhase('done'); onDone?.()
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('review') }
  }

  const pillRow: React.CSSProperties = { display: 'inline-flex', background: '#eef2ec', borderRadius: 100, padding: 3, flexWrap: 'wrap' }
  const pill = (on: boolean): React.CSSProperties => ({ border: 'none', borderRadius: 100, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', background: on ? '#fff' : 'transparent', color: on ? INK : MUTED, fontFamily: 'inherit' })

  return (
    <div style={{ marginTop: 20 }}>
      {/* SETUP — style, language + voice, then the free script */}
      {phase === 'setup' && (
        <div>
          {/* Product-type chip — shows what this brand is (drives whether we render a physical product,
              an app screen-demo, or a service talking-head). Inherited from the brand; overridable here
              per-video if the brand was mis-typed. */}
          <div style={{ marginBottom: 16 }}>
            <div style={label}>This brand is</div>
            <div style={pillRow}>
              {([['physical', '🧴 Physical product'], ['app', '📱 App / website'], ['service', '🛠️ Service']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTypeOverride(k)} style={pill(effType === k)}>{l}</button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
              {effType === 'physical' ? 'We composite your real product photos into the ad.' : effType === 'app' ? 'No physical product — we show the app/screen demo instead.' : 'No physical product — the creator talks about the service.'}
              {typeOverride && typeOverride !== brandType ? ' (overridden for this video)' : ''}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={label}>Style</div>
            <div style={pillRow}>
              <button onClick={() => { setStyle('oneshot'); setStyleTouched(true) }} style={pill(style === 'oneshot')}>One-shot ✦</button>
              <button onClick={() => { setStyle('ugc'); setStyleTouched(true) }} style={pill(style === 'ugc')}>UGC</button>
              <button onClick={() => { setStyle('cinematic'); setStyleTouched(true) }} style={pill(style === 'cinematic')}>Cinematic</button>
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{style === 'oneshot' ? 'One-shot — a single Seedance 2.5 take of the whole ad (up to 30s), native audio. The most reliable — recommended.' : style === 'cinematic' ? 'Cinematic — scene-by-scene multi-cut clone, stitched. Most ambitious, more variable.' : 'UGC — one talking creator, stitched segments.'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div><div style={label}>Language</div>
              <select value={language} onChange={e => setLanguage(e.target.value)} style={field}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
            </div>
            <div><div style={label}>Voice</div>
              <select value={voice} onChange={e => setVoice(e.target.value)} style={field}>{VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
            </div>
          </div>

          {/* Product details — same grounding the old modal collected (name + one benefit). */}
          {!isService && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div><div style={label}>Product name <span style={{ color: '#aab0a6', fontWeight: 600 }}>· optional</span></div>
                <input value={productName} onChange={e => setProductName(e.target.value)} placeholder={brandName || 'e.g. Hair ResQ Serum'} style={field} />
              </div>
              <div><div style={label}>Key benefit <span style={{ color: '#aab0a6', fontWeight: 600 }}>· optional</span></div>
                <input value={benefit} onChange={e => setBenefit(e.target.value)} placeholder="e.g. thicker hair in 8 weeks" style={field} />
              </div>
            </div>
          )}

          {/* Recast the on-camera person — parity with the old modal's look picker. */}
          <div style={{ marginBottom: 18 }}>
            <div style={label}>If the ad shows a person</div>
            <div style={{ fontSize: 11.5, color: MUTED, margin: '2px 0 8px' }}>Recast them for your audience — or keep the original.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {['match', 'Pakistani', 'Indian', 'Arab', 'East Asian', 'Black', 'White', 'Hispanic'].map(l => (
                <button key={l} onClick={() => setLook(l)} style={{ border: `1.5px solid ${look === l ? GREEN : '#e2e8f0'}`, background: look === l ? '#f2f8ea' : '#fff', color: look === l ? INK : MUTED, borderRadius: 100, padding: '7px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{l === 'match' ? 'Keep original' : l}</button>
              ))}
            </div>
          </div>

          <button onClick={writeScript} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 24px', fontSize: 14.5, fontWeight: 850, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Wand2 size={16} /> Write my free script
          </button>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>Free — you only spend credits after you approve the script.</div>
        </div>
      )}

      {/* SCRIPTING — free analyse */}
      {phase === 'scripting' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: MUTED, fontSize: 14, fontWeight: 600 }}>
          <Loader2 size={18} className="spin" color={GREEN} /> Writing your script from their winning ad… (free)
        </div>
      )}

      {/* REVIEW — edit script + length, then render */}
      {phase === 'review' && (
        <div>
          {/* ONE-SHOT: no per-scene storyboard (Seedance films the whole ad in one take from the
              timestamped shot list). Show that shot list as the "script" — the exact scene-by-scene
              timeline the ad will move through — plus the editable voiceover below. UGC/Cinematic keep
              the storyboard, where approving each keyframe actually feeds the render. */}
          {style === 'oneshot' ? (
            <>
              {look !== 'match' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#f2f8ea', border: `1px solid ${GREEN}`, borderRadius: 100, padding: '5px 12px', fontSize: 12, fontWeight: 800, color: INK, marginBottom: 10 }}>
                  🎭 Recasting the presenter as {look} <span style={{ color: MUTED, fontWeight: 600 }}>· same scenes, new person</span>
                </div>
              )}
              <div style={label}>Shot list <span style={{ color: '#aab0a6', fontWeight: 600 }}>· the scenes your ad moves through{shotList.length ? ` · ${shotList.length - removedShots.size} of ${shotList.length} kept` : ''}{srcSecs ? ` · ~${resolvedBucket}s` : ''}</span></div>
              {shotList.length > 0 ? (<>
                <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', background: '#fbfaf7', marginBottom: 6 }}>
                  {shotList.map((s, i) => {
                    const cut = removedShots.has(i)
                    return (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 13px', borderTop: i ? `1px solid ${LINE}` : 'none', alignItems: 'baseline', opacity: cut ? 0.4 : 1 }}>
                        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, fontWeight: 700, color: GREEN, whiteSpace: 'nowrap', minWidth: 62, textDecoration: cut ? 'line-through' : 'none' }}>{s.t}</span>
                        <span style={{ flex: 1, fontSize: 13, color: '#33372f', lineHeight: 1.5, textDecoration: cut ? 'line-through' : 'none' }}>{s.action}{s.lens ? <span style={{ color: '#9aa79a' }}> · {s.lens}</span> : null}{s.shows ? <span style={{ color: GREEN, fontWeight: 700 }}> · shows {s.shows}</span> : null}</span>
                        <button onClick={() => setRemovedShots(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })}
                          style={{ background: 'none', border: 'none', color: cut ? GREEN : '#c0392b', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, padding: 0 }}>{cut ? 'Undo' : 'Remove'}</button>
                      </div>
                    )
                  })}
                </div>
                {(() => {
                  const keptSecs = shotList.reduce((a, s, i) => a + (removedShots.has(i) ? 0 : (s.secs || 0)), 0)
                  const renderSecs = Math.min(removedShots.size ? keptSecs : resolvedBucket, resolvedBucket, 30)
                  const over = keptSecs > 30
                  return (
                    <div style={{ fontSize: 12, marginBottom: 6, color: over ? '#a16207' : MUTED }}>
                      Kept scenes ≈ <b style={{ color: over ? '#a16207' : INK }}>{keptSecs}s</b> · renders at <b style={{ color: INK }}>~{renderSecs}s</b>
                      {over ? ' — still over Seedance’s 30s max, so it’ll compress. Remove a few to hit exactly 30s.' : ' — remove scenes to shorten; the kept ones set the length (like trimming the script).'}
                    </div>
                  )
                })()}
              </>) : (
                <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 8, padding: '10px 13px', border: `1px dashed ${LINE}`, borderRadius: 12 }}>One continuous take — Seedance films the whole ad from your script below.</div>
              )}
              <div style={{ ...label, marginTop: 14 }}>Voiceover script <span style={{ color: '#aab0a6', fontWeight: 600 }}>· edit the words — spoken across the ad{spokenSecs ? ` · ~${spokenSecs}s` : ''}</span></div>
              <textarea value={script} onChange={e => setScript(e.target.value)} rows={6} style={{ ...field, resize: 'vertical', lineHeight: 1.6, minHeight: 130 }} />
            </>
          ) : (<>
            {/* STORYBOARD-FIRST for UGC/Cinematic — each approved keyframe feeds the render. */}
            <div style={label}>Your storyboard <span style={{ color: '#aab0a6', fontWeight: 600 }}>· preview every scene, regenerate or upload your own frame, edit the line — free{spokenSecs ? ` · ~${spokenSecs}s of speech` : ''}</span></div>
            {jobId
              ? <Storyboard jobId={jobId} embedded mode={style === 'cinematic' ? 'cinematic' : 'ugc'} maxScenes={Math.max(2, Math.min(16, Math.floor(resolvedBucket / 3)))} resyncScript={script} resyncKey={rescriptTick} onScript={setScript} onSceneCount={setSbScenes} />
              : <textarea value={script} onChange={e => setScript(e.target.value)} rows={7} style={{ ...field, resize: 'vertical', lineHeight: 1.6, minHeight: 150 }} />}
          </>)}
          {/* ONE-SHOT: show the EXACT prompt Seedance 2.5 will receive (live from the script above),
              read-only, so the founder can eyeball-tune before spending credits. Nothing to configure —
              the script + your product photos are the levers; this is transparency, not an input. */}
          {style === 'oneshot' && (
            <details style={{ marginTop: 14, border: `1px solid ${LINE}`, borderRadius: 12, background: '#fafaf7', overflow: 'hidden' }}>
              <summary style={{ cursor: 'pointer', padding: '11px 14px', fontSize: 12.5, fontWeight: 800, color: INK, listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wand2 size={14} color={GREEN} /> What Seedance 2.5 receives
                <span style={{ color: '#aab0a6', fontWeight: 600 }}>· the exact prompt + {productImages.length + 1} reference image{productImages.length ? 's' : ''} — updates as you edit the script</span>
              </summary>
              <div style={{ padding: '0 14px 14px' }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.65, color: '#33372f', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, monospace', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 13px' }}>
                  {buildOneShotPreview({ secs: resolvedBucket, isService, productCount: productImages.length, script, langLabel: (LANGS.find(l => l.code === language)?.label || 'English').split(' ')[0] })}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>
                  <b>[Image1]</b> = your approved opening frame · <b>[Image2…]</b> = your product photos. Edit the script above to change the spoken line; swap frames/photos to change what it shows.
                </div>
              </div>
            </details>
          )}
          <div style={{ margin: '16px 0' }}>
            <div style={label}>
              Length {srcSecs ? <span style={{ color: '#aab0a6', fontWeight: 600 }}>· their ad runs ~{Math.round(srcSecs)}s</span> : null}
              {rescripting && <span style={{ color: GREEN, fontWeight: 700, marginLeft: 6 }}>· re-pacing the script…</span>}
            </div>
            <div style={pillRow}>
              {(['15', '30', '60', 'match'] as const).map(b => <button key={b} disabled={rescripting} onClick={() => pickLength(b)} style={{ ...pill(bucket === b), cursor: rescripting ? 'default' : 'pointer', opacity: rescripting && bucket !== b ? 0.6 : 1 }}>{b === 'match' ? `Match theirs${srcSecs ? ` (~${Math.round(srcSecs)}s)` : ''}` : `${b}s`}</button>)}
            </div>
            {/* warn when the script is longer than the chosen length — it'd be spoken too fast */}
            {overLength && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#7a5a12', background: '#fff8e6', border: '1px solid #f2e2ad', borderRadius: 10, padding: '8px 12px', maxWidth: 460 }}>
                Your script is about <b>{spokenSecs}s</b> but you picked <b>{resolvedBucket}s</b> — it’ll be read fast. Pick a longer length (I’ll re-pace it), or trim the script.
              </div>
            )}
          </div>
          <button onClick={render} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 24px', fontSize: 14.5, fontWeight: 850, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Film size={16} /> Create video · {cost} credits
          </button>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>Credits are only spent now — refunded automatically if the render fails.</div>
        </div>
      )}

      {/* RENDERING — live progress */}
      {phase === 'rendering' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: INK, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            <Loader2 size={18} className="spin" color={GREEN} /> {progress?.label || 'Rendering your video…'}{progress?.eta_sec ? ` · ~${Math.ceil((progress.eta_sec || 0) / 60)} min` : ''}
          </div>
          {/* Cinematic → the scenes light up as they film. UGC → the recording booth speaks your script. */}
          {style === 'cinematic'
            ? (jobId && <RenderFilmstrip jobId={jobId} progress={progress} />)
            : <UgcRecording script={script} />}
          <div style={{ height: 8, borderRadius: 100, background: '#eef2ec', overflow: 'hidden', marginTop: 12 }}>
            <div style={{ height: '100%', width: `${Math.max(6, Math.min(98, progress?.pct || 8))}%`, background: GREEN, borderRadius: 100, transition: 'width .6s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>You can leave this open — it also lands in My Creatives when it’s ready.</div>
        </div>
      )}

      {/* DONE — the video */}
      {phase === 'done' && videoUrl && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>Your video is ready — edit it live below.</div>
            <div style={{ display: 'flex', gap: 9 }}>
              {/* Direct download via our proxy (Content-Disposition: attachment) — no new tab, real "Save as". */}
              <a href={`/api/creatives/download?url=${encodeURIComponent(videoUrl)}&name=${encodeURIComponent(`${(productName || brandName || 'aura').toString().trim() || 'aura'}-ad.mp4`)}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}><Download size={14} /> Download</a>
              <button onClick={() => { setPhase('setup'); setVideoUrl(null); setScript(''); setJobId(null); setErr(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}><Play size={14} /> Another</button>
            </div>
          </div>
          {/* The Remotion editor, INLINE — captions, CTA, logo, aspect, all free, right here (no click-through). */}
          {jobId ? <RemotionEditor jobId={jobId} /> : (
            <video src={videoUrl} controls playsInline poster={sourcePoster || undefined} style={{ width: 300, maxWidth: '100%', borderRadius: 14, border: `1px solid ${LINE}`, background: '#0d120e', display: 'block' }} />
          )}
        </div>
      )}

      {err && <div style={{ marginTop: 12, fontSize: 13, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 12px', maxWidth: 460 }}>{err}</div>}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
