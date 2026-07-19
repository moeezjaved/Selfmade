'use client'
/**
 * Remake-as-video modal — a step-by-step wizard with a free script-approval gate (no credits spent
 * until the user approves). The wizard only re-organises the PRESENTATION into light-themed steps;
 * the phase machine (form → analyse → review → generate → done), every handler, the cost math and
 * both API payloads (analyse + approve) are unchanged, so rendered videos are identical to before.
 *
 * Flow: pick look/brand/photos/details/language/voice → "Write my free script" (free analyse) →
 * pick length/extras + review & edit the script → "Create video" (spends credits) → render → done
 * (with per-scene / UGC tweak chips).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Loader2, Check, Film, Sparkles, Pencil, ChevronLeft, ChevronRight, Trophy } from 'lucide-react'
import CloneGeneration from '@/components/motion/CloneGeneration'
import { refreshCredits } from '@/components/credits/CreditCounter'

const LIME = '#dffe95'
type Photo = { id: string; src: string }
// Proxy external product URLs (hotlink-protected → raw <img> breaks). data:/R2 pass through.
const cdn = (u: string) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? u : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=160&q=72&output=webp`
type Brand = { id: string; name: string; brand_type?: string; products?: { image_urls?: string[] }[] }
type Phase = 'form' | 'analyzing' | 'review' | 'generating' | 'done'
const uid = () => Math.random().toString(36).slice(2)
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function CloneVideoModal({ sourceAdId, sourceVideoUrl, sourcePoster, onClose, onGenerated }: { sourceAdId: string; sourceVideoUrl?: string | null; sourcePoster?: string | null; onClose: () => void; onGenerated?: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  // 'service' brand = app/site/service → no physical product; photos optional, creator talks about it.
  const [brandType, setBrandType] = useState<'physical' | 'service'>('physical')
  const isService = brandType === 'service'
  const [photos, setPhotos] = useState<Photo[]>([])
  const [screencastKey, setScreencastKey] = useState<string | null>(null)   // uploaded screen-recording (R2 key) for the split-screen top half
  const [screencastName, setScreencastName] = useState('')
  const [castBusy, setCastBusy] = useState(false)
  const castRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [productName, setProductName] = useState('')
  const [benefit, setBenefit] = useState('')
  // Fast tier removed from the UI (2026-07-14: fast renders tested visibly worse) — premium only.
  // DB rows for *_fast stay (inactive path) so old jobs/history still resolve.
  const tier = 'premium' as const
  const [look, setLook] = useState('match')            // creator ethnicity/look override
  const [language, setLanguage] = useState('en')       // script + voiceover language (transcreated)
  const [voice, setVoice] = useState('nova')           // narration voice (faithful mode + preview)
  const [gloss, setGloss] = useState<string | null>(null)   // English one-liner for non-English scripts
  const [previewing, setPreviewing] = useState(false)
  const [mode, setMode] = useState<'ugc' | 'faithful'>('ugc')
  const modeTouched = useRef(false)                    // user explicitly picked a look → don't let the auto-suggestion override it
  const [suggestedMode, setSuggestedMode] = useState<'ugc' | 'faithful'>('ugc')
  const [sceneCount, setSceneCount] = useState(2)
  const [durationBucket, setDurationBucket] = useState<'15' | '30' | '60' | 'match'>('15')
  const [srcSecs, setSrcSecs] = useState<number | null>(null)
  const [genProgress, setGenProgress] = useState<{ label: string; pct: number; eta_sec: number } | null>(null)  // live render progress
  // Add-ons (each billed as its own tx; a failed add-on refunds itself, the base video still ships)
  const [extraLangs, setExtraLangs] = useState<string[]>([])   // faithful only · +200 cr each
  const [ecOn, setEcOn] = useState(false)                      // branded end-card · +50 cr
  const [ecOffer, setEcOffer] = useState('')
  const [ecCta, setEcCta] = useState('Shop now')
  const [hooksOn, setHooksOn] = useState(false)                // 3 hook variants · +800 cr (faithful)

  const [phase, setPhase] = useState<Phase>('form')
  const [step, setStep] = useState(0)                          // wizard step (form: 0-4 · review: 5-7)
  const bodyRef = useRef<HTMLDivElement | null>(null)          // scroll container — reset to top on step change
  const [jobId, setJobId] = useState<string | null>(null)
  const [draftScript, setDraftScript] = useState('')
  const [overlays, setOverlays] = useState<{ t: string; text: string }[]>([])  // auto-detected on-screen text callouts (editable)
  const [overlaysOn, setOverlaysOn] = useState(false)  // on-screen text is OPT-IN — clean video by default
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)   // non-error info (e.g. still rendering)
  const [result, setResult] = useState<{ url: string; script?: string | null; tweakable?: boolean; ugcTweakable?: boolean; segmentTweakable?: boolean; tweakScenes?: { duration: number; hasPeople: boolean }[]; tweakSegments?: { script: string; start?: number; end?: number }[]; finalScript?: string | null } | null>(null)
  const [twNote, setTwNote] = useState('')   // "Fix a moment" free-text — what exactly is wrong
  const [twFrom, setTwFrom] = useState('')   // cutaway patch window (seconds)
  const [twTo, setTwTo] = useState('')
  // ── Tweak panel (post-render, per-scene fixes — no full re-render) ──
  const [twSel, setTwSel] = useState<number | null>(null)      // selected scene index
  const [twBusy, setTwBusy] = useState(false)
  const [twMsg, setTwMsg] = useState<string | null>(null)
  const [twVoOpen, setTwVoOpen] = useState(false)
  const [twVoText, setTwVoText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  // Jump the modal body back to the top whenever the step/phase changes, so the next step's heading
  // is always visible (was staying scrolled down → looked like Next did nothing).
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' }) }, [step, phase])

  // UGC = one clip; Faithful = scene-by-scene + stitch, priced by scene count (credit_pricing
  // video_clone_xN rows — keep these numbers in sync with that table).
  // 1 credit = 1¢. Kept in sync with credit_pricing (migration 095): video is cost-plus (2× fal).
  const UGC_COST = { premium: 600, fast: 300 } as const   // premium = $6 (pricing v2; matches credit_pricing.video_clone)
  // Per-scene / per-segment pricing: a clean $6 (600 cr) per 15-second clip / per scene — so 30s = $12,
  // 60s = $24 (pricing v2, no stitching surcharge). Matches the DB video_clone_xN rows (600·n).
  const faithfulCost = (n: number, t: 'premium' | 'fast') => t === 'fast' ? Math.round(600 * n * 0.44 / 50) * 50 : 600 * n
  const FAITHFUL_COST = new Proxy({} as Record<number, { premium: number; fast: number }>, {
    get: (_t, k) => { const n = Number(k); return Number.isFinite(n) ? { premium: faithfulCost(n, 'premium'), fast: faithfulCost(n, 'fast') } : undefined },
  })
  // 'match' resolves to the nearest bucket from the source ad's analysed duration.
  const resolvedBucket = durationBucket === 'match' ? ((srcSecs || 15) <= 22 ? 15 : (srcSecs || 15) <= 45 ? 30 : 60) : Number(durationBucket)
  const nSegs = resolvedBucket >= 60 ? 4 : resolvedBucket >= 30 ? 2 : 1
  const baseCost = mode === 'faithful'
    ? (FAITHFUL_COST[sceneCount] || FAITHFUL_COST[2])[tier]
    : nSegs > 1 ? (FAITHFUL_COST[nSegs] || FAITHFUL_COST[2])[tier] : UGC_COST[tier]
  const addonCost = (mode === 'faithful' ? extraLangs.length * 200 : 0) + (ecOn ? 50 : 0) + (hooksOn && mode === 'faithful' ? 800 : 0)
  const cost = baseCost + addonCost
  // Languages breathe differently — per-language speaking rates keep the meter honest.
  const LANGS: { code: string; label: string; rate: number; rtl?: boolean }[] = [
    { code: 'en', label: 'English', rate: 2.3 },
    { code: 'ur', label: 'اردو Urdu', rate: 2.0, rtl: true },
    { code: 'hi', label: 'हिन्दी Hindi', rate: 2.1 },
    { code: 'ar', label: 'العربية Arabic', rate: 1.8, rtl: true },
    { code: 'es', label: 'Español', rate: 2.6 },
    { code: 'fr', label: 'Français', rate: 2.4 },
    { code: 'de', label: 'Deutsch', rate: 2.2 },
  ]
  // Look → language pairing nudge ("picked Pakistani → speak Urdu?"). Suggests, never forces.
  const PAIR: Record<string, { code: string; flag: string; name: string }> = {
    Pakistani: { code: 'ur', flag: '🇵🇰', name: 'Urdu' },
    Indian: { code: 'hi', flag: '🇮🇳', name: 'Hindi' },
    Arab: { code: 'ar', flag: '🇦🇪', name: 'Arabic' },
  }
  const langCfg = LANGS.find((l) => l.code === language) || LANGS[0]
  const VOICES = [
    { id: 'nova', label: 'Nova · warm female' }, { id: 'shimmer', label: 'Shimmer · bright female' },
    { id: 'onyx', label: 'Onyx · deep male' }, { id: 'echo', label: 'Echo · calm male' },
  ]
  // Speaking-time meter: per-language rate. Longer than the target → the render talks fast.
  const words = draftScript.trim() ? draftScript.trim().split(/\s+/).length : 0
  const spokenSecs = Math.round(words / langCfg.rate)
  // Faithful scenes split the SOURCE length (each clip ≥5s on Seedance), so the video ≈ the source
  // duration, floored at sceneCount×5 — NOT sceneCount×8 (that overstated it as ~24s and made a
  // correctly-sized ~12s script look "too small" against a video that's really ~15s).
  const targetSecs = mode === 'faithful' ? Math.max(srcSecs || 0, sceneCount * 5) : resolvedBucket
  const busy = phase === 'analyzing' || phase === 'generating'
  const LOOKS = ['match', 'Pakistani', 'Indian', 'Arab', 'East Asian', 'Black', 'White', 'Hispanic']

  // 🔊 Audition the narrator saying the script's first sentence — before any credits are spent.
  // The TTS fetch can outlive Chrome's click-activation window, making audio.play() reject silently.
  // So: cache the fetched audio keyed by voice+sentence — if play is blocked, we tell the user to tap
  // again, and the second tap plays the CACHED audio instantly (inside a fresh click gesture).
  const previewCache = useRef<Map<string, string>>(new Map())
  const previewVoice = async () => {
    if (previewing) return
    const sentence = draftScript.trim().split(/(?<=[.!?۔؟])\s+/)[0]?.slice(0, 200) || draftScript.trim().slice(0, 200)
    if (!sentence) return
    const cacheKey = `${voice}|${language}|${sentence}`
    setPreviewing(true); setErr(null)
    try {
      let url = previewCache.current.get(cacheKey)
      if (!url) {
        const r = await fetch('/api/discovery/clone-video/voice-preview', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: sentence, voice, lang: language }),
        })
        if (!r.ok) { setErr('Voice preview is unavailable right now — the render itself is unaffected.'); setPreviewing(false); return }
        url = URL.createObjectURL(await r.blob())
        previewCache.current.set(cacheKey, url)
      }
      const audio = new Audio(url)
      audio.onended = () => setPreviewing(false)
      try { await audio.play() } catch {
        // Autoplay gate ate the click — the audio is cached now, so the next tap plays instantly.
        setErr('Ready — tap 🔊 once more to play.')
        setPreviewing(false); return
      }
    } catch { setPreviewing(false) }
    finally { setTimeout(() => setPreviewing(false), 20000) }
  }

  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then((j) => {
      const bs: Brand[] = j.brands || []
      setBrands(bs); if (bs[0]) pickBrand(bs[0])
    }).catch(() => {})
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const pickBrand = (b: Brand) => {
    setBrandId(b.id); setBrandType(b.brand_type === 'service' ? 'service' : 'physical'); if (!productName) setProductName(b.name)
    const imgs = (b.products || []).flatMap((p) => p.image_urls || []).slice(0, 8)
    const ph = imgs.map((u) => ({ id: uid(), src: u }))
    setPhotos(ph); setSelected(ph.slice(0, 3).map((p) => p.id))
  }
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const arr = await Promise.all(Array.from(files).slice(0, 6).map(async (f) => ({ id: uid(), src: await fileToDataUrl(f) })))
    setPhotos((p) => [...p, ...arr]); setSelected((s) => Array.from(new Set([...s, ...arr.map((a) => a.id)])).slice(0, 4))
  }
  // Screen recording (service/app): a real mp4 of the user's app/site → shown in the TOP half of the
  // split-screen (moving UI, not a still). Big file → direct-to-R2 via the presigned Assets pipeline;
  // we pass the object KEY and the clone-video route resolves it to a public URL.
  const uploadScreencast = async (file: File | null) => {
    if (!file) return
    setCastBusy(true); setErr(null)
    try {
      const preRes = await fetch('/api/assets/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileType: file.type, sizeBytes: file.size }) })
      const pre = await preRes.json().catch(() => ({}))
      if (!preRes.ok || !pre.uploadUrl || !pre.key) throw new Error(pre.message || (preRes.status === 413 || pre.error === 'file_too_large' ? 'That recording is too large (max 500 MB).' : 'Could not start the upload — please try again.'))
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'content-type': pre.fileType || file.type }, body: file })
      if (!put.ok) throw new Error('Upload failed — please try again.')
      setScreencastKey(pre.key); setScreencastName(file.name)
    } catch (e: any) {
      // The screen recording is OPTIONAL — never let a hiccup here block the render. Say so plainly and
      // let the user skip. "Failed to fetch" = the browser dropped the request (flaky network / a deploy
      // rollout / an extension); a retry usually works, and screenshots are used if they skip.
      const raw = String(e?.message || e)
      const friendly = /failed to fetch|networkerror|load failed/i.test(raw)
        ? 'Upload didn’t go through (network hiccup). Try once more, or just skip this — your screenshots will be used.'
        : raw
      setErr(friendly)
    }
    finally { setCastBusy(false) }
  }
  const toggleSel = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length >= 4 ? s : [...s, id]))

  // Poll a job until it leaves the given "waiting" status. Returns the final payload, or
  // { timedOut: true } once the budget is exhausted — the job KEEPS running server-side (multi-scene
  // renders can outlast the tab), so a timeout is NOT a failure and NOT a refund.
  const pollUntil = async (id: string, leave: string, maxMs = 800_000): Promise<any> => {
    const iters = Math.ceil(maxMs / 4000)
    for (let i = 0; i < iters; i++) {
      await sleep(4000)
      const st = await fetch(`/api/discovery/clone-video/status?id=${id}`).then(r => r.json()).catch(() => ({}))
      if (st.progress) setGenProgress(st.progress)   // live step + ETA for the render bar
      if (st.error) return { error: st.error }
      if (st.status && st.status !== leave) return st
    }
    return { timedOut: true }
  }

  // Phase 1: analyse + draft script (free)
  const analyse = async () => {
    setErr(null)
    const chosen = photos.filter((p) => selected.includes(p.id)).map((p) => p.src)
    if (chosen.length === 0 && !isService) { setErr('Add & select at least one product photo to swap in.'); return }
    setPhase('analyzing')
    try {
      const start = await fetch('/api/discovery/clone-video', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceAdId, sourceVideoUrl: sourceVideoUrl || undefined, brandId: brandId || undefined, productImages: chosen, tier, productType: brandType,
          characterLook: look !== 'match' ? look : undefined, language, voice, screencastKey: screencastKey || undefined,
          productDetails: { name: productName.trim() || undefined, benefit: benefit.trim() || undefined } }),
      }).then(r => r.json())
      if (!start.jobId) { setErr(start.error || 'Could not start.'); setPhase('form'); return }
      setJobId(start.jobId)
      onGenerated?.()   // a video job now exists in My Creatives — tell the host wizard
      const st = await pollUntil(start.jobId, 'analyzing', 400_000)   // wait for 'review'
      if (st.timedOut) { setErr('Analysis is taking longer than usual — try again in a moment.'); setPhase('form'); return }
      if (st.error) { setErr(st.error); setPhase('form'); return }
      setDraftScript(st.script || '')
      setOverlays(Array.isArray(st.overlays) ? st.overlays : [])
      setGloss(st.gloss || null)
      const sug = st.suggestedMode === 'faithful' ? 'faithful' : 'ugc'
      setSuggestedMode(sug); if (!modeTouched.current) setMode(sug)   // honour an explicit user pick from step 1
      setSceneCount(Math.min(10, Math.max(2, Number(st.sceneCount) || 2)))
      setSrcSecs(Number(st.sourceSeconds) || null)
      setPhase('review'); setStep(4)   // land on the first review step (Length & format)
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('form') }
  }

  // Phase 2: approve (spend credits) + generate
  const approve = async () => {
    if (!jobId) return
    setErr(null); setNotice(null); setGenProgress(null); setPhase('generating')
    try {
      const ap = await fetch('/api/discovery/clone-video/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId, script: draftScript, mode, durationBucket,
          overlays: overlaysOn ? overlays.filter((o) => o.text.trim()) : [],
          extraLangs: mode === 'faithful' ? extraLangs : [],
          endCard: ecOn ? { offer: ecOffer.trim(), cta: ecCta.trim() || 'Shop now' } : null,
          hookVariants: hooksOn && mode === 'faithful',
        }),
      }).then(r => r.json())
      if (ap.error) { setErr(ap.error === 'insufficient_credits' ? 'Not enough credits.' : ap.error); setPhase('review'); return }
      refreshCredits()   // credits reserved on approve → drop the sidebar counter now
      // Multi-clip renders (faithful scenes, 30/60s segments) take much longer than one clip — give
      // the poll a budget that covers a 4-clip job (~28 min) before falling back to background mode.
      const budgetMs = (mode === 'faithful' || nSegs > 1) ? 1_680_000 : 800_000
      const st = await pollUntil(jobId, 'processing', budgetMs)   // wait for 'done'
      if (st.timedOut) {
        // NOT a failure — the worker is still rendering and will finish + deliver to My Creatives.
        // Credits stay reserved (auto-refunded only if it actually fails). Never say "refunded" here.
        setNotice('Still rendering — multi-scene videos take a bit longer. It’ll appear in My Creatives when it’s ready. Your credits are reserved (you won’t be charged twice, and you’re auto-refunded if it fails).')
        setPhase('review'); return
      }
      if (st.error || !st.url) { setErr((st.error || 'generation failed') + ' — credits were refunded.'); setPhase('review'); refreshCredits(); return }
      setResult({ url: st.url, script: st.script, tweakable: !!st.tweakable, ugcTweakable: !!st.ugcTweakable, segmentTweakable: !!st.segmentTweakable, tweakScenes: st.tweakScenes || [], tweakSegments: st.tweakSegments || [], finalScript: st.finalScript || st.script }); setPhase('done')
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('review') }
  }

  // ── Tweak: fix ONE scene (chip → server-side prompt surgery) or a whole-video op, then re-stitch
  // from the cached clips. The original video stays live until the new cut lands; failures refund. ──
  const runTweak = async (body: Record<string, unknown>) => {
    if (!jobId || twBusy) return
    setTwBusy(true); setTwMsg(null)
    try {
      const r = await fetch('/api/discovery/clone-video/tweak', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, ...body }),
      }).then((x) => x.json())
      if (r.error) { setTwMsg(r.error === 'insufficient_credits' ? 'Not enough credits.' : r.error); setTwBusy(false); return }
      refreshCredits()
      const st = await pollUntil(jobId, 'processing', 900_000)
      if (st.timedOut) { setTwMsg('Still working — the updated video will appear in My Creatives.'); setTwBusy(false); return }
      if (st.tweakError) { setTwMsg(`Tweak failed (${st.tweakError}) — your original video is untouched and any charge was refunded.`); setTwBusy(false); refreshCredits(); return }
      if (st.url) setResult({ url: st.url, script: st.finalScript || st.script, tweakable: !!st.tweakable, ugcTweakable: !!st.ugcTweakable, segmentTweakable: !!st.segmentTweakable, tweakScenes: st.tweakScenes || [], tweakSegments: st.tweakSegments || [], finalScript: st.finalScript || st.script })
      setTwMsg('Updated ✓'); setTwSel(null); setTwVoOpen(false)
    } catch (e: any) { setTwMsg(String(e?.message || e)) }
    setTwBusy(false)
  }

  // ── wizard plumbing ──
  // UGC vs Cinematic is AUTO-DETECTED from the analysis (suggestedMode) — no up-front "choose look"
  // step. The user can still switch on the "Length & format" step (step 5), where the ★ marks the
  // recommendation. Form steps 0-3, review steps 4-6.
  const STEPS = [
    { t: 'Your brand', s: 'Logo & product' },
    { t: 'Product photos', s: 'Up to 4' },
    { t: 'About your product', s: 'Optional · sharpens it' },
    { t: 'Words & voice', s: 'Language & narrator' },
    { t: 'Length & format', s: 'Length · on-screen text' },
    { t: 'Extras', s: 'Optional add-ons' },
    { t: 'Script & create', s: 'Review the free script' },
  ]
  const pickLook = (m: 'ugc' | 'faithful') => { modeTouched.current = true; setMode(m) }
  const brandName = brands.find((b) => b.id === brandId)?.name || productName.trim() || 'your brand'
  const selPhotos = photos.filter((p) => selected.includes(p.id))

  // Footer Next: within the form, step 3 → analyse(); within review, step 6 → approve(); else advance.
  const goNext = () => {
    if (phase === 'form') { if (step < 3) setStep(step + 1); else analyse() }
    else { if (step < 6) setStep(step + 1); else approve() }
  }
  const goBack = () => {
    if (phase === 'review' && step === 4) { setPhase('form'); setStep(3) }   // back across the analysis gate
    else if (step > 0) setStep(step - 1)
  }
  const railClickable = (i: number) => phase === 'form' ? i <= 3 : (i >= 4 && i <= 6)

  if (!mounted) return null
  const wide = phase === 'done'
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,10,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: wide ? 'min(980px,96vw)' : 'min(940px,96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff', border: '1px solid #dfe4de', borderRadius: 20, color: L_INK, boxShadow: '0 30px 90px -30px rgba(23,37,28,0.4)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 22px', borderBottom: '1px solid #e0eecb', background: HEADER_BG }}>
          <Film size={17} color={GREEN} /> <span style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.01em' }}>Remake as a video ad</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 9, border: '1px solid #dcebc4', background: 'rgba(255,255,255,0.8)', color: '#3c473e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={17} /></button>
        </div>

        {phase === 'generating' ? (
          <div style={{ background: '#f6f7f5' }}>
            <CloneGeneration helper={genProgress?.label || 'Rendering your video · this can take a few minutes · keep browsing'} />
            {genProgress && (
              <div style={{ padding: '0 24px 22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: L_INK }}>{genProgress.label}</span>
                  <span style={{ fontSize: 12, color: L_MUTED, fontVariantNumeric: 'tabular-nums' }}>{genProgress.eta_sec > 0 ? `~${genProgress.eta_sec >= 60 ? `${Math.ceil(genProgress.eta_sec / 60)} min` : `${genProgress.eta_sec}s`} left` : ''}</span>
                </div>
                <div style={{ height: 8, borderRadius: 100, background: '#e3e9e2', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(98, Math.max(4, genProgress.pct))}%`, background: GREEN, borderRadius: 100, transition: 'width .6s ease' }} />
                </div>
              </div>
            )}
          </div>
        ) : phase === 'done' && result ? (
          // ── DONE: video + tweak/fix chips (light) ──
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, overflow: 'auto' }}>
            <div style={{ background: '#0b100c', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 320 }}>
              <video src={result.url} controls autoPlay loop playsInline style={{ maxWidth: '100%', maxHeight: '64vh', borderRadius: 8 }} />
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, borderLeft: `1px solid ${L_LINE}` }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>🎉 Your video is ready</div>
              {result.script && <div style={{ fontSize: 12, color: L_MUTED, background: '#fcfdfb', border: `1px solid ${L_LINE}`, borderRadius: 9, padding: '10px 12px', maxHeight: 120, overflow: 'auto' }}><b style={{ color: L_INK }}>Script:</b> {result.script}</div>}
              <a href={result.url} download style={{ ...btnPrimary, textDecoration: 'none', justifyContent: 'center' }}>Download</a>
              <p style={{ fontSize: 11.5, color: L_MUTED, margin: 0 }}>Saved in <b style={{ color: L_INK }}>My Creatives</b>.</p>

              {result.tweakable && (result.tweakScenes?.length || 0) > 0 && (
                <div style={{ borderTop: `1px solid ${L_LINE}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: L_MUTED, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Tweak a scene</div>
                  <p style={{ fontSize: 11.5, color: L_MUTED, margin: '0 0 8px' }}>Something off in one scene? Fix just that scene — the rest stays untouched.</p>
                  {twBusy ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GREEN, fontSize: 12.5, padding: '8px 0' }}><Loader2 size={14} className="spin" /> {genProgress?.label || 'Tweaking…'}</div>
                  ) : (<>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {result.tweakScenes!.map((s, i) => (
                        <button key={i} onClick={() => setTwSel(twSel === i ? null : i)} style={{ ...chip(twSel === i), padding: '6px 11px', fontSize: 12 }}>Scene {i + 1} · {s.duration}s{s.hasPeople ? ' · 👤' : ''}</button>
                      ))}
                    </div>
                    {twSel != null && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {[['product', 'Product looks wrong'], ['action', 'Wrong action'], ['person', 'Person looks off'], ['closeup', 'Make it a close-up'], ['redo', 'Just redo it']].map(([k, label]) => (
                          <button key={k} onClick={() => runTweak({ type: 'redo_scene', scene: twSel, chip: k })} style={{ ...chip(false), fontSize: 11.5 }}>{label} · 600 cr</button>
                        ))}
                        {result.tweakScenes!.length > 2 && (
                          <button onClick={() => runTweak({ type: 'remove_scene', scene: twSel })} style={{ ...chip(false), fontSize: 11.5, color: GREEN, borderColor: SEL_BORDER }}>Remove scene · free</button>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => runTweak({ type: 'trim' })} style={{ ...chip(false), fontSize: 11.5, color: GREEN, borderColor: SEL_BORDER }}>✂️ Trim dead air · free</button>
                      <button onClick={() => { setTwVoOpen((v) => !v); setTwVoText(result.finalScript || '') }} style={{ ...chip(twVoOpen), fontSize: 11.5 }}>🎙 Redo voiceover · 50 cr</button>
                    </div>
                    {twVoOpen && (
                      <div style={{ marginTop: 8 }}>
                        <textarea value={twVoText} onChange={(e) => setTwVoText(e.target.value.slice(0, 2000))} rows={3} style={{ ...input, width: '100%', resize: 'vertical', fontSize: 12.5 }} placeholder="Edit the narration…" />
                        <button onClick={() => twVoText.trim() && runTweak({ type: 'redo_vo', script: twVoText.trim() })} style={{ ...btnPrimary, marginTop: 6, padding: '8px 14px', fontSize: 12.5 }}>Apply new voiceover · 50 cr</button>
                      </div>
                    )}
                  </>)}
                  {twMsg && <p style={{ fontSize: 11.5, color: twMsg === 'Updated ✓' ? GREEN : '#b42318', margin: '8px 0 0' }}>{twMsg}</p>}
                </div>
              )}

              {!result.tweakable && result.ugcTweakable && (
                <div style={{ borderTop: `1px solid ${L_LINE}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: L_MUTED, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>🎯 Fix it</div>
                  <p style={{ fontSize: 11.5, color: L_MUTED, margin: '0 0 8px' }}>Not quite right? Tell us exactly what&apos;s wrong (a mispronounced word, an invented cap…) or use a one-tap fix — same script, same creator vibe.</p>
                  {twBusy ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GREEN, fontSize: 12.5, padding: '8px 0' }}><Loader2 size={14} className="spin" /> {genProgress?.label || 'Re-rolling…'}</div>
                  ) : (<>
                    <textarea value={twNote} onChange={(e) => setTwNote(e.target.value.slice(0, 300))} rows={2}
                      style={{ ...input, width: '100%', resize: 'vertical', fontSize: 12.5, marginBottom: 8 }}
                      placeholder={'e.g. “it says Ejad wrong — pronounce it Ee-jaad” or “the pouch shouldn’t have a cap”'} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => runTweak({ type: 'redo_ugc', chip: 'redo', note: twNote.trim() || undefined })} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12.5 }}>Fix it · 450 cr</button>
                      {[['size', 'Too big/small'], ['product', 'Product wrong'], ['person', 'Person off'], ['action', 'Not using it']].map(([k, label]) => (
                        <button key={k} onClick={() => runTweak({ type: 'redo_ugc', chip: k, note: twNote.trim() || undefined })} style={{ ...chip(false), fontSize: 11.5, padding: '6px 10px' }}>{label}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${L_LINE}` }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>🩹 Or patch just the flawed seconds</span>
                      <input value={twFrom} onChange={(e) => setTwFrom(e.target.value.replace(/[^\d.]/g, ''))} placeholder="7" style={{ ...input, width: 58, fontSize: 12.5, padding: '6px 8px' }} inputMode="decimal" />
                      <span style={{ fontSize: 12, color: L_MUTED }}>to</span>
                      <input value={twTo} onChange={(e) => setTwTo(e.target.value.replace(/[^\d.]/g, ''))} placeholder="10" style={{ ...input, width: 58, fontSize: 12.5, padding: '6px 8px' }} inputMode="decimal" />
                      <span style={{ fontSize: 12, color: L_MUTED }}>sec</span>
                      <button onClick={() => { const f = parseFloat(twFrom || '0'); runTweak({ type: 'patch_broll', from: f, to: parseFloat(twTo || String(f + 4)), note: twNote.trim() || undefined }) }} style={{ ...chip(false), fontSize: 11.5, color: GREEN, borderColor: SEL_BORDER, padding: '6px 12px' }}>Patch it · 150 cr</button>
                      <span style={{ fontSize: 11, color: L_FAINT, width: '100%' }}>Swaps those seconds for a clean product close-up (max 5s) — the voice keeps playing, the rest is untouched.</span>
                    </div>
                  </>)}
                  {twMsg && <p style={{ fontSize: 11.5, color: twMsg === 'Updated ✓' ? GREEN : '#b42318', margin: '8px 0 0' }}>{twMsg}</p>}
                </div>
              )}

              {!result.tweakable && !result.ugcTweakable && result.segmentTweakable && (result.tweakSegments?.length || 0) > 0 && (
                <div style={{ borderTop: `1px solid ${L_LINE}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: L_MUTED, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>🎯 Fix a moment</div>
                  <p style={{ fontSize: 11.5, color: L_MUTED, margin: '0 0 8px' }}>Spot the second something&apos;s off, pick that section, and tell us what&apos;s wrong — we re-shoot ONLY that part and keep the rest.</p>
                  {twBusy ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GREEN, fontSize: 12.5, padding: '8px 0' }}><Loader2 size={14} className="spin" /> {genProgress?.label || 'Re-shooting that section…'}</div>
                  ) : (<>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {result.tweakSegments!.map((s, i) => {
                        const mmss = (t?: number) => t == null ? '' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
                        const range = s.start != null && s.end != null ? `${mmss(s.start)}–${mmss(s.end)}` : `Section ${i + 1}`
                        return (
                          <button key={i} onClick={() => setTwSel(twSel === i ? null : i)} style={{ ...chip(twSel === i), padding: '6px 11px', fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.script}>
                            ⏱ {range}{s.script ? ` · “${s.script.slice(0, 34)}${s.script.length > 34 ? '…' : ''}”` : ''}
                          </button>
                        )
                      })}
                    </div>
                    {twSel != null && (
                      <div style={{ background: '#fcfdfb', border: `1px solid ${L_LINE}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                        <textarea value={twNote} onChange={(e) => setTwNote(e.target.value.slice(0, 300))} rows={2}
                          style={{ ...input, width: '100%', resize: 'vertical', fontSize: 12.5 }}
                          placeholder={'What’s wrong in this section? e.g. “it says Ejad wrong — pronounce it Ee-jaad” or “the pouch has a cap, remove it”'} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                          <button onClick={() => runTweak({ type: 'redo_segment', scene: twSel, chip: 'redo', note: twNote.trim() || undefined })} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12.5 }}>Re-shoot section · 600 cr</button>
                          <span style={{ fontSize: 11, color: L_MUTED }}>or quick fixes:</span>
                          {[['product', 'Product wrong'], ['size', 'Too big/small'], ['person', 'Person off']].map(([k, label]) => (
                            <button key={k} onClick={() => runTweak({ type: 'redo_segment', scene: twSel, chip: k, note: twNote.trim() || undefined })} style={{ ...chip(false), fontSize: 11.5, padding: '6px 10px' }}>{label}</button>
                          ))}
                        </div>
                        {/* Cutaway patch — the cheap scalpel: replaces ONLY these seconds with a product
                            close-up; the voice keeps playing untouched. Best for a visual flaw (wrong
                            cap/label) that lasts a couple of seconds. */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${L_LINE}` }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>🩹 Or patch just the flawed seconds</span>
                          <input value={twFrom} onChange={(e) => setTwFrom(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(result.tweakSegments?.[twSel]?.start ?? 0)} style={{ ...input, width: 58, fontSize: 12.5, padding: '6px 8px' }} inputMode="decimal" />
                          <span style={{ fontSize: 12, color: L_MUTED }}>to</span>
                          <input value={twTo} onChange={(e) => setTwTo(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String((result.tweakSegments?.[twSel]?.start ?? 0) + 4)} style={{ ...input, width: 58, fontSize: 12.5, padding: '6px 8px' }} inputMode="decimal" />
                          <span style={{ fontSize: 12, color: L_MUTED }}>sec</span>
                          <button onClick={() => {
                            const f = parseFloat(twFrom || String(result.tweakSegments?.[twSel!]?.start ?? 0))
                            const t2 = parseFloat(twTo || String(f + 4))
                            runTweak({ type: 'patch_broll', from: f, to: t2, note: twNote.trim() || undefined })
                          }} style={{ ...chip(false), fontSize: 11.5, color: GREEN, borderColor: SEL_BORDER, padding: '6px 12px' }}>Patch it · 150 cr</button>
                          <span style={{ fontSize: 11, color: L_FAINT, width: '100%' }}>Swaps those seconds for a clean product close-up (max 5s) — the voice keeps playing, the rest is untouched. Cheapest fix for a wrong cap/label.</span>
                        </div>
                      </div>
                    )}
                  </>)}
                  {twMsg && <p style={{ fontSize: 11.5, color: twMsg === 'Updated ✓' ? GREEN : '#b42318', margin: '8px 0 0' }}>{twMsg}</p>}
                </div>
              )}
            </div>
          </div>
        ) : (
          // ── SETUP + REVIEW wizard (light) ──
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* step rail */}
            <div className="sm-rail" style={{ width: 232, flexShrink: 0, background: L_SIDE, borderRight: `1px solid ${L_LINE}`, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.09em', color: L_FAINT, margin: '0 6px 10px', textTransform: 'uppercase' }}>7 quick steps</div>
              {STEPS.map((s, i) => {
                const clickable = railClickable(i)
                return (
                  <button key={i} disabled={!clickable} onClick={() => clickable && setStep(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 11, cursor: clickable ? 'pointer' : 'default', opacity: clickable ? 1 : 0.5, border: '1px solid ' + (i === step ? L_LINE : 'transparent'), background: i === step ? '#fff' : 'transparent', textAlign: 'left', fontFamily: 'inherit', width: '100%', boxShadow: i === step ? '0 1px 3px rgba(23,37,28,.07)' : 'none' }}>
                    <span style={{ width: 23, height: 23, borderRadius: 99, background: i < step ? '#d8efc7' : (i === step ? FOREST : '#e8ede7'), color: i < step ? SEL_TEXT : (i === step ? LIME : L_MUTED), fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i < step ? '✓' : i + 1}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: i === step ? FOREST : '#3c473e' }}>{s.t}</span>
                      <span style={{ display: 'block', fontSize: 10, color: L_FAINT }}>{s.s}</span>
                    </span>
                  </button>
                )
              })}
              <div style={{ marginTop: 'auto', fontSize: 11, color: L_FAINT, lineHeight: 1.55, padding: '10px 8px 0', borderTop: `1px solid ${L_LINE}` }}>
                <b style={{ color: '#3c473e' }}>You approve before you pay.</b><br />We write your script free first. Credits are only used when you say go — and refund if a render fails.
              </div>
            </div>

            {/* pane */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 12px' }}>

                {/* STEP 1 — brand */}
                {step === 0 && (
                  <section>
                    <SourceCard sourceVideoUrl={sourceVideoUrl} sourcePoster={sourcePoster} hasSource={!!sourceAdId} />
                    <Kicker>Step 1 of 7</Kicker>
                    <H2>Whose ad is this going to be?</H2>
                    <Lead>Pick your brand — we automatically use its <b>product photos</b> so the video features your real product.</Lead>
                    {brands.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                        {brands.map((b) => <button key={b.id} onClick={() => pickBrand(b)} style={chip(brandId === b.id)}>{b.name}</button>)}
                      </div>
                    ) : <Lead>No saved brands yet — upload product photos on the next step.</Lead>}
                    {brandId && selPhotos.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 14px' }}>
                        <Check size={16} color={GREEN} strokeWidth={3} style={{ flexShrink: 0 }} />
                        <div style={{ fontSize: 12.5, color: SEL_TEXT, lineHeight: 1.5 }}>Loaded <b>{brandName}</b>’s {photos.length} product photo{photos.length === 1 ? '' : 's'}. You’ll choose which to use on the next step.</div>
                      </div>
                    )}
                  </section>
                )}

                {/* STEP 2 — photos */}
                {step === 1 && (
                  <section>
                    <Kicker>Step 2 of 7</Kicker>
                    <H2>{isService ? 'Add a logo or screenshots (optional)' : 'Show us your product'}</H2>
                    <Lead>{isService
                      ? <>This is a <b>service</b> brand — photos are optional. Add a <b>logo or app/site screenshots</b> if you like (the creator can show them on their phone). You can skip and continue.</>
                      : <>These photos are swapped <b>into</b> the video. Clear photos on a plain background work best. Pick up to 4.</>}</Lead>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {photos.map((p) => {
                        const on = selected.includes(p.id)
                        return (
                          <button key={p.id} onClick={() => toggleSel(p.id)} style={{ position: 'relative', width: 88, height: 88, borderRadius: 13, overflow: 'hidden', border: on ? `2px solid ${SEL_BORDER}` : `2px solid ${L_LINE}`, background: '#f1f3f0', cursor: 'pointer', padding: 0 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={cdn(p.src)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: on ? 1 : 0.5 }} />
                            {on && <span style={{ position: 'absolute', bottom: 4, right: 4, background: LIME, color: FOREST, borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} strokeWidth={3} /></span>}
                          </button>
                        )
                      })}
                      <button onClick={() => fileRef.current?.click()} style={photoAdd}><Upload size={16} /> Upload</button>
                      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
                    </div>
                    {isService && (
                      <div style={{ marginTop: 14, background: '#fbfcfa', border: `1px solid ${L_LINE}`, borderRadius: 13, padding: '13px 15px' }}>
                        <div style={{ fontSize: 13, fontWeight: 750, color: L_INK, marginBottom: 3 }}>🎥 Screen recording <span style={{ fontWeight: 500, color: L_MUTED }}>· optional, makes it look pro</span></div>
                        <div style={{ fontSize: 12, color: L_MUTED, lineHeight: 1.5, marginBottom: 10 }}>Upload a short <b>screen recording of your app or website</b> (mp4/mov). We show it — actually moving — in the top half while the creator talks below, just like the winning ad. No recording? Your screenshots above are used instead.</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button onClick={() => castRef.current?.click()} disabled={castBusy} style={{ ...photoAdd, width: 'auto', height: 'auto', padding: '9px 16px', flexDirection: 'row', gap: 7, opacity: castBusy ? 0.6 : 1 }}>
                            {castBusy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {screencastKey ? 'Replace recording' : 'Upload screen recording'}
                          </button>
                          {screencastKey && <span style={{ fontSize: 12, fontWeight: 700, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Check size={14} strokeWidth={3} /> {screencastName.slice(0, 28) || 'Added'}</span>}
                          <input ref={castRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => uploadScreencast(e.target.files?.[0] || null)} />
                        </div>
                      </div>
                    )}
                    <InfoBar>{isService
                      ? <>💡 Service brand — the creator <b>talks about your service/app</b> (and we can show your app on screen). We never render a made-up physical product.</>
                      : <>💡 The final video shows <b>your exact product</b> — we never invent a different bottle, label or price.</>}</InfoBar>
                  </section>
                )}

                {/* STEP 3 — about */}
                {step === 2 && (
                  <section>
                    <Kicker>Step 3 of 7 · optional</Kicker>
                    <H2>Tell us about the product</H2>
                    <Lead>30 seconds here makes the script noticeably better. Skip it if you’re in a hurry — we’ll work it out from your photos.</Lead>
                    <div className="field" style={{ marginBottom: 14 }}><FieldLabel>Product name</FieldLabel><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. AURA Hair Serum" style={{ ...input, width: '100%' }} /></div>
                    <div className="field"><FieldLabel>The one thing it does best <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· say it like you’d tell a friend</i></FieldLabel><input value={benefit} onChange={(e) => setBenefit(e.target.value)} placeholder="e.g. removes stains in one wipe" style={{ ...input, width: '100%' }} /></div>
                  </section>
                )}

                {/* STEP 4 — words & voice (last pre-analysis step → 'Write my free script') */}
                {step === 3 && (
                  <section>
                    <Kicker>Step 4 of 7</Kicker>
                    <H2>The words &amp; the voice</H2>
                    <Lead><b>Good news: this part is free.</b> When you press <b>Write my free script</b>, we watch the winning ad and write a script for your product. You’ll read it and change any word before anything is charged.</Lead>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>Who’s on camera <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· match the ad, or recast</i></FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {LOOKS.map((l) => <button key={l} onClick={() => setLook(l)} style={chip(look === l)}>{l === 'match' ? 'Match original' : l}</button>)}
                      </div>
                      {PAIR[look] && language === 'en' && (
                        <button onClick={() => setLanguage(PAIR[look].code)} style={{ ...chipDashed(false), marginTop: 8 }}>{PAIR[look].flag} Speak {PAIR[look].name}?</button>
                      )}
                    </div>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>Script &amp; voiceover language</FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {LANGS.map((l) => <button key={l.code} onClick={() => setLanguage(l.code)} style={chip(language === l.code)}>{l.label}</button>)}
                      </div>
                      {language !== 'en' && <div style={{ fontSize: 11.5, color: L_FAINT, marginTop: 6 }}>Written natively like a local creator would talk — not translated. You review it (with an English summary) before spending credits.</div>}
                    </div>
                    <div className="field">
                      <FieldLabel>Narration voice <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· you can preview it before approving</i></FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {VOICES.map((v) => <button key={v.id} onClick={() => setVoice(v.id)} style={chip(voice === v.id)}>{v.label}</button>)}
                      </div>
                    </div>
                    {phase === 'analyzing' && <div style={{ fontSize: 14.5, fontWeight: 700, color: GREEN, display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, background: '#f4fbe6', border: '1px solid #d8ebb9', borderRadius: 12, padding: '13px 16px' }}><Loader2 size={18} className="spin" /> <span>Watching the winning ad &amp; writing your script…<br /><span style={{ fontSize: 12, fontWeight: 500, color: '#5a7a5a' }}>This is free — no credits used until you approve it.</span></span></div>}
                  </section>
                )}

                {/* STEP 5 — length & format (review phase) · UGC/Cinematic switch lives here */}
                {step === 4 && (
                  <section>
                    <Kicker>Step 5 of 7</Kicker>
                    <H2>Length &amp; format</H2>
                    <Lead>How long, and whether to burn text onto the video. {suggestedMode === 'faithful' ? 'This ad is cinematic — we suggest the Cinematic style.' : ''}</Lead>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>Style</FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => pickLook('ugc')} style={chip(mode === 'ugc')}>UGC creator · 1 clip · {UGC_COST[tier]} cr{suggestedMode === 'ugc' ? ' ★' : ''}</button>
                        <button onClick={() => pickLook('faithful')} style={chip(mode === 'faithful')}>Cinematic · {sceneCount} scenes · {(FAITHFUL_COST[sceneCount] || FAITHFUL_COST[2])[tier]} cr{suggestedMode === 'faithful' ? ' ★' : ''}</button>
                      </div>
                    </div>
                    {mode === 'ugc' && (
                      <div className="field" style={{ marginBottom: 16 }}>
                        <FieldLabel>Video length</FieldLabel>
                        {(() => {
                          const cap = srcSecs ? (srcSecs <= 22 ? 15 : srcSecs <= 45 ? 30 : 60) : 60
                          const lenBtn = (v: '15' | '30' | '60', secs: number, label: string) => {
                            const disabled = secs > cap
                            return <button key={v} onClick={() => !disabled && setDurationBucket(v)} disabled={disabled} style={{ ...chip(durationBucket === v), opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }} title={disabled ? `Longer than the ${srcSecs}s source — a remake matches the original length` : ''}>{label}</button>
                          }
                          const matchCost = cap === 15 ? UGC_COST[tier] : (FAITHFUL_COST[cap === 60 ? 4 : 2] || FAITHFUL_COST[2])[tier]
                          return (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {lenBtn('15', 15, `15s · ${UGC_COST[tier]} cr`)}
                              {lenBtn('30', 30, `30s · ${FAITHFUL_COST[2][tier]} cr`)}
                              {lenBtn('60', 60, `60s · ${FAITHFUL_COST[4][tier]} cr`)}
                              {srcSecs ? <button onClick={() => setDurationBucket('match')} style={chip(durationBucket === 'match')}>Match the original ({srcSecs}s) · {matchCost} cr</button> : null}
                            </div>
                          )
                        })()}
                        {(() => {
                          // Honest length estimate: the render matches YOUR SCRIPT, not the bucket —
                          // buckets are a MAX. Same words/2.6 fit the worker uses, so "30s" showing
                          // "≈22s" is exactly what ships (the ejad "why is it 22s?" question).
                          const words = draftScript.trim().split(/\s+/).filter(Boolean).length
                          const bucket = durationBucket === 'match' ? (srcSecs || 15) : Number(durationBucket)
                          if (!words || bucket <= 15) return null
                          const nS = bucket >= 60 ? 4 : 2
                          const per = Math.ceil(words / nS)
                          const est = Math.min(bucket, [...Array(nS)].reduce((a) => a + Math.max(5, Math.min(15, Math.round(per / 2.6) + 1)), 0))
                          return <div style={{ fontSize: 11.5, color: GREEN, marginTop: 6, fontWeight: 600 }}>⏱ Your script fills ≈{est}s — we render exactly that (no silent padding), so the final video may be shorter than {bucket}s.</div>
                        })()}
                        {srcSecs ? <div style={{ fontSize: 11.5, color: L_FAINT, marginTop: 6 }}>Source is {srcSecs}s — a remake matches the original length (longer options are disabled).{nSegs > 1 ? ` ${nSegs} chained clips stitched into one take.` : ''}</div>
                          : nSegs > 1 ? <div style={{ fontSize: 11.5, color: L_FAINT, marginTop: 6 }}>{nSegs} chained clips of the same creator, stitched into one take.</div> : null}
                      </div>
                    )}
                    <div onClick={() => setOverlaysOn(!overlaysOn)} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1.5px solid ${overlaysOn ? SEL_BORDER : L_LINE}`, background: overlaysOn ? SEL_BG : '#fff', borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}>
                      <span style={{ flex: 1 }}>
                        <b style={{ fontSize: 13.5 }}>Add on-screen text</b>
                        <p style={{ fontSize: 11.5, color: L_MUTED, margin: '2px 0 0', lineHeight: 1.5 }}>Off = clean video. On = callouts like “25g PROTEIN”, copied from the winning ad and rewritten for your product. Edit every line.</p>
                      </span>
                      <Switch on={overlaysOn} />
                    </div>
                    {overlaysOn && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {overlays.map((o, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10.5, color: L_FAINT, width: 46, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{o.t || '—'}</span>
                              <input value={o.text} onChange={(e) => setOverlays((prev) => prev.map((x, j) => j === i ? { ...x, text: e.target.value.slice(0, 60) } : x))} placeholder="Callout text (e.g. 30g PROTEIN)" style={{ ...input, flex: 1, padding: '8px 11px' }} />
                              <button onClick={() => setOverlays((prev) => prev.filter((_, j) => j !== i))} title="Remove" style={{ background: 'none', border: 'none', color: L_MUTED, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>×</button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setOverlays((prev) => [...prev, { t: '', text: '' }].slice(0, 8))} style={{ marginTop: 8, background: 'none', border: `1px dashed ${SEL_BORDER}`, color: GREEN, borderRadius: 10, padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>+ Add text</button>
                      </div>
                    )}
                  </section>
                )}

                {/* STEP 6 — extras */}
                {step === 5 && (
                  <section>
                    <Kicker>Step 6 of 7 · all optional</Kicker>
                    <H2>Extras that squeeze more out of one video</H2>
                    <Lead>Each is a separate small charge, and each refunds itself automatically if it fails. Your main video is never at risk.</Lead>
                    <div onClick={() => setEcOn(!ecOn)} style={toggleRow(ecOn)}>
                      <span style={{ flex: 1 }}><b style={{ fontSize: 13.5 }}>🏷 Branded end-card</b><p style={{ fontSize: 11.5, color: L_MUTED, margin: '2px 0 0', lineHeight: 1.5 }}>A closing frame with your logo, an offer and a button — the bit that makes people click.</p></span>
                      <span style={priceTag}>+50 cr</span><Switch on={ecOn} />
                    </div>
                    {ecOn && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input value={ecOffer} onChange={(e) => setEcOffer(e.target.value)} placeholder="Offer (e.g. Buy 2 Get 1 Free)" style={{ ...input, flex: 2 }} />
                        <input value={ecCta} onChange={(e) => setEcCta(e.target.value)} placeholder="CTA" style={{ ...input, flex: 1 }} />
                      </div>
                    )}
                    {mode === 'faithful' && (
                      <div onClick={() => setHooksOn(!hooksOn)} style={{ ...toggleRow(hooksOn), marginTop: 10 }}>
                        <span style={{ flex: 1 }}><b style={{ fontSize: 13.5 }}>⚡ 3 different openings</b><p style={{ fontSize: 11.5, color: L_MUTED, margin: '2px 0 0', lineHeight: 1.5 }}>Same video, three different first-3-seconds — run all three and let Meta find the winner.</p></span>
                        <span style={priceTag}>+800 cr</span><Switch on={hooksOn} />
                      </div>
                    )}
                    {mode === 'faithful' && (
                      <div style={{ marginTop: 14 }}>
                        <FieldLabel>🌍 Also generate in <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· +200 cr each · same video, native voiceover</i></FieldLabel>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {LANGS.filter((l) => l.code !== language).slice(0, 6).map((l) => {
                            const on = extraLangs.includes(l.code)
                            return <button key={l.code} onClick={() => setExtraLangs((prev) => on ? prev.filter((x) => x !== l.code) : prev.length >= 2 ? prev : [...prev, l.code])} style={chip(on)}>{l.label}</button>
                          })}
                        </div>
                        {extraLangs.length > 0 && <div style={{ fontSize: 11, color: L_FAINT, marginTop: 6 }}>Each arrives as its own ad in My Creatives.</div>}
                      </div>
                    )}
                    {mode === 'ugc' && <InfoBar>💡 More openings &amp; extra languages are available on <b>Cinematic</b> remakes — switch style on the previous step.</InfoBar>}
                  </section>
                )}

                {/* STEP 7 — script & create */}
                {step === 6 && (
                  <section>
                    <Kicker>Step 7 of 7</Kicker>
                    <H2>Your script — read it, tweak it, create</H2>
                    <Lead>This is exactly what the video will say. Edit any word. Nothing is charged until you press create.</Lead>
                    <div className="field" style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <FieldLabel>{mode === 'faithful' ? 'Voiceover (one continuous narration)' : 'Voiceover script'}{language !== 'en' ? ` · ${langCfg.label}` : ''}</FieldLabel>
                        <button onClick={previewVoice} disabled={previewing || !draftScript.trim()} style={{ ...chip(false), padding: '5px 12px', opacity: previewing ? 0.6 : 1 }}>{previewing ? '🔊 Playing…' : '🔊 Hear the voice'}</button>
                      </div>
                      <textarea value={draftScript} onChange={(e) => setDraftScript(e.target.value)} rows={7} dir={langCfg.rtl ? 'rtl' : 'ltr'} style={{ ...input, width: '100%', resize: 'vertical', lineHeight: langCfg.rtl ? 1.9 : 1.5, fontSize: langCfg.rtl ? 15 : 13.5 }} />
                      {gloss && language !== 'en' && <div style={{ fontSize: 11.5, color: L_MUTED, marginTop: 6, fontStyle: 'italic' }}>In English: “{gloss}”</div>}
                      {words > 0 && (
                        mode === 'faithful' ? (
                          <div style={{ fontSize: 11.5, marginTop: 6, color: L_MUTED }}>{words} words ≈ {spokenSecs}s of narration · ~{targetSecs}s of scenes{spokenSecs > targetSecs + 4 ? ' — the closing shot holds while the voiceover finishes. Trim for a tighter cut, or leave it.' : ' — fits nicely.'}</div>
                        ) : (
                          <div style={{ fontSize: 11.5, marginTop: 6, color: spokenSecs > targetSecs + 4 ? '#c2410c' : spokenSecs > targetSecs ? '#a16207' : L_MUTED }}>{words} words ≈ {spokenSecs}s spoken · target ~{targetSecs}s{spokenSecs > targetSecs + 4 ? ' — too long, the delivery will feel rushed. Trim it, or pick a longer length.' : spokenSecs > targetSecs ? ' — a touch long; consider trimming.' : ' — fits comfortably.'}</div>
                        )
                      )}
                    </div>
                    <div style={{ border: `1px solid ${L_LINE}`, borderRadius: 16, overflow: 'hidden', marginBottom: 14 }}>
                      <ReviewRow k="Style" v={mode === 'faithful' ? `Cinematic · ${sceneCount} scenes` : 'UGC creator'} onEdit={() => setStep(4)} />
                      <ReviewRow k="Length" v={mode === 'faithful' ? `~${targetSecs}s` : `${resolvedBucket}s`} onEdit={() => setStep(4)} />
                      <ReviewRow k="Brand" v={brandName} onEdit={() => setStep(0)} />
                      <ReviewRow k="Language & voice" v={`${langCfg.label} · ${(VOICES.find(v => v.id === voice) || VOICES[0]).label.split(' · ')[0]}`} onEdit={() => setStep(3)} />
                      <ReviewRow k="On camera" v={look === 'match' ? 'Match the original' : look} onEdit={() => setStep(3)} />
                      <ReviewRow k="On-screen text" v={overlaysOn ? 'On' : 'Off — clean video'} onEdit={() => setStep(4)} last />
                    </div>
                    {notice && <div style={noticeBox}>{notice} <a href="/creative-studio" style={{ color: GREEN, fontWeight: 700 }}>Open My Creatives →</a></div>}
                  </section>
                )}

                {err && <div style={{ ...errBox, marginTop: 16 }}>{err}</div>}
              </div>

              {/* footer nav */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', borderTop: `1px solid ${L_LINE}`, background: '#fcfdfb' }}>
                {(step > 0) ? <button onClick={goBack} disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }}><ChevronLeft size={15} /> Back</button> : <span />}
                <span style={{ fontSize: 12, color: L_MUTED }}>{phase === 'review' ? <>Total <b style={{ color: L_INK }}>{cost} cr</b> · charged when you create</> : 'Free to preview — charged only after you approve the script'}</span>
                <button onClick={goNext} disabled={busy} style={{ ...btnPrimary, marginLeft: 'auto', opacity: busy ? 0.7 : 1 }}>
                  {phase === 'form'
                    ? (step < 3 ? <>Next <ChevronRight size={15} /></> : <><Pencil size={15} /> Write my free script</>)
                    : (step < 6 ? <>Next <ChevronRight size={15} /></> : <><Sparkles size={15} /> Create video · {cost} cr</>)}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:760px){.sm-rail{display:none!important}}`}</style>
    </div>,
    document.body
  )
}

// ── The winning ad being remade (top of step 1) ──
function SourceCard({ sourceVideoUrl, sourcePoster, hasSource }: { sourceVideoUrl?: string | null; sourcePoster?: string | null; hasSource: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: '#fcfdfb', border: `1px solid ${L_LINE}`, borderRadius: 14, padding: '12px 14px', marginBottom: 18 }}>
      <div style={{ width: 60, height: 74, borderRadius: 10, flexShrink: 0, overflow: 'hidden', position: 'relative', background: 'linear-gradient(160deg,#dfe5dd,#c4cec2)' }}>
        {sourcePoster
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={cdn(sourcePoster)} alt="source ad" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22 }}>🎬</span>}
        <span style={{ position: 'absolute', bottom: 4, left: 4, right: 4, background: 'rgba(23,37,28,0.85)', color: LIME, fontSize: 7.5, fontWeight: 800, textAlign: 'center', borderRadius: 5, padding: '2px 0', letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}><Trophy size={8} /> WINNING</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{hasSource ? 'The winning ad you’re remaking' : 'Your video'}</div>
        <div style={{ fontSize: 11.5, color: L_MUTED, marginTop: 2, lineHeight: 1.5 }}>We keep its <b style={{ color: L_INK }}>pacing, hook &amp; vibe</b> and swap in <b style={{ color: L_INK }}>your product</b> — you approve the script before any credits are spent.</div>
      </div>
    </div>
  )
}

function Switch({ on }: { on: boolean }) {
  return (
    <span style={{ width: 38, height: 22, borderRadius: 99, background: on ? '#5f9032' : '#dfe5dd', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 2.5, left: on ? 18 : 3, width: 17, height: 17, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .15s' }} />
    </span>
  )
}

// ── light-theme tokens + primitives ──
const L_INK = '#161c17', L_MUTED = '#68756b', L_FAINT = '#94a096', L_LINE = '#e7ece7', L_SIDE = '#f6f8f5'
const FOREST = '#17251c', SEL_BG = '#f4fbe6', SEL_BORDER = '#a8cf6f', SEL_TEXT = '#2c4a1f', GREEN = '#3f8f4f'
const HEADER_BG = 'radial-gradient(90% 200% at 100% 0%, #fdf3cf 0%, transparent 50%),radial-gradient(80% 160% at 0% 30%, #e3f9d6 0%, transparent 55%),linear-gradient(120deg,#f6fceb,#f0fae2 45%,#edf8ee)'

function Kicker({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: GREEN, textTransform: 'uppercase', marginBottom: 6 }}>{children}</div> }
function H2({ children }: { children: React.ReactNode }) { return <h2 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.015em', margin: '0 0 6px' }}>{children}</h2> }
function Lead({ children }: { children: React.ReactNode }) { return <p style={{ fontSize: 13.5, color: L_MUTED, lineHeight: 1.6, maxWidth: 560, margin: '0 0 20px' }}>{children}</p> }
function FieldLabel({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 12.5, fontWeight: 700, color: '#3c473e', marginBottom: 6 }}>{children}</div> }
function InfoBar({ children }: { children: React.ReactNode }) { return <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 13px', fontSize: 12.5, color: SEL_TEXT, lineHeight: 1.55, marginTop: 18 }}>{children}</div> }
function ReviewRow({ k, v, onEdit, last }: { k: string; v: string; onEdit?: () => void; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '11px 16px', fontSize: 13, borderBottom: last ? 'none' : '1px solid #f1f4f0' }}>
      <span style={{ color: L_MUTED }}>{k}</span>
      <span style={{ fontWeight: 650, textAlign: 'right' }}>{v}{onEdit && <button onClick={onEdit} style={{ fontSize: 11, color: GREEN, fontWeight: 700, marginLeft: 8, cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit' }}>change</button>}</span>
    </div>
  )
}
const input: React.CSSProperties = { background: '#fff', border: `1.5px solid ${L_LINE}`, borderRadius: 12, padding: '11px 14px', color: L_INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }
const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1.5px solid ${L_LINE}`, color: '#3c473e', borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: FOREST, color: LIME, border: 'none', borderRadius: 12, padding: '11px 20px', fontSize: 14, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }
const photoAdd: React.CSSProperties = { width: 88, height: 88, borderRadius: 13, border: '1.5px dashed #c4d0c2', background: '#fcfdfb', color: GREEN, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const errBox: React.CSSProperties = { background: '#fef2f2', border: '1px solid #fecaca', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }
const noticeBox: React.CSSProperties = { background: SEL_BG, border: '1px solid #d8ebb9', color: SEL_TEXT, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5 }
const priceTag: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: SEL_TEXT, background: '#fff', border: `1px solid ${L_LINE}`, borderRadius: 99, padding: '3px 10px', whiteSpace: 'nowrap' }
const toggleRow = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 10, border: `1.5px solid ${on ? SEL_BORDER : L_LINE}`, background: on ? SEL_BG : '#fff', borderRadius: 14, padding: '13px 15px', cursor: 'pointer' })
const chip = (on: boolean): React.CSSProperties => ({ background: on ? FOREST : '#fff', color: on ? LIME : '#333d35', border: `1.5px solid ${on ? FOREST : L_LINE}`, borderRadius: 99, padding: '9px 15px', fontSize: 13, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' })
const chipDashed = (on: boolean): React.CSSProperties => ({ ...chip(on), borderStyle: 'dashed', color: GREEN, borderColor: SEL_BORDER })
