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
  const [tier, setTier] = useState<'premium' | 'fast'>('premium')

  const [phase, setPhase] = useState<Phase>('form')
  const [jobId, setJobId] = useState<string | null>(null)
  const [draftScript, setDraftScript] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; script?: string | null } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const cost = tier === 'premium' ? 400 : 250
  const busy = phase === 'analyzing' || phase === 'generating'

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

  // Poll a job until it leaves the given "waiting" status. Returns the final status payload.
  const pollUntil = async (id: string, leave: string): Promise<any> => {
    for (let i = 0; i < 200; i++) {
      await sleep(4000)
      const st = await fetch(`/api/discovery/clone-video/status?id=${id}`).then(r => r.json()).catch(() => ({}))
      if (st.error) return { error: st.error }
      if (st.status && st.status !== leave) return st
    }
    return { error: 'timed out — check My Creatives shortly' }
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
          productDetails: { name: productName.trim() || undefined, benefit: benefit.trim() || undefined } }),
      }).then(r => r.json())
      if (!start.jobId) { setErr(start.error || 'Could not start.'); setPhase('form'); return }
      setJobId(start.jobId)
      const st = await pollUntil(start.jobId, 'analyzing')   // wait for 'review'
      if (st.error) { setErr(st.error); setPhase('form'); return }
      setDraftScript(st.script || '')
      setPhase('review')
    } catch (e: any) { setErr(String(e?.message || e)); setPhase('form') }
  }

  // Phase 2: approve (spend credits) + generate
  const approve = async () => {
    if (!jobId) return
    setErr(null); setPhase('generating')
    try {
      const ap = await fetch('/api/discovery/clone-video/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, script: draftScript }),
      }).then(r => r.json())
      if (ap.error) { setErr(ap.error === 'insufficient_credits' ? 'Not enough credits.' : ap.error); setPhase('review'); return }
      refreshCredits()   // credits reserved on approve → drop the sidebar counter now
      const st = await pollUntil(jobId, 'processing')   // wait for 'done'
      if (st.error || !st.url) { setErr((st.error || 'generation failed') + ' — credits refunded.'); setPhase('review'); refreshCredits(); return }
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
                <section>
                  <Label>Voiceover script</Label>
                  <textarea value={draftScript} onChange={(e) => setDraftScript(e.target.value)} rows={7}
                    style={{ ...input, width: '100%', resize: 'vertical', lineHeight: 1.5 }} />
                </section>
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
                          <img src={p.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                  <Label>Quality</Label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setTier('premium')} style={tierBtn(tier === 'premium')}>Premium · 400 cr</button>
                    <button onClick={() => setTier('fast')} style={tierBtn(tier === 'fast')}>Fast · 250 cr</button>
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
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: LIME, color: '#14281a', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? LIME : '#16241a', color: on ? '#14281a' : '#cfe', border: `1px solid ${on ? LIME : '#2c4030'}`, borderRadius: 20, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
const tierBtn = (on: boolean): React.CSSProperties => ({ flex: 1, background: on ? '#1c3322' : '#0a0f0c', color: on ? LIME : '#9fb0a4', border: `1px solid ${on ? LIME : '#24331d'}`, borderRadius: 9, padding: '9px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
