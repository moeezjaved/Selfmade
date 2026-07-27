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
import { useEffect, useState } from 'react'
import { Loader2, Film, Download, Wand2, Play } from 'lucide-react'
import { useCredits, confirmCredits, refreshCredits } from '@/components/credits/CreditCounter'

const FOREST = '#17251c', LIME = '#dffe95', INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', GREEN = '#3f8f4f'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
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
  const [style, setStyle] = useState<'ugc' | 'cinematic'>('ugc')   // Cinematic is gated (coming soon) — UGC ships
  const [language, setLanguage] = useState('en')
  const [voice, setVoice] = useState('nova')
  // Parity with the old video modal — these feed the analysis/generation, so keep collecting them.
  const [productName, setProductName] = useState('')
  const [benefit, setBenefit] = useState('')
  const [look, setLook] = useState('match')   // recast the on-camera person (default: keep original)
  const [jobId, setJobId] = useState<string | null>(null)
  // Cinematic is gated "coming soon" for everyone EXCEPT a testing flag (?cinematic=1) — lets the
  // founder A/B the Remotion-assembled cinematic result while it stays hidden for other users.
  const [cineOn, setCineOn] = useState(false)
  const [srcScenes, setSrcScenes] = useState(3)   // analyzed scene count, used for cinematic cost + approve
  useEffect(() => { try { if (new URLSearchParams(window.location.search).get('cinematic') === '1') setCineOn(true) } catch {} }, [])
  const [script, setScript] = useState('')
  const [srcSecs, setSrcSecs] = useState<number | null>(null)
  const [bucket, setBucket] = useState<'15' | '30' | '60' | 'match'>('15')
  const [progress, setProgress] = useState<{ label?: string; pct?: number; eta_sec?: number } | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rescripting, setRescripting] = useState(false)

  const isService = brandType === 'service'
  const resolvedBucket = bucket === 'match' ? ((srcSecs || 15) <= 22 ? 15 : (srcSecs || 15) <= 45 ? 30 : 60) : Number(bucket)
  const nSegs = resolvedBucket >= 60 ? 4 : resolvedBucket >= 30 ? 2 : 1
  // Cinematic is priced per scene (video_clone_xN); UGC per 15s clip. Actual charge is server-side.
  const cost = style === 'cinematic' ? 600 * Math.max(2, srcScenes) : (nSegs > 1 ? 600 * nSegs : 600)

  // Speaking-time meter — same per-language rates as the old modal. Longer than the target = talks fast.
  const RATE: Record<string, number> = { en: 2.3, ur: 2.0, hi: 2.1, ar: 1.8, es: 2.6, fr: 2.4, de: 2.2 }
  const words = script.trim() ? script.trim().split(/\s+/).length : 0
  const spokenSecs = words ? Math.round(words / (RATE[language] || 2.3)) : 0
  const overLength = spokenSecs > 0 && spokenSecs > resolvedBucket + 2   // script won't fit the chosen length

  // Pick a length → re-pace the script to fill/trim to that many seconds (free, like the old modal).
  async function pickLength(b: '15' | '30' | '60' | 'match') {
    setBucket(b)
    if (!script.trim() || rescripting) return
    const target = b === 'match' ? ((srcSecs || 15) <= 22 ? 15 : (srcSecs || 15) <= 45 ? 30 : 60) : Number(b)
    setRescripting(true)
    try {
      const r = await fetch('/api/discovery/clone-video/rescript', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ script, targetSecs: target, language }),
      }).then(x => x.json())
      if (r.script) setScript(r.script)
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
        body: JSON.stringify({ sourceAdId, sourceVideoUrl: sourceVideoUrl || undefined, brandId: brandId || undefined, productImages, tier: 'premium', productType: brandType || 'physical', language, voice,
          characterLook: look !== 'match' ? look : undefined,
          productDetails: { name: productName.trim() || undefined, benefit: benefit.trim() || undefined } }),
      }).then(r => r.json())
      if (!start.jobId) { setErr(start.error === 'insufficient_credits' ? 'Not enough credits.' : (start.error || 'Couldn’t start the script.')); setPhase('setup'); return }
      setJobId(start.jobId)
      const st = await pollUntil(start.jobId, 'analyzing', 400_000)
      if (st.timedOut) { setErr('The script is taking longer than usual — try again in a moment.'); setPhase('setup'); return }
      if (st.error) { setErr(st.error); setPhase('setup'); return }
      let drafted = st.script || ''
      setSrcSecs(Number(st.sourceSeconds) || null)
      setSrcScenes(Math.max(2, Math.min(10, Number(st.sceneCount) || 3)))
      // The drafted UGC script is often paced to the source's slow rate → one short line. Auto-fill it
      // to the default length (15s) so the review screen shows a real, full-length script, not a stub.
      try {
        const target = 15
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
      const ap = await fetch('/api/discovery/clone-video/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, script, mode: cinematic ? 'faithful' : 'ugc', durationBucket: bucket, sceneCount: cinematic ? Math.max(2, srcScenes) : nSegs, overlays: [], extraLangs: [], endCard: null, hookVariants: false }),
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
          <div style={{ marginBottom: 16 }}>
            <div style={label}>Style</div>
            <div style={pillRow}>
              <button onClick={() => setStyle('ugc')} style={pill(style === 'ugc')}>UGC</button>
              {cineOn
                ? <button onClick={() => setStyle('cinematic')} style={pill(style === 'cinematic')}>Cinematic · testing</button>
                : <button disabled title="Coming soon" style={{ ...pill(false), cursor: 'default', opacity: 0.6 }}>Cinematic · soon</button>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>UGC = a creator-style talking video.{cineOn ? ' Cinematic = scene-by-scene, assembled with Remotion (transitions + brand frame).' : ' Cinematic (scene-by-scene) is coming soon.'}</div>
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

          <button onClick={writeScript} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: LIME, color: FOREST, border: 'none', borderRadius: 100, padding: '13px 24px', fontSize: 14.5, fontWeight: 850, cursor: 'pointer', fontFamily: 'inherit' }}>
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
          <div style={label}>Your script <span style={{ color: '#aab0a6', fontWeight: 600 }}>· edit anything{spokenSecs ? ` · about ${spokenSecs}s of speech` : ''}</span></div>
          <textarea value={script} onChange={e => setScript(e.target.value)} rows={6} style={{ ...field, resize: 'vertical', lineHeight: 1.6, minHeight: 130 }} />
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
          <button onClick={render} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '13px 24px', fontSize: 14.5, fontWeight: 850, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Film size={16} /> Create video · {cost} credits
          </button>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>Credits are only spent now — refunded automatically if the render fails.</div>
          {/* Storyboard-before-generation: shape the plan scene-by-scene before spending. Same free review, richer. */}
          {jobId && (
            <a href={`/studio/storyboard?jobId=${jobId}`} style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, color: GREEN, fontWeight: 800, textDecoration: 'none' }}>
              ✎ Edit scene-by-scene in the storyboard →
            </a>
          )}
        </div>
      )}

      {/* RENDERING — live progress */}
      {phase === 'rendering' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: INK, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            <Loader2 size={18} className="spin" color={GREEN} /> {progress?.label || 'Rendering your video…'}{progress?.eta_sec ? ` · ~${Math.ceil((progress.eta_sec || 0) / 60)} min` : ''}
          </div>
          <div style={{ height: 8, borderRadius: 100, background: '#eef2ec', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(6, Math.min(98, progress?.pct || 8))}%`, background: GREEN, borderRadius: 100, transition: 'width .6s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>You can leave this open — it also lands in My Creatives when it’s ready.</div>
        </div>
      )}

      {/* DONE — the video */}
      {phase === 'done' && videoUrl && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 10 }}>Your video is ready.</div>
          <video src={videoUrl} controls playsInline poster={sourcePoster || undefined} style={{ width: 300, maxWidth: '100%', borderRadius: 14, border: `1px solid ${LINE}`, background: '#0d120e', display: 'block' }} />
          <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
            <a href={videoUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: FOREST, color: LIME, borderRadius: 100, padding: '11px 20px', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}><Download size={15} /> Download</a>
            <button onClick={() => { setPhase('setup'); setVideoUrl(null); setScript(''); setJobId(null); setErr(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '11px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}><Play size={15} /> Another</button>
            {jobId && (
              <a href={`/studio/editor?jobId=${jobId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '11px 18px', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}><Wand2 size={15} /> Edit &amp; export</a>
            )}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>Open the editor to change captions, CTA, logo or aspect — free — and export to every platform.</div>
        </div>
      )}

      {err && <div style={{ marginTop: 12, fontSize: 13, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 12px', maxWidth: 460 }}>{err}</div>}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
