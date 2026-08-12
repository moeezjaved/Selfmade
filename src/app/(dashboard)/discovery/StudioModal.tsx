'use client'
/**
 * AI Ad Studio modal — generate a brand-NEW original ad for the user's product (no source ad).
 * Pick a brand (industry auto-detected) or add one via URL/upload → select product photos → optional
 * headline → aspect/resolution/variations → POST /api/discovery/generate-ad. The server pulls the
 * industry's winning insights + 3-4 inspiration references. Results support the same edit/download
 * loop as Clone. Reuses the dark studio visual language.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Link2, Loader2, Download, Sparkles, Check, Wand2 } from 'lucide-react'
import { flyToCreatives } from '@/lib/flyToCreatives'
import { creativeFilename } from '@/lib/filename'
import CloneGeneration from '@/components/motion/CloneGeneration'

const LIME = '#ff5a2c'
type Photo = { id: string; src: string; label?: string }
// Proxy external product URLs (hotlink-protected → raw <img> breaks). data:/R2 pass through.
const cdn = (u: string) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? u : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=160&q=72&output=webp`
type Brand = { id: string; name: string; website?: string | null; products?: { image_urls?: string[] }[] }
const uid = () => Math.random().toString(36).slice(2)
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })

export default function StudioModal({ onClose }: { onClose: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [mode, setMode] = useState<'pick' | 'new'>('pick')
  const [bName, setBName] = useState('')
  const [bSite, setBSite] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [colors, setColors] = useState<string[]>([])
  const [fonts, setFonts] = useState<any>({})
  const [logo, setLogo] = useState<string | null>(null)
  const [palette, setPalette] = useState<any>(null)
  const [saveAsBrand, setSaveAsBrand] = useState(true)
  const [brandId, setBrandId] = useState<string | null>(null)

  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [headline, setHeadline] = useState('')
  const [angle, setAngle] = useState('')
  const [nicheOverride, setNicheOverride] = useState('')   // '' = auto-detect
  const [niches, setNiches] = useState<string[]>([])
  const [aspect, setAspect] = useState<'4:5' | '1:1' | '9:16' | '16:9'>('4:5')
  const [imageSize, setImageSize] = useState<'2K' | '4K'>('2K')
  const [count, setCount] = useState(2)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [results, setResults] = useState<{ url: string; genId: string | null }[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [meta, setMeta] = useState<{ niche: string | null; inspirations: number; references?: any[] } | null>(null)
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const active = results[activeIdx] || null
  const cost = imageSize === '4K' ? 25 : 15
  const editCost = 10

  useEffect(() => {
    ;(async () => {
      try {
        const j = await fetch('/api/brands').then(r => r.json())
        const bs: Brand[] = j.brands || []
        setBrands(bs)
        if (bs.length === 0) setMode('new'); else pickBrand(bs[0])
      } catch { /* non-fatal */ }
      fetch('/api/discovery/niches').then(r => r.json()).then(j => setNiches(j.niches || [])).catch(() => {})
    })()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const addPhotos = (list: Photo[]) => setPhotos((p) => {
    const seen = new Set(p.map((x) => x.src))
    const fresh = list.filter((x) => !seen.has(x.src))
    setSelected((s) => Array.from(new Set([...s, ...fresh.map((f) => f.id)])).slice(0, 3))
    return [...p, ...fresh]
  })
  const pickBrand = (b: Brand) => {
    setMode('pick'); setBrandId(b.id); setBName(b.name); setBSite(b.website || '')
    const imgs = (b.products || []).flatMap((p) => p.image_urls || [])
    const ph = imgs.slice(0, 8).map((u) => ({ id: uid(), src: u, label: 'saved' }))
    setPhotos(ph); setSelected(ph.slice(0, 3).map((p) => p.id))
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
      const j = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: bSite.trim() }) }).then(r => r.json())
      if (j.brandName && !bName.trim()) setBName(j.brandName)
      if (Array.isArray(j.colors)) setColors(j.colors)
      if (j.fonts) setFonts(j.fonts)
      if (j.logo) setLogo(j.logo)
      if (j.palette) setPalette(j.palette)
      const prodSrc = Array.from(new Set([...(j.productImages || []), ...(j.images || [])]))
      addPhotos(prodSrc.map((u: string) => ({ id: uid(), src: u, label: 'detected' })))
      if (!prodSrc.length) setErr('No product photos found — upload manually.')
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setDetecting(false) }
  }
  const toggleSel = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length >= 3 ? s : [...s, id]))

  const generate = async () => {
    setErr(null)
    const chosen = photos.filter((p) => selected.includes(p.id)).map((p) => p.src)
    if (chosen.length === 0) { setErr('Add and select at least one product photo.'); return }
    setBusy(true); setResults([]); setActiveIdx(0); setMeta(null)
    try {
      let useBrandId = brandId
      if (mode === 'new' && saveAsBrand && bName.trim()) {
        const httpImgs = chosen.filter((s) => /^https?:\/\//i.test(s))
        const jb = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: bName.trim(), website: bSite.trim() || null, product_images: httpImgs, brand_kit: { colors, fonts, logo, palette } }) }).then(r => r.json()).catch(() => ({}))
        if (jb?.brand?.id) { useBrandId = jb.brand.id; setBrandId(jb.brand.id) }
      }
      const body = {
        brandId: useBrandId || undefined, productImages: chosen, brandName: bName.trim() || undefined,
        colors, palette: palette || undefined, fonts, logo: logo || undefined,
        newHeadline: headline.trim() || undefined, angle: angle.trim() || undefined,
        niche: nicheOverride || undefined, aspectRatio: aspect, imageSize,
      }
      const settled = await Promise.all(Array.from({ length: count }, () =>
        fetch('/api/discovery/generate-ad', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(async (r) => { const t = await r.text(); let j: any; try { j = JSON.parse(t) } catch { j = { error: `HTTP ${r.status}` } } return { ok: r.ok, j } })
          .catch((e) => ({ ok: false, j: { error: String(e?.message || e) } }))))
      const good = settled.filter((s) => s.ok && s.j?.url).map((s) => ({ url: s.j.url as string, genId: s.j.generationId || null }))
      const bad = settled.find((s) => !s.ok)
      if (good.length === 0) { setErr(bad?.j?.error === 'insufficient_credits' ? 'Not enough credits.' : bad?.j?.error || 'Generation failed — try again.'); return }
      const first = settled.find((s) => s.ok)?.j
      if (first) setMeta({ niche: first.niche || null, inspirations: first.inspirations || 0, references: first.references || [] })
      setResults(good); setActiveIdx(0); flyToCreatives(good[0]?.url)
      if (bad && good.length < count) setErr(`${good.length}/${count} generated — the rest failed. Credits for failures were refunded.`)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const applyEdit = async () => {
    if (!active || !editText.trim()) return
    setEditing(true); setErr(null)
    try {
      const j = await fetch('/api/discovery/edit-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: active.url, instruction: editText.trim(), tier: 'pro', parentId: active.genId, brandId: brandId || undefined }) }).then(r => r.json())
      if (!j?.url && !j?.image) { setErr(j?.error === 'insufficient_credits' ? 'Not enough credits for an edit.' : j?.error || 'Edit failed.'); return }
      const newUrl = j.url || j.image
      setResults((rs) => rs.map((r, i) => i === activeIdx ? { url: newUrl, genId: j.generationId || r.genId } : r))
      setEditText(''); flyToCreatives(newUrl)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setEditing(false) }
  }

  const hasResults = results.length > 0
  if (!mounted) return null
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,17,.42)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '4vh 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: hasResults ? 1040 : 640, background: '#ffffff', border: '1px solid #efece2', borderRadius: 18, overflow: 'hidden', display: hasResults ? 'grid' : 'block', gridTemplateColumns: hasResults ? '1fr 1fr' : undefined }}>
        {/* Generating → the money-moment wait animation (light takeover over the form) */}
        {busy && !hasResults && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 57, bottom: 0, background: '#f6f7f5', zIndex: 5, overflow: 'auto', borderRadius: '0 0 18px 18px' }}>
            <CloneGeneration helper="Designing your ad · ~30 seconds · keep browsing" />
          </div>
        )}
        {/* Left / form */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid #efece2' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px -4px rgba(255,90,44,.6)' }}><Sparkles size={20} color="#0e1b12" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#161c17' }}>AI Ad Studio</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#6f6d5a', marginTop: 1 }}>Design a brand-new ad — no source ad needed</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6f6d5a', cursor: 'pointer' }}><X size={18} /></button>
          </div>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: 12.5, color: '#6f6d5a', lineHeight: 1.5, background: '#f6f8f5', border: '1px solid #efece2', borderRadius: 10, padding: '10px 12px' }}>
              Designs a <b style={{ color: '#3f6212' }}>brand-new</b> ad for your product — using your industry’s top-performing hooks & a curated inspiration library. No source ad needed.
            </div>

            {/* Brand */}
            <section>
              <Label>1 · Your brand</Label>
              {brands.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {brands.map((b) => <button key={b.id} onClick={() => pickBrand(b)} style={chip(mode === 'pick' && brandId === b.id)}>{b.name}</button>)}
                  <button onClick={() => { setMode('new'); setBrandId(null); setBName(''); setPhotos([]); setSelected([]) }} style={chip(mode === 'new')}>＋ New brand</button>
                </div>
              )}
              {mode === 'new' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Brand name" style={input} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={bSite} onChange={(e) => setBSite(e.target.value)} placeholder="yourstore.com (auto-detect photos, colors, logo)" style={{ ...input, flex: 1 }} />
                    <button onClick={detect} disabled={detecting || !bSite.trim()} style={{ ...btnGhost, opacity: (detecting || !bSite.trim()) ? 0.6 : 1 }}>{detecting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Detect</button>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#6f6d5a' }}>
                    <input type="checkbox" checked={saveAsBrand} onChange={(e) => setSaveAsBrand(e.target.checked)} /> Save as a brand for reuse
                  </label>
                </div>
              )}
            </section>

            {/* Photos */}
            <section>
              <Label>2 · Product photos · pick up to 3</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {photos.map((p) => {
                  const on = selected.includes(p.id)
                  return (
                    <button key={p.id} onClick={() => toggleSel(p.id)} style={{ position: 'relative', width: 74, height: 74, borderRadius: 10, overflow: 'hidden', border: on ? `2px solid ${LIME}` : '2px solid #efece2', background: '#f6f8f5', cursor: 'pointer', padding: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cdn(p.src)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {on && <span style={{ position: 'absolute', top: 3, right: 3, background: LIME, color: '#14281a', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} strokeWidth={3} /></span>}
                    </button>
                  )
                })}
                <button onClick={() => fileRef.current?.click()} style={{ width: 74, height: 74, borderRadius: 10, border: '2px dashed #dfe6dd', background: '#f6f8f5', color: '#6f6d5a', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 10 }}>
                  <Upload size={16} /> Upload
                </button>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
              </div>
            </section>

            {/* Options */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Label>3 · Options</Label>
              <input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Angle / what's this ad about? (e.g. quit nicotine naturally — 92% success)" style={input} />
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="On-screen headline (optional — AI writes one otherwise)" style={input} />
              <div>
                <div style={{ fontSize: 11.5, color: '#6f6d5a', marginBottom: 5 }}>Industry <span style={{ color: '#94a096' }}>· auto-detected if left on Auto</span></div>
                <select value={nicheOverride} onChange={(e) => setNicheOverride(e.target.value)} style={{ ...input, width: '100%', appearance: 'auto' }}>
                  <option value="">✨ Auto-detect</option>
                  {niches.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#6f6d5a', marginBottom: 5 }}>Aspect ratio</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['4:5', 'Feed 4:5'], ['1:1', 'Square'], ['9:16', 'Story'], ['16:9', 'Wide']] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setAspect(v)} style={{ ...tierBtn(aspect === v), fontSize: 11.5 }}>{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#6f6d5a', marginBottom: 5 }}>Resolution</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setImageSize('2K')} style={tierBtn(imageSize === '2K')}>2K · 15 cr</button>
                  <button onClick={() => setImageSize('4K')} style={tierBtn(imageSize === '4K')}>4K HD · 25 cr</button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#6f6d5a', marginBottom: 5 }}>Variations to generate</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 4, 6].map((n) => <button key={n} onClick={() => setCount(n)} style={tierBtn(count === n)}>{n}</button>)}
                </div>
              </div>
            </section>

            {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>{err}</div>}
            <button onClick={generate} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
              {busy ? <><Loader2 size={16} className="spin" /> Designing {count > 1 ? `${count} ads` : ''}…</> : <><Sparkles size={16} /> {hasResults ? 'Regenerate' : 'Generate'} {count > 1 ? `${count} ads` : 'ad'} · {cost * count} cr</>}
            </button>
          </div>
        </div>

        {/* Right / results */}
        {hasResults && active && (
          <div style={{ borderLeft: '1px solid #efece2', display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', flex: 1, background: '#f6f8f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 320 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={active.url} alt="" style={{ maxWidth: '100%', maxHeight: '58vh', borderRadius: 8, opacity: editing ? 0.5 : 1 }} />
              {editing && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3f6212', gap: 8, fontSize: 13, fontWeight: 600 }}><Loader2 size={18} className="spin" /> Editing…</div>}
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {meta && (
                <div style={{ fontSize: 11.5, color: '#6f6d5a' }}>
                  <div>Tuned to {meta.niche ? <b style={{ color: '#161c17' }}>{meta.niche}</b> : 'your industry'} · inspired by {meta.inspirations} reference design{meta.inspirations === 1 ? '' : 's'}.</div>
                  {!!meta.references?.length && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                      {meta.references.map((r, i) => (
                        <a key={i} href={r.url} target="_blank" rel="noreferrer" title={`Why: ${r.why || 'style match'}`}
                          style={{ display: 'block', width: 40, height: 50, borderRadius: 6, overflow: 'hidden', border: '1px solid #efece2', flexShrink: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </a>
                      ))}
                      <span style={{ alignSelf: 'center', color: '#94a096', fontSize: 10.5 }}>hover to see why each was picked</span>
                    </div>
                  )}
                </div>
              )}
              {results.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {results.map((r, i) => (
                    <button key={i} onClick={() => setActiveIdx(i)} style={{ width: 54, height: 54, borderRadius: 8, overflow: 'hidden', border: i === activeIdx ? `2px solid ${LIME}` : '2px solid #efece2', padding: 0, cursor: 'pointer', background: '#f6f8f5' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyEdit() }} placeholder="Tweak it — headline, colors, scene, background…" style={{ ...input, flex: 1 }} />
                <button onClick={applyEdit} disabled={editing || !editText.trim()} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12.5, opacity: (editing || !editText.trim()) ? 0.6 : 1 }}>{editing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Edit · {editCost} cr</button>
              </div>
              <a href={active.url} download={creativeFilename({ brand: bName.trim(), index: activeIdx + 1, kind: 'ad' })} style={{ ...btnPrimary, textDecoration: 'none', justifyContent: 'center' }}><Download size={15} /> Download{results.length > 1 ? ' this one' : ''}</a>
              <p style={{ fontSize: 11.5, color: '#6f6d5a', margin: 0 }}>All variations saved in <b style={{ color: '#161c17' }}>My Creatives</b>.</p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// Section label — a leading "N · " renders as a lime numbered badge (handoff section pattern).
function Label({ children }: { children: React.ReactNode }) {
  const m = typeof children === 'string' ? children.match(/^(\d+)\s*·\s*(.*)$/) : null
  if (m) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#ff5a2c', color: '#0e1b12', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{m[1]}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#6f6d5a', textTransform: 'uppercase', letterSpacing: '.09em' }}>{m[2]}</span>
    </div>
  )
  return <div style={{ fontSize: 12, fontWeight: 700, color: '#6f6d5a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div>
}
const input: React.CSSProperties = { background: '#ffffff', border: '1px solid #efece2', borderRadius: 12, padding: '10px 12px', color: '#161c17', fontSize: 13, fontFamily: 'inherit', outline: 'none' }
const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: '#ffffff', border: '1px solid #dfe6dd', color: '#161c17', borderRadius: 9, padding: '0 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: LIME, color: '#14281a', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? LIME : '#ffffff', color: on ? '#14281a' : '#161c17', border: `1px solid ${on ? LIME : '#dfe6dd'}`, borderRadius: 20, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
const tierBtn = (on: boolean): React.CSSProperties => ({ flex: 1, background: on ? '#eefdcf' : '#f6f8f5', color: on ? '#2f5417' : '#6f6d5a', border: `1px solid ${on ? LIME : '#efece2'}`, borderRadius: 9, padding: '9px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' })
