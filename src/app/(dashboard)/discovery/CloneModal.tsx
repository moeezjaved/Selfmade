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
import { createPortal } from 'react-dom'
import { X, Upload, Link2, Loader2, Download, Sparkles, Check } from 'lucide-react'
import { flyToCreatives } from '@/lib/flyToCreatives'

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
  const [fonts, setFonts] = useState<{ heading?: string | null; body?: string | null }>({})
  const [logo, setLogo] = useState<string | null>(null)
  const [saveAsBrand, setSaveAsBrand] = useState(true)

  // photos + selection (up to 4 go to the model)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])

  const [headline, setHeadline] = useState('')
  const [aspect, setAspect] = useState<'original' | '1:1' | '4:5' | '9:16'>('original')
  const tier: 'pro' = 'pro'   // Pro (Nano Banana Pro) always — best product fidelity + text
  const [emailDaily, setEmailDaily] = useState(true)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [results, setResults] = useState<{ url: string; genId: string | null }[]>([])  // generated variations
  const [activeIdx, setActiveIdx] = useState(0)                    // which variation is open for edit/download
  const [count, setCount] = useState(1)                            // how many variations to generate
  const [brandId, setBrandId] = useState<string | null>(null)      // selected saved brand (for linking generations)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)                    // portal guard (SSR-safe)
  useEffect(() => { setMounted(true) }, [])

  // Iterative edit loop (chat-style) — each edit charges credits, applied to the ACTIVE variation.
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState<{ idx: number; url: string }[]>([]) // for undo

  const active = results[activeIdx] || null

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
      if (j.fonts) setFonts(j.fonts)
      if (j.logo) setLogo(j.logo)
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
    setBusy(true); setResults([]); setActiveIdx(0); setHistory([])
    try {
      let useBrandId = brandId
      // If a new brand and "save" is on, persist it first (best-effort; http image URLs only).
      if (mode === 'new' && saveAsBrand && bName.trim()) {
        const httpImgs = chosen.filter((s) => /^https?:\/\//i.test(s))
        const rb = await fetch('/api/brands', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: bName.trim(), website: bSite.trim() || null, product_images: httpImgs, brand_kit: { colors, fonts, logo } }),
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

      // Fire `count` clones in parallel — each reserves+charges+saves its own generation, so partial
      // success is fine (Gemini's inherent randomness makes the variations differ).
      const body = {
        adId: ad.id, productImages: chosen, tier, brandId: useBrandId || undefined,
        brandName: bName.trim() || undefined, colors, newHeadline: headline.trim() || undefined,
        aspectRatio: aspect, logo: logo || undefined,
      }
      const settled = await Promise.all(Array.from({ length: count }, () =>
        fetch('/api/discovery/clone-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(async (r) => {
            const text = await r.text()
            let j: any
            try { j = JSON.parse(text) } catch { j = { error: `HTTP ${r.status}: ${(text || r.statusText).slice(0, 200)}` } }
            return { ok: r.ok, j }
          })
          .catch((e) => ({ ok: false, j: { error: `Network error: ${String(e?.message || e)}` } }))
      ))
      const good = settled.filter((s) => s.ok).map((s) => ({ url: s.j.image as string, genId: (s.j.generationId as string) || null }))
      if (good.length === 0) {
        const j = settled.find((s) => !s.ok)?.j || {}
        setErr(j.error === 'insufficient_credits' ? 'Not enough credits.'
          : j.error === 'Image generation not configured (GEMINI_API_KEY)' ? 'Clone isn’t switched on yet (missing API key).'
          : j.error || 'Generation failed — try again.')
        return
      }
      setResults(good); setActiveIdx(0)
      flyToCreatives(good[0]?.url)   // "saved to My Creatives" flourish
      if (good.length < count) setErr(`${good.length} of ${count} variations generated (the rest failed).`)
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setBusy(false) }
  }

  const applyEdit = async () => {
    if (!active || !editText.trim()) return
    setEditing(true); setErr(null)
    const idx = activeIdx, prevUrl = active.url
    try {
      const r = await fetch('/api/discovery/edit-image', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: prevUrl, instruction: editText.trim(), tier, parentId: active.genId || undefined, brandId: brandId || undefined }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErr(j.error === 'insufficient_credits' ? 'Not enough credits for this edit.' : j.error || 'Edit failed — try again.')
        return
      }
      setHistory((h) => [...h, { idx, url: prevUrl }])   // enable undo of this variation
      setResults((rs) => rs.map((x, i) => i === idx ? { url: j.image, genId: j.generationId || x.genId } : x))
      setEditText('')
      flyToCreatives(j.image)   // edited version is a new saved creative
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setEditing(false) }
  }

  const undo = () => setHistory((h) => {
    if (!h.length) return h
    const last = h[h.length - 1]
    setResults((rs) => rs.map((x, i) => i === last.idx ? { ...x, url: last.url } : x))
    return h.slice(0, -1)
  })

  const cost = 15        // Pro clone (Nano Banana Pro @ 2K) — matches credit_pricing image_clone_pro
  const editCost = 10    // Pro edit — matches image_edit_pro
  const hasResults = results.length > 0

  if (!mounted) return null
  // Rendered through a portal to <body> so the fixed overlay escapes the virtualized ad card's
  // transform + overflow:hidden (which otherwise clipped it into a narrow strip).
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: hasResults ? 'min(960px, 96vw)' : 'min(560px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: '#0f1512', border: '1px solid #223', borderRadius: 16, color: '#e8f0e8', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1c2620', position: 'sticky', top: 0, background: '#0f1512', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700, fontSize: 16 }}>
            <Sparkles size={17} color={LIME} /> Clone this ad
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8aa', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: hasResults ? '1fr 1fr' : '1fr', gap: 0 }}>
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
                  {/* Detected Brand Kit — colors + fonts, shown so the user can see/trust what we captured. */}
                  {(colors.length > 0 || fonts.heading || logo) && (
                    <div style={{ background: '#0a0f0c', border: '1px solid #24331d', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#b8c8bc' }}>🎨 Brand kit detected</div>
                      {logo && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logo} alt="logo" style={{ height: 22, maxWidth: 90, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2 }} />
                          <span style={{ fontSize: 10.5, color: '#6f7f73' }}>logo — used in the ad</span>
                        </div>
                      )}
                      {colors.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {colors.slice(0, 8).map((c, i) => <span key={i} title={c} style={{ width: 20, height: 20, borderRadius: 5, background: c, border: '1px solid #2c4030' }} />)}
                        </div>
                      )}
                      {fonts.heading && <div style={{ fontSize: 11.5, color: '#9fb0a4' }}>Aa <b style={{ color: '#cfe' }}>{fonts.heading}</b>{fonts.body && fonts.body !== fonts.heading ? ` · ${fonts.body}` : ''}</div>}
                      <div style={{ fontSize: 10.5, color: '#6f7f73' }}>Saved with the brand — edit anytime in My Creatives → Brands.</div>
                    </div>
                  )}
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
              <div style={{ fontSize: 11, color: '#8aa', marginTop: -4 }}>💡 Type your headline here for accurate on-image text — otherwise the model writes (and sometimes misspells) its own.</div>
              {/* Aspect ratio */}
              <div>
                <div style={{ fontSize: 11.5, color: '#7a8a7e', marginBottom: 5 }}>Aspect ratio</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['original', 'Original'], ['1:1', 'Square'], ['4:5', 'Feed 4:5'], ['9:16', 'Story']] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setAspect(v)} style={{ flex: 1, ...tierBtn(aspect === v), padding: '8px 0', fontSize: 11.5 }}>{label}</button>
                  ))}
                </div>
              </div>
              {/* How many variations to generate (each is its own charge + saved creative). */}
              <div>
                <div style={{ fontSize: 11.5, color: '#7a8a7e', marginBottom: 5 }}>Variations to generate</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 4, 6, 8].map((n) => (
                    <button key={n} onClick={() => setCount(n)} style={{ flex: 1, ...tierBtn(count === n), padding: '8px 0' }}>{n}</button>
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#cfe', cursor: 'pointer', background: '#121c15', border: '1px solid #24331d', borderRadius: 10, padding: '10px 12px' }}>
                <input type="checkbox" checked={emailDaily} onChange={(e) => setEmailDaily(e.target.checked)} style={{ marginTop: 2 }} />
                <span>📧 <b>Email me new winning ads like this, daily</b><br /><span style={{ color: '#8aa', fontSize: 11.5 }}>Fresh top ads from {ad.pageName || 'this brand'} & its niche — 2 credits per email, cancel anytime in Settings.</span></span>
              </label>
            </section>

            {err && <div style={{ background: '#2a1416', border: '1px solid #5a2a2e', color: '#ffb4b4', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>{err}</div>}

            <button onClick={generate} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
              {busy ? <><Loader2 size={16} className="spin" /> Generating {count > 1 ? `${count} variations` : ''}…</>
                : <><Sparkles size={16} /> {hasResults ? 'Regenerate' : 'Generate'} {count > 1 ? `${count} variations` : 'clone'} · {cost * count} cr</>}
            </button>
          </div>

          {/* ── results + chat-style edit loop ── */}
          {active && (
            <div style={{ padding: 20, borderLeft: '1px solid #1c2620', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Label>{results.length > 1 ? `${results.length} variations` : 'Your cloned ad'}</Label>
                {history.some((h) => h.idx === activeIdx) && (
                  <button onClick={undo} style={{ background: 'transparent', border: '1px solid #2c4030', color: '#9fb0a4', borderRadius: 8, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↶ Undo</button>
                )}
              </div>

              {/* Variation thumbnails — click to switch which one you're editing/downloading. */}
              {results.length > 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {results.map((rz, i) => (
                    <button key={i} onClick={() => setActiveIdx(i)} style={{ width: 54, height: 54, borderRadius: 8, overflow: 'hidden', border: i === activeIdx ? `2px solid ${LIME}` : '2px solid #263', padding: 0, cursor: 'pointer', background: '#0a0f0c' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={rz.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: i === activeIdx ? 1 : 0.6 }} />
                    </button>
                  ))}
                </div>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div style={{ position: 'relative' }}>
                <img src={active.url} alt="cloned ad" style={{ width: '100%', borderRadius: 12, border: '1px solid #223', opacity: editing ? 0.5 : 1 }} />
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

              <a href={active.url} download={`clone-${ad.id}-${activeIdx + 1}.png`} style={{ ...btnPrimary, textDecoration: 'none', justifyContent: 'center' }}>
                <Download size={15} /> Download{results.length > 1 ? ' this variation' : ''}
              </a>
              <p style={{ fontSize: 11.5, color: '#8aa', margin: 0 }}>All variations are saved in <b style={{ color: '#cfe' }}>My Creatives</b>. Edit any above, or Regenerate for fresh ones.</p>
            </div>
          )}
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>,
    document.body,
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
