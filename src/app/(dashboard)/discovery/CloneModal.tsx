'use client'
/**
 * Clone modal — "clone this winning ad with MY product".
 *
 * Flow: pick a saved brand (or add one via URL auto-detect / manual upload) → choose one or more
 * product photos → Standard/Pro → optionally opt into daily emails of new winning ads like this one
 * → Generate (Nano Banana composites the product onto the ad's winning structure) → preview, tweak
 * the headline, regenerate, download. Product photos can be the brand's saved images, images we
 * auto-detect from the brand's website, or files the user uploads (multiple, swappable).
 */
import { useEffect, useRef, useState } from 'react'
import { X, Upload, Link2, Loader2, Download, Sparkles, Check } from 'lucide-react'

type Photo = { id: string; src: string; label?: string } // src = data: URL (upload) or http URL (detected/brand)
type Brand = { id: string; name: string; website?: string | null; products?: { image_urls?: string[] }[] }

const LIME = '#dffe95'
const uid = () => Math.random().toString(36).slice(2)

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(f)
  })
}

export default function CloneModal({ ad, onClose }: { ad: { id: string; pageId: string; pageName: string }; onClose: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  const [mode, setMode] = useState<'pick' | 'new'>('pick')

  // new-brand fields
  const [bName, setBName] = useState('')
  const [bSite, setBSite] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [colors, setColors] = useState<string[]>([])
  const [saveAsBrand, setSaveAsBrand] = useState(true)

  // photos + selection (up to 4 go to the model)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])

  const [headline, setHeadline] = useState('')
  const [tier, setTier] = useState<'default' | 'pro'>('default')
  const [emailDaily, setEmailDaily] = useState(true)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [brandId, setBrandId] = useState<string | null>(null)      // selected saved brand (for linking generations)
  const [genId, setGenId] = useState<string | null>(null)          // current generation id (edit lineage)
  const fileRef = useRef<HTMLInputElement>(null)

  // Iterative edit loop (chat-style) on the generated image — each edit charges credits.
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState<string[]>([]) // previous images, for undo

  // Load the user's brands (+ quota) on open.
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/brands')
        const j = await r.json()
        const bs: Brand[] = j.brands || []
        setBrands(bs)
        if (bs.length === 0) setMode('new')
      } catch { /* non-fatal */ }
    })()
  }, [])

  const addPhotos = (list: Photo[]) => {
    setPhotos((p) => {
      const seen = new Set(p.map((x) => x.src))
      const fresh = list.filter((x) => !seen.has(x.src))
      const merged = [...p, ...fresh]
      // auto-select newly added, capped at 4 total
      setSelected((s) => Array.from(new Set([...s, ...fresh.map((f) => f.id)])).slice(0, 4))
      return merged
    })
  }

  const pickBrand = (b: Brand) => {
    setMode('pick')
    setBrandId(b.id)
    setBName(b.name); setBSite(b.website || '')
    const imgs = (b.products || []).flatMap((p) => p.image_urls || [])
    const ph = imgs.slice(0, 8).map((u) => ({ id: uid(), src: u, label: 'saved' }))
    setPhotos(ph); setSelected(ph.slice(0, 4).map((p) => p.id))
  }

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const arr = await Promise.all(Array.from(files).slice(0, 8).map(async (f) => ({ id: uid(), src: await fileToDataUrl(f), label: 'upload' })))
    addPhotos(arr)
  }

  const detect = async () => {
    if (!bSite.trim()) return
    setDetecting(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/detect-product', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: bSite.trim() }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Could not read that site — upload photos instead.'); return }
      if (j.brandName && !bName.trim()) setBName(j.brandName)
      if (Array.isArray(j.colors)) setColors(j.colors)
      addPhotos((j.images || []).map((u: string) => ({ id: uid(), src: u, label: 'detected' })))
      if (!j.images?.length) setErr('No product photos found on that page — upload manually.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setDetecting(false) }
  }

  const toggleSel = (id: string) =>
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length >= 4 ? s : [...s, id]))

  const generate = async () => {
    setErr(null)
    const chosen = photos.filter((p) => selected.includes(p.id)).map((p) => p.src)
    if (chosen.length === 0) { setErr('Add and select at least one product photo.'); return }
    setBusy(true); setResult(null)
    try {
      let useBrandId = brandId
      // If a new brand and "save" is on, persist it first (best-effort; http image URLs only).
      if (mode === 'new' && saveAsBrand && bName.trim()) {
        const httpImgs = chosen.filter((s) => /^https?:\/\//i.test(s))
        const rb = await fetch('/api/brands', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: bName.trim(), website: bSite.trim() || null, product_images: httpImgs }),
        })
        const jb = await rb.json()
        if (rb.status === 402 && jb.error === 'brand_limit_reached') {
          setBusy(false)
          setErr(`You've used all ${jb.limit} brand slots on your plan. Upgrade to save more — or uncheck "Save as brand" to clone without saving.`)
          setQuota({ used: jb.used, limit: jb.limit })
          return
        }
        if (jb.quota) setQuota(jb.quota)
        if (jb.brand?.id) { useBrandId = jb.brand.id; setBrandId(jb.brand.id) }
      }

      // Opt into daily "new winning ads like this" emails (follows the ad's brand + email alerts on).
      if (emailDaily) {
        fetch('/api/follows', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId: ad.pageId, brandName: ad.pageName, action: 'set_email', email_alerts: true }),
        }).catch(() => {})
      }

      const r = await fetch('/api/discovery/clone-image', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id, productImages: chosen, tier, brandId: useBrandId || undefined,
          brandName: bName.trim() || undefined, colors, newHeadline: headline.trim() || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErr(j.error === 'insufficient_credits' ? 'Not enough credits for this clone.'
          : j.error === 'Image generation not configured (GEMINI_API_KEY)' ? 'Clone isn’t switched on yet (missing API key).'
          : j.error || 'Generation failed — try again.')
        return
      }
      setResult(j.image); setGenId(j.generationId || null)
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setBusy(false) }
  }

  const applyEdit = async () => {
    if (!result || !editText.trim()) return
    setEditing(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/edit-image', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: result, instruction: editText.trim(), tier, parentId: genId || undefined, brandId: brandId || undefined }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErr(j.error === 'insufficient_credits' ? 'Not enough credits for this edit.' : j.error || 'Edit failed — try again.')
        return
      }
      setHistory((h) => [...h, result])   // enable undo
      setResult(j.image); setGenId(j.generationId || genId)
      setEditText('')
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setEditing(false) }
  }

  const undo = () => setHistory((h) => {
    if (!h.length) return h
    setResult(h[h.length - 1])
    return h.slice(0, -1)
  })

  const cost = tier === 'pro' ? 10 : 5
  const editCost = tier === 'pro' ? 4 : 2

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(920px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: '#0f1512', border: '1px solid #223', borderRadius: 16, color: '#e8f0e8', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1c2620', position: 'sticky', top: 0, background: '#0f1512', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700, fontSize: 16 }}>
            <Sparkles size={17} color={LIME} /> Clone this ad
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8aa', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: result ? '1fr 1fr' : '1fr', gap: 0 }}>
          {/* ── controls ── */}
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Brand */}
            <section>
              <Label>1 · Your brand</Label>
              {brands.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {brands.map((b) => (
                    <button key={b.id} onClick={() => pickBrand(b)}
                      style={chip(mode === 'pick' && bName === b.name)}>{b.name}</button>
                  ))}
                  <button onClick={() => { setMode('new'); setBrandId(null); setBName(''); setBSite(''); setPhotos([]); setSelected([]) }}
                    style={chip(mode === 'new')}>＋ New brand</button>
                </div>
              )}
              {mode === 'new' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Brand name" style={input} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={bSite} onChange={(e) => setBSite(e.target.value)} placeholder="yourstore.com — we’ll find your product"
                      onKeyDown={(e) => e.key === 'Enter' && detect()} style={{ ...input, flex: 1 }} />
                    <button onClick={detect} disabled={detecting || !bSite.trim()} style={btnGhost}>
                      {detecting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Detect
                    </button>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#9fb0a4', cursor: 'pointer' }}>
                    <input type="checkbox" checked={saveAsBrand} onChange={(e) => setSaveAsBrand(e.target.checked)} />
                    Save as a brand for reuse{quota ? ` (${quota.used}/${quota.limit === -1 ? '∞' : quota.limit} used)` : ''}
                  </label>
                </div>
              )}
            </section>

            {/* Photos */}
            <section>
              <Label>2 · Product photos <span style={{ color: '#7a8a7e', fontWeight: 500 }}>· pick up to 4</span></Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {photos.map((p) => {
                  const on = selected.includes(p.id)
                  return (
                    <button key={p.id} onClick={() => toggleSel(p.id)} title={p.label}
                      style={{ position: 'relative', width: 74, height: 74, borderRadius: 10, overflow: 'hidden', border: on ? `2px solid ${LIME}` : '2px solid #263', background: '#0a0f0c', cursor: 'pointer', padding: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: on ? 1 : 0.55 }} />
                      {on && <span style={{ position: 'absolute', top: 3, right: 3, background: LIME, color: '#14281a', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} strokeWidth={3} /></span>}
                    </button>
                  )
                })}
                <button onClick={() => fileRef.current?.click()} style={{ width: 74, height: 74, borderRadius: 10, border: '2px dashed #365', background: 'transparent', color: '#9fb0a4', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11 }}>
                  <Upload size={16} /> Upload
                </button>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
              </div>
            </section>

            {/* Headline + tier */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Label>3 · Options</Label>
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="New on-screen headline (optional)" style={input} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setTier('default')} style={tierBtn(tier === 'default')}>Standard · 5 cr</button>
                <button onClick={() => setTier('pro')} style={tierBtn(tier === 'pro')}>Pro · 10 cr</button>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#cfe', cursor: 'pointer', background: '#121c15', border: '1px solid #24331d', borderRadius: 10, padding: '10px 12px' }}>
                <input type="checkbox" checked={emailDaily} onChange={(e) => setEmailDaily(e.target.checked)} style={{ marginTop: 2 }} />
                <span>📧 <b>Email me new winning ads like this, daily</b><br /><span style={{ color: '#8aa', fontSize: 11.5 }}>Fresh top ads from {ad.pageName || 'this brand'} & its niche — 2 credits per email, cancel anytime in Settings.</span></span>
              </label>
            </section>

            {err && <div style={{ background: '#2a1416', border: '1px solid #5a2a2e', color: '#ffb4b4', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>{err}</div>}

            <button onClick={generate} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
              {busy ? <><Loader2 size={16} className="spin" /> Generating…</> : <><Sparkles size={16} /> {result ? 'Regenerate' : 'Generate clone'} · {cost} cr</>}
            </button>
          </div>

          {/* ── result + chat-style edit loop ── */}
          {result && (
            <div style={{ padding: 20, borderLeft: '1px solid #1c2620', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Label>Your cloned ad</Label>
                {history.length > 0 && (
                  <button onClick={undo} style={{ background: 'transparent', border: '1px solid #2c4030', color: '#9fb0a4', borderRadius: 8, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↶ Undo</button>
                )}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div style={{ position: 'relative' }}>
                <img src={result} alt="cloned ad" style={{ width: '100%', borderRadius: 12, border: '1px solid #223', opacity: editing ? 0.5 : 1 }} />
                {editing && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: LIME, gap: 8, fontSize: 13, fontWeight: 600 }}><Loader2 size={18} className="spin" /> Editing…</div>}
              </div>

              {/* Edit box — describe a change, each edit charges credits (Imaginetive-style). */}
              <div style={{ background: '#0a0f0c', border: '1px solid #24331d', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyEdit() }}
                  placeholder="Tweak this creative — what to change? (headline, subhead, copy, colors, scene, background…)"
                  rows={2}
                  style={{ background: 'transparent', border: 'none', color: '#e8f0e8', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#7a8a7e' }}>{editCost} credits per edit · ⌘↵ to apply</span>
                  <button onClick={applyEdit} disabled={editing || !editText.trim()} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12.5, opacity: (editing || !editText.trim()) ? 0.6 : 1 }}>
                    {editing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Apply edit · {editCost} cr
                  </button>
                </div>
              </div>

              <a href={result} download={`clone-${ad.id}.png`} style={{ ...btnPrimary, textDecoration: 'none', justifyContent: 'center' }}>
                <Download size={15} /> Download
              </a>
              <p style={{ fontSize: 11.5, color: '#8aa', margin: 0 }}>Iterate with edits above, or swap photos on the left and Regenerate for a fresh clone.</p>
            </div>
          )}
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, color: '#b8c8bc', marginBottom: 6, letterSpacing: '.01em' }}>{children}</div>
}
const input: React.CSSProperties = { background: '#0a0f0c', border: '1px solid #24331d', borderRadius: 9, padding: '9px 11px', color: '#e8f0e8', fontSize: 13, fontFamily: 'inherit', outline: 'none' }
const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: '#16241a', border: '1px solid #2c4030', color: '#cfe', borderRadius: 9, padding: '0 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: LIME, color: '#14281a', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? LIME : '#16241a', color: on ? '#14281a' : '#cfe', border: `1px solid ${on ? LIME : '#2c4030'}`, borderRadius: 20, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
const tierBtn = (on: boolean): React.CSSProperties => ({ flex: 1, background: on ? '#1c3322' : '#0a0f0c', color: on ? LIME : '#9fb0a4', border: `1px solid ${on ? LIME : '#24331d'}`, borderRadius: 9, padding: '9px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
