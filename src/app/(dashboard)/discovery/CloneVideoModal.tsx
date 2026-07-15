'use client'
/**
 * Clone-this-ad-as-video modal, WITH a script-approval gate (no credits spent until the user approves).
 * Flow: pick brand + product photos → "Analyse & write script" (free) → the pipeline drafts a script →
 * user reviews/edits it → "Approve & generate" (spends credits) → Seedance renders → shows the clip.
 * Async throughout: POST start → poll to status='review' → POST approve → poll to 'done'.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Loader2, Check, Film, Sparkles, Pencil } from 'lucide-react'
import CloneGeneration from '@/components/motion/CloneGeneration'
import { refreshCredits } from '@/components/credits/CreditCounter'

const LIME = '#dffe95'
type Photo = { id: string; src: string }
// Proxy external product URLs (hotlink-protected → raw <img> breaks). data:/R2 pass through.
const cdn = (u: string) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? u : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=160&q=72&output=webp`
type Brand = { id: string; name: string; products?: { image_urls?: string[] }[] }
type Phase = 'form' | 'analyzing' | 'review' | 'generating' | 'done'
const uid = () => Math.random().toString(36).slice(2)
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function CloneVideoModal({ sourceAdId, sourceVideoUrl, sourcePoster, onClose }: { sourceAdId: string; sourceVideoUrl?: string | null; sourcePoster?: string | null; onClose: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
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
  const [suggestedMode, setSuggestedMode] = useState<'ugc' | 'faithful'>('ugc')
  const [sceneCount, setSceneCount] = useState(2)
  const [durationBucket, setDurationBucket] = useState<'15' | '30' | '60' | 'match'>('15')
  const [srcSecs, setSrcSecs] = useState<number | null>(null)
  // Add-ons (each billed as its own tx; a failed add-on refunds itself, the base video still ships)
  const [extraLangs, setExtraLangs] = useState<string[]>([])   // faithful only · +200 cr each
  const [ecOn, setEcOn] = useState(false)                      // branded end-card · +50 cr
  const [ecOffer, setEcOffer] = useState('')
  const [ecCta, setEcCta] = useState('Shop now')
  const [hooksOn, setHooksOn] = useState(false)                // 3 hook variants · +800 cr (faithful)

  const [phase, setPhase] = useState<Phase>('form')
  const [jobId, setJobId] = useState<string | null>(null)
  const [draftScript, setDraftScript] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)   // non-error info (e.g. still rendering)
  const [result, setResult] = useState<{ url: string; script?: string | null } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // UGC = one clip; Faithful = scene-by-scene + stitch, priced by scene count (credit_pricing
  // video_clone_xN rows — keep these numbers in sync with that table).
  // 1 credit = 1¢. Kept in sync with credit_pricing (migration 095): video is cost-plus (2× fal).
  const UGC_COST = { premium: 650, fast: 300 } as const
  const FAITHFUL_COST: Record<number, { premium: number; fast: number }> = { 2: { premium: 1300, fast: 550 }, 3: { premium: 1900, fast: 800 }, 4: { premium: 2500, fast: 1100 } }
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
  const targetSecs = mode === 'faithful' ? sceneCount * 8 : resolvedBucket
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
    const cacheKey = `${voice}|${sentence}`
    setPreviewing(true); setErr(null)
    try {
      let url = previewCache.current.get(cacheKey)
      if (!url) {
        const r = await fetch('/api/discovery/clone-video/voice-preview', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: sentence, voice }),
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
    setBrandId(b.id); if (!productName) setProductName(b.name)
    const imgs = (b.products || []).flatMap((p) => p.image_urls || []).slice(0, 8)
    const ph = imgs.map((u) => ({ id: uid(), src: u }))
    setPhotos(ph); setSelected(ph.slice(0, 3).map((p) => p.id))
  }
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const arr = await Promise.all(Array.from(files).slice(0, 6).map(async (f) => ({ id: uid(), src: await fileToDataUrl(f) })))
    setPhotos((p) => [...p, ...arr]); setSelected((s) => Array.from(new Set([...s, ...arr.map((a) => a.id)])).slice(0, 4))
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
      if (st.error) return { error: st.error }
      if (st.status && st.status !== leave) return st
    }
    return { timedOut: true }
  }

  // Phase 1: analyse + draft script (free)
  const analyse = async () => {
    setErr(null)
    const chosen = photos.filter((p) => selected.includes(p.id)).map((p) => p.src)
    if (chosen.length === 0) { setErr('Add & select at least one product photo to swap in.'); return }
    setPhase('analyzing')
    try {
      const start = await fetch('/api/discovery/clone-video', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceAdId, sourceVideoUrl: sourceVideoUrl || undefined, brandId: brandId || undefined, productImages: chosen, tier,
          characterLook: look !== 'match' ? look : undefined, language, voice,
          productDetails: { name: productName.trim() || undefined, benefit: benefit.trim() || undefined } }),
      }).then(r => r.json())
      if (!start.jobId) { setErr(start.error || 'Could not start.'); setPhase('form'); return }
      setJobId(start.jobId)
      const st = await pollUntil(start.jobId, 'analyzing', 400_000)   // wait for 'review'
      if (st.timedOut) { setErr('Analysis is taking longer than usual — try again in a moment.'); setPhase('form'); return }
      if (st.error) { setErr(st.error); setPhase('form'); return }
      setDraftScript(st.script || '')
      setGloss(st.gloss || null)
      const sug = st.suggestedMode === 'faithful' ? 'faithful' : 'ugc'
      setSuggestedMode(sug); setMode(sug)
      setSceneCount(Math.min(4, Math.max(2, Number(st.sceneCount) || 2)))
      setSrcSecs(Number(st.sourceSeconds) || null)
      setPhase('review')
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('form') }
  }

  // Phase 2: approve (spend credits) + generate
  const approve = async () => {
    if (!jobId) return
    setErr(null); setNotice(null); setPhase('generating')
    try {
      const ap = await fetch('/api/discovery/clone-video/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId, script: draftScript, mode, durationBucket,
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
      setResult({ url: st.url, script: st.script }); setPhase('done')
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('review') }
  }

  if (!mounted) return null
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(3,6,4,.72)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '4vh 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: (phase === 'done') ? 900 : 560, background: '#0d130e', border: '1px solid #22331c', borderRadius: 18, overflow: 'hidden', display: (phase === 'done') ? 'grid' : 'block', gridTemplateColumns: (phase === 'done') ? '1fr 1fr' : undefined }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', borderBottom: '1px solid #1c2a17' }}>
            <Film size={17} color={LIME} /> <span style={{ fontSize: 16, fontWeight: 800, color: '#eaf6e6' }}>Clone as video ad</span>
            <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7a8a7e', cursor: 'pointer' }}><X size={18} /></button>
          </div>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '80vh', overflow: 'auto' }}>

            {/* ── GENERATING: the money-moment wait animation ── */}
            {phase === 'generating' ? (
              <CloneGeneration helper="Rendering your video · this can take a few minutes · keep browsing" />
            ) : phase === 'review' ? (
              <>
                <div style={{ fontSize: 12.5, color: '#8aa', background: '#101b12', border: '1px solid #22331c', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Pencil size={14} color={LIME} /> Review the script before we spend credits. Edit anything — the video says exactly this.
                </div>

                {/* Clone mode — suggested from the analysis. Faithful = scene-by-scene recreation of a
                    multi-scene / B-roll ad; UGC = one talking-head creator. */}
                <section>
                  <Label>Clone style</Label>
                  {suggestedMode === 'faithful' && (
                    <div style={{ fontSize: 11.5, color: '#cfe3b8', background: '#141f10', border: '1px solid #2c4030', borderRadius: 8, padding: '7px 10px', marginBottom: 8 }}>
                      🎬 This ad is cinematic / B-roll style — a scene-by-scene Cinematic clone will match it much better than a talking head.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setMode('faithful')} style={tierBtn(mode === 'faithful')}>
                      Cinematic · {sceneCount} scenes · {(FAITHFUL_COST[sceneCount] || FAITHFUL_COST[2])[tier]} cr{suggestedMode === 'faithful' ? ' ★' : ''}
                    </button>
                    <button onClick={() => setMode('ugc')} style={tierBtn(mode === 'ugc')}>
                      UGC creator · 1 clip · {UGC_COST[tier]} cr{suggestedMode === 'ugc' ? ' ★' : ''}
                    </button>
                  </div>
                  <p style={{ fontSize: 10.5, color: '#6f7f73', margin: '6px 0 0' }}>{mode === 'faithful' ? 'Recreates the ad\'s scenes (b-roll, lifestyle, product shots) with your product, then stitches them — longer render, closest to the original.' : 'One creator speaks your script to camera — fastest and cheapest.'}</p>
                </section>

                {/* Length buckets (UGC only): 15s = classic single clip; 30/60s = frame-chained
                    segments stitched into one take. 'Match original' auto-picks the nearest bucket. */}
                {mode === 'ugc' && (
                  <section>
                    <Label>Video length</Label>
                    {(() => {
                      // A clone can't be LONGER than the source — cap the offered buckets to the
                      // source's own length so a 14s ad can't be stretched to 30/60s.
                      const cap = srcSecs ? (srcSecs <= 22 ? 15 : srcSecs <= 45 ? 30 : 60) : 60
                      const lenBtn = (v: '15' | '30' | '60', secs: number, label: string) => {
                        const disabled = secs > cap
                        return <button key={v} onClick={() => !disabled && setDurationBucket(v)} disabled={disabled}
                          style={{ ...tierBtn(durationBucket === v), opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                          title={disabled ? `Longer than the ${srcSecs}s source — a clone matches the original length` : ''}>{label}</button>
                      }
                      const matchCost = cap === 15 ? UGC_COST[tier] : (FAITHFUL_COST[cap === 60 ? 4 : 2] || FAITHFUL_COST[2])[tier]
                      return (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {lenBtn('15', 15, `15s · ${UGC_COST[tier]} cr`)}
                          {lenBtn('30', 30, `30s · ${FAITHFUL_COST[2][tier]} cr`)}
                          {lenBtn('60', 60, `60s · ${FAITHFUL_COST[4][tier]} cr`)}
                          {srcSecs ? <button onClick={() => setDurationBucket('match')} style={tierBtn(durationBucket === 'match')}>Match original ({srcSecs}s) · {matchCost} cr</button> : null}
                        </div>
                      )
                    })()}
                    {srcSecs ? <p style={{ fontSize: 10.5, color: '#6f7f73', margin: '6px 0 0' }}>Source is {srcSecs}s — a clone matches the original length (longer options are disabled).{nSegs > 1 ? ` ${nSegs} chained clips stitched into one take.` : ''}</p>
                      : nSegs > 1 ? <p style={{ fontSize: 10.5, color: '#6f7f73', margin: '6px 0 0' }}>{nSegs} chained clips of the same creator, stitched into one take — cuts land at natural pauses, like real UGC.</p> : null}
                  </section>
                )}

                <section>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Label>{mode === 'faithful' ? 'Voiceover (one continuous narration)' : 'Voiceover script'}{language !== 'en' ? ` · ${(LANGS.find(l => l.code === language) || LANGS[0]).label}` : ''}</Label>
                    {/* 🔊 Audition the narrator on the first sentence — free, before approving. */}
                    <button onClick={previewVoice} disabled={previewing || !draftScript.trim()} style={{ ...chip(false), padding: '4px 11px', opacity: previewing ? 0.6 : 1 }}>
                      {previewing ? '🔊 Playing…' : '🔊 Hear the voice'}
                    </button>
                  </div>
                  <textarea value={draftScript} onChange={(e) => setDraftScript(e.target.value)} rows={7} dir={langCfg.rtl ? 'rtl' : 'ltr'}
                    style={{ ...input, width: '100%', resize: 'vertical', lineHeight: langCfg.rtl ? 1.9 : 1.5, fontSize: langCfg.rtl ? 15 : 13 }} />
                  {gloss && language !== 'en' && (
                    <div style={{ fontSize: 11, color: '#8fa596', marginTop: 6, fontStyle: 'italic' }}>In English: “{gloss}”</div>
                  )}
                  {/* Speaking-time meter. In FAITHFUL mode the narration is our TTS at a natural pace and
                      the video extends to fit it (closing shot holds) — so a long script is never
                      "rushed", it just adds hold time. In UGC mode Seedance crams words into a fixed
                      clip, so length genuinely matters — that's the only mode that warns about rushing. */}
                  {words > 0 && (
                    mode === 'faithful' ? (
                      <div style={{ fontSize: 11, marginTop: 6, color: '#9fb0a4' }}>
                        {words} words ≈ {spokenSecs}s of narration · ~{targetSecs}s of scenes{spokenSecs > targetSecs + 4 ? ' — the closing shot holds while the voiceover finishes. Trim for a tighter cut, or leave it.' : ' — fits nicely.'}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, marginTop: 6, color: spokenSecs > targetSecs + 4 ? '#ffb4b4' : spokenSecs > targetSecs ? '#f5d78e' : '#9fb0a4' }}>
                        {words} words ≈ {spokenSecs}s spoken · target ~{targetSecs}s{spokenSecs > targetSecs + 4 ? ' — too long, the delivery will feel rushed. Trim it, or pick a longer length above.' : spokenSecs > targetSecs ? ' — a touch long; consider trimming.' : ' — fits comfortably.'}
                      </div>
                    )
                  )}
                </section>
                {/* ── Power-ups: each is its own charge; if one fails it refunds itself and the base
                    video still delivers. ── */}
                <section style={{ borderTop: '1px solid #1c2a17', paddingTop: 14 }}>
                  <Label>Power-ups <span style={{ color: '#5f6f63', fontWeight: 400 }}>· optional</span></Label>

                  {mode === 'faithful' && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, color: '#9fb0a4', marginBottom: 6 }}>🌍 Also generate in <span style={{ color: '#5f6f63' }}>· +200 cr each · same video, native voiceover</span></div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {LANGS.filter((l) => l.code !== language).slice(0, 6).map((l) => {
                          const on = extraLangs.includes(l.code)
                          return <button key={l.code} onClick={() => setExtraLangs((prev) => on ? prev.filter((x) => x !== l.code) : prev.length >= 2 ? prev : [...prev, l.code])} style={chip(on)}>{l.label}</button>
                        })}
                      </div>
                      {extraLangs.length > 0 && <div style={{ fontSize: 10.5, color: '#6f7f73', marginTop: 5 }}>Each arrives as its own ad in My Creatives.</div>}
                    </div>
                  )}

                  <div style={{ marginBottom: 12 }}>
                    <button onClick={() => setEcOn(!ecOn)} style={{ ...chip(ecOn), width: '100%', textAlign: 'left' }}>🏷 Branded end-card · +50 cr {ecOn ? '✓' : ''}</button>
                    {ecOn && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <input value={ecOffer} onChange={(e) => setEcOffer(e.target.value)} placeholder="Offer (e.g. Buy 2 Get 1 Free)" style={{ ...input, flex: 2 }} />
                        <input value={ecCta} onChange={(e) => setEcCta(e.target.value)} placeholder="CTA" style={{ ...input, flex: 1 }} />
                      </div>
                    )}
                  </div>

                  {mode === 'faithful' && (
                    <button onClick={() => setHooksOn(!hooksOn)} style={{ ...chip(hooksOn), width: '100%', textAlign: 'left' }}>⚡ 3 hook variants · +800 cr {hooksOn ? '✓' : ''} <span style={{ color: hooksOn ? '#14281a' : '#5f6f63', fontWeight: 400 }}>— same ad, 3 different openings to A/B test</span></button>
                  )}
                </section>

                {notice && <div style={noticeBox}>{notice} <a href="/creative-studio" style={{ color: LIME, fontWeight: 700 }}>Open My Creatives →</a></div>}
                {err && <div style={errBox}>{err}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setPhase('form')} style={{ ...tierBtn(false), flex: '0 0 auto', padding: '11px 14px' }}>← Back</button>
                  <button onClick={approve} disabled={busy || !draftScript.trim()} style={{ ...btnPrimary, flex: 1, opacity: (busy || !draftScript.trim()) ? 0.7 : 1 }}>
                    <Sparkles size={16} /> Approve &amp; generate · {cost} cr
                  </button>
                </div>
                <p style={{ fontSize: 11, color: '#6f7f73', margin: 0 }}>Credits are charged now. Takes a few minutes — it also appears in <b style={{ color: '#cfe' }}>My Creatives</b>.</p>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12.5, color: '#8aa', lineHeight: 1.5, background: '#101b12', border: '1px solid #22331c', borderRadius: 10, padding: '10px 12px' }}>
                  {sourcePoster && /* eslint-disable-next-line @next/next/no-img-element */ <img src={sourcePoster} alt="" style={{ width: 44, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                  <span>We keep this winning ad’s <b style={{ color: LIME }}>pacing, hook &amp; vibe</b> and swap in <b style={{ color: LIME }}>your product</b> — you approve the script before any credits are spent.</span>
                </div>

                {brands.length > 0 && (
                  <section>
                    <Label>Your brand</Label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {brands.map((b) => <button key={b.id} onClick={() => pickBrand(b)} style={chip(brandId === b.id)}>{b.name}</button>)}
                    </div>
                  </section>
                )}

                <section>
                  <Label>Product photos · pick up to 4</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {photos.map((p) => {
                      const on = selected.includes(p.id)
                      return (
                        <button key={p.id} onClick={() => toggleSel(p.id)} style={{ position: 'relative', width: 74, height: 74, borderRadius: 10, overflow: 'hidden', border: on ? `2px solid ${LIME}` : '2px solid #263', background: '#0a0f0c', cursor: 'pointer', padding: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={cdn(p.src)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {on && <span style={{ position: 'absolute', top: 3, right: 3, background: LIME, color: '#14281a', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} strokeWidth={3} /></span>}
                        </button>
                      )
                    })}
                    <button onClick={() => fileRef.current?.click()} style={{ width: 74, height: 74, borderRadius: 10, border: '2px dashed #2c4030', background: '#0a0f0c', color: '#7a8a7e', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 10 }}>
                      <Upload size={16} /> Upload
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
                  </div>
                </section>

                <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Label>Product details <span style={{ color: '#5f6f63', fontWeight: 400 }}>· optional, sharpens the script</span></Label>
                  <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Product name" style={input} />
                  <input value={benefit} onChange={(e) => setBenefit(e.target.value)} placeholder="Key benefit / hook (e.g. removes stains in one wipe)" style={input} />
                </section>

                <section>
                  <Label>On-camera creator <span style={{ color: '#5f6f63', fontWeight: 400 }}>· match the ad, or recast</span></Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {LOOKS.map((l) => (
                      <button key={l} onClick={() => setLook(l)} style={chip(look === l)}>{l === 'match' ? 'Match original' : l}</button>
                    ))}
                  </div>
                  {/* Pairing nudge: picked Pakistani → offer Urdu, one tap. Suggests, never forces. */}
                  {PAIR[look] && language === 'en' && (
                    <button onClick={() => setLanguage(PAIR[look].code)} style={{ ...chip(false), marginTop: 8, border: `1px dashed ${LIME}`, background: '#141f10', color: LIME }}>
                      {PAIR[look].flag} Speak {PAIR[look].name}?
                    </button>
                  )}
                </section>

                <section>
                  <Label>Script &amp; voiceover language</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {LANGS.map((l) => (
                      <button key={l.code} onClick={() => setLanguage(l.code)} style={chip(language === l.code)}>{l.label}</button>
                    ))}
                  </div>
                  {language !== 'en' && <p style={{ fontSize: 10.5, color: '#6f7f73', margin: '6px 0 0' }}>Written natively like a local creator would talk — not translated. You review it (with an English summary) before spending credits.</p>}
                </section>

                <section>
                  <Label>Narration voice <span style={{ color: '#5f6f63', fontWeight: 400 }}>· you can preview it before approving</span></Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {VOICES.map((v) => (
                      <button key={v.id} onClick={() => setVoice(v.id)} style={chip(voice === v.id)}>{v.label}</button>
                    ))}
                  </div>
                </section>

                {err && <div style={errBox}>{err}</div>}
                {phase === 'analyzing' && <div style={{ fontSize: 12, color: LIME, display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} className="spin" /> Analysing the ad &amp; writing your script… (free — no credits yet)</div>}
                <button onClick={analyse} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
                  {phase === 'analyzing' ? <><Loader2 size={16} className="spin" /> Writing script…</> : <><Pencil size={16} /> Analyse &amp; write script · free</>}
                </button>
                <p style={{ fontSize: 11, color: '#6f7f73', margin: 0 }}>You’ll review &amp; edit the script before any credits are spent.</p>
              </>
            )}
          </div>
        </div>

        {phase === 'done' && result && (
          <div style={{ borderLeft: '1px solid #1c2a17', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, background: '#080c09', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 320 }}>
              <video src={result.url} controls autoPlay loop playsInline style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 8 }} />
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.script && <div style={{ fontSize: 12, color: '#9fb0a4', background: '#0a0f0c', border: '1px solid #24331d', borderRadius: 9, padding: '10px 12px', maxHeight: 120, overflow: 'auto' }}><b style={{ color: '#cfe' }}>Script:</b> {result.script}</div>}
              <a href={result.url} download style={{ ...btnPrimary, textDecoration: 'none', justifyContent: 'center' }}>Download</a>
              <p style={{ fontSize: 11.5, color: '#8aa', margin: 0 }}>Saved in <b style={{ color: '#cfe' }}>My Creatives</b>.</p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function Label({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 12, fontWeight: 700, color: '#9fb0a4', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div> }
const input: React.CSSProperties = { background: '#0a0f0c', border: '1px solid #24331d', borderRadius: 9, padding: '9px 11px', color: '#e8f0e8', fontSize: 13, fontFamily: 'inherit', outline: 'none' }
const errBox: React.CSSProperties = { background: '#2a1416', border: '1px solid #5a2a2e', color: '#ffb4b4', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }
const noticeBox: React.CSSProperties = { background: '#141f10', border: '1px solid #2c4030', color: '#cfe3b8', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5 }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: LIME, color: '#14281a', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? LIME : '#16241a', color: on ? '#14281a' : '#cfe', border: `1px solid ${on ? LIME : '#2c4030'}`, borderRadius: 20, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
const tierBtn = (on: boolean): React.CSSProperties => ({ flex: 1, background: on ? '#1c3322' : '#0a0f0c', color: on ? LIME : '#9fb0a4', border: `1px solid ${on ? LIME : '#24331d'}`, borderRadius: 9, padding: '9px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
