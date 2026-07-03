'use client'
/**
 * My Creatives — the hub for everything the user generates.
 *  • Generations tab: gallery of saved clones/edits/inspired ads → open any to re-edit (credits),
 *    download, or delete.
 *  • Brands tab: view/edit/delete the brands that feed Clone & Script (name, site, voice, products),
 *    with the plan's brand-slot quota and add-brand (URL auto-detect / manual).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Store, Download, Trash2, Loader2, X, Pencil, Plus, Link2, Upload } from 'lucide-react'

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
}

const DARK = '#1a3a1a', LIME = '#dffe95'
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: 'none', background: DARK, color: LIME, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
const btnGhost: React.CSSProperties = { ...btn, background: '#fff', color: DARK, border: '1px solid #cbd5cb' }
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#111', outline: 'none' }

type Gen = { id: string; image_url: string | null; type: string; tier: string; prompt?: string | null; brand_name?: string | null; source_ad_id?: string | null; media_type?: string; status?: string; created_at: string }
type Product = { id: string; name?: string | null; image_urls?: string[] }
type BrandKit = { colors?: string[]; extraColors?: string[]; palette?: Record<string, string>; fonts?: { heading?: string | null; body?: string | null; headingWeight?: string | null; bodyWeight?: string | null }; logo?: string | null }
type Brand = { id: string; name: string; website?: string | null; tone?: string | null; usps?: string[]; products?: Product[]; brand_kit?: BrandKit }

export default function MyCreativesPage() {
  const [tab, setTab] = useState<'generations' | 'brands'>('generations')
  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', margin: 0 }}>My Creatives</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Every ad you generate lives here — re-edit, download, and manage the brands behind them.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #dde7dd' }}>
        <Tab on={tab === 'generations'} onClick={() => setTab('generations')}><Sparkles size={15} /> Generations</Tab>
        <Tab on={tab === 'brands'} onClick={() => setTab('brands')}><Store size={15} /> Brands</Tab>
      </div>
      {tab === 'generations' ? <Generations /> : <Brands />}
    </div>
  )
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', border: 'none', background: 'transparent', borderBottom: on ? `2px solid ${DARK}` : '2px solid transparent', color: on ? '#111' : '#6b7280', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
      {children}
    </button>
  )
}

/* ───────────────────────── Generations gallery ───────────────────────── */
function Generations() {
  const [gens, setGens] = useState<Gen[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'clone' | 'edit' | 'inspired'>('all')
  const [open, setOpen] = useState<Gen | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/creatives')
    const j = await r.json()
    setGens(j.creatives || [])
  }, [])
  useEffect(() => { load() }, [load])

  // Poll any in-flight video jobs until they finish, then refresh the gallery.
  useEffect(() => {
    const processing = (gens || []).filter((g) => g.status === 'processing')
    if (processing.length === 0) return
    const t = setInterval(async () => {
      let anyDone = false
      await Promise.all(processing.map(async (g) => {
        const r = await fetch(`/api/discovery/animate/status?id=${g.id}`).then((x) => x.json()).catch(() => ({}))
        if (r.done) anyDone = true
      }))
      if (anyDone) load()
    }, 8000)
    return () => clearInterval(t)
  }, [gens, load])

  const shown = (gens || []).filter((g) => filter === 'all' || g.type === filter)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'clone', 'edit', 'inspired'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${filter === f ? DARK : '#cbd5cb'}`, background: filter === f ? DARK : '#fff', color: filter === f ? LIME : '#374151', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{f}</button>
        ))}
      </div>

      {gens === null ? <div style={{ color: '#9ca3af' }}>Loading…</div>
        : shown.length === 0 ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            No creatives yet. Open <b style={{ color: DARK }}>Discovery</b>, hover any ad and hit <b style={{ color: DARK }}>Clone ad</b> — it’ll show up here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {shown.map((g) => (
              <div key={g.id} style={card}>
                <button onClick={() => g.status !== 'processing' && setOpen(g)} style={{ display: 'block', width: '100%', border: 'none', padding: 0, cursor: g.status === 'processing' ? 'default' : 'pointer', background: '#0d120e', aspectRatio: '1', overflow: 'hidden', position: 'relative' }}>
                  {g.status === 'processing' ? (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', color: LIME, fontSize: 12, fontWeight: 600 }}><Loader2 size={20} className="spin" /> Generating video…</div>
                  ) : g.media_type === 'video' && g.image_url ? (
                    <video src={g.image_url} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.image_url || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  {g.media_type === 'video' && g.status !== 'processing' && <span style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px' }}>🎬 Video</span>}
                </button>
                <div style={{ padding: '9px 11px' }}>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
                    <Badge>{g.type}</Badge>{g.tier === 'pro' && <Badge tone="pro">Pro</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.brand_name || g.prompt || 'Untitled'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      {open && <GenerationModal gen={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'pro' }) {
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, textTransform: 'capitalize', background: tone === 'pro' ? DARK : '#eef5eb', color: tone === 'pro' ? LIME : '#3f6b3f' }}>{children}</span>
}

/* Full-view + re-edit (reuses the credit-charged edit endpoint; new edits are saved as generations). */
function GenerationModal({ gen, onClose, onChanged }: { gen: Gen; onClose: () => void; onChanged: () => void }) {
  const [img, setImg] = useState(gen.image_url)
  const [genId, setGenId] = useState(gen.id)
  const [instr, setInstr] = useState('')
  const [vidRes, setVidRes] = useState<'1080p' | '4K'>('1080p')
  const tier: 'pro' = 'pro'   // Pro-only (Nano Banana Pro)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const editCost = 10   // Pro edit — matches image_edit_pro

  const applyEdit = async () => {
    if (!instr.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/edit-image', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: img, instruction: instr.trim(), tier, parentId: genId }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error === 'insufficient_credits' ? 'Not enough credits for this edit.' : j.error || 'Edit failed.'); return }
      setImg(j.image); if (j.generationId) setGenId(j.generationId); setInstr('')
      onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('Delete this creative?')) return
    await fetch(`/api/creatives?id=${gen.id}`, { method: 'DELETE' })
    onChanged(); onClose()
  }
  const animate = async (style: string, resolution: '1080p' | '4K') => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/animate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: img, style, resolution, parentId: genId }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error === 'insufficient_credits' ? 'Not enough credits for a video.' : j.error || 'Could not start video.'); return }
      onChanged(); onClose()   // the gallery shows a "Generating video…" card + polls to completion
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }
  const isVideo = gen.media_type === 'video'

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', maxWidth: 900 }}>
        <div style={{ background: '#0d120e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative' }}>
          {isVideo
            ? <video src={img || ''} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8 }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={img || ''} alt="" style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8, opacity: busy ? 0.5 : 1 }} />}
          {busy && !isVideo && <div style={{ position: 'absolute', color: LIME, display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><Loader2 size={18} className="spin" /> Working…</div>}
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isVideo ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Your video</div>
              <a href={img || ''} download={`creative-${gen.id}.mp4`} style={{ ...btn, justifyContent: 'center', textDecoration: 'none' }}><Download size={15} /> Download MP4</a>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Edit creative</div>
              <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={3}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyEdit() }}
                placeholder="Tweak this creative — headline, subhead, colors, scene, background…" style={{ ...input, resize: 'vertical' }} />
              {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>{err}</div>}
              <button onClick={applyEdit} disabled={busy || !instr.trim()} style={{ ...btn, justifyContent: 'center', opacity: (busy || !instr.trim()) ? 0.6 : 1 }}><Sparkles size={15} /> Apply edit · {editCost} cr</button>
              {/* Animate → short motion MP4 (droplet FFmpeg; keeps the ad exact). 1080p 15 / 4K 25. */}
              <div style={{ borderTop: '1px solid #eef2ec', paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>🎬 Animate · {vidRes === '4K' ? 25 : 15} cr</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  {(['1080p', '4K'] as const).map((rz) => (
                    <button key={rz} onClick={() => setVidRes(rz)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${vidRes === rz ? DARK : '#cbd5cb'}`, background: vidRes === rz ? '#eef5eb' : '#fff', color: DARK, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>{rz}{rz === '4K' ? ' HD' : ''}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['zoom', 'Slow zoom'], ['shine', 'Shine sweep']] as const).map(([s, label]) => (
                    <button key={s} onClick={() => animate(s, vidRes)} disabled={busy} style={{ ...btnGhost, flex: 1, justifyContent: 'center', fontSize: 11.5, padding: '8px 4px' }}>{label}</button>
                  ))}
                </div>
              </div>
              <a href={img || ''} download={`creative-${gen.id}.png`} style={{ ...btnGhost, justifyContent: 'center', textDecoration: 'none' }}><Download size={15} /> Download</a>
            </>
          )}
          <button onClick={del} style={{ ...btnGhost, justifyContent: 'center', color: '#b91c1c', borderColor: '#f0c4c4' }}><Trash2 size={15} /> Delete</button>
        </div>
      </div>
    </Overlay>
  )
}

/* ───────────────────────── Brands manager ───────────────────────── */
function Brands() {
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [edit, setEdit] = useState<Brand | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/brands')
    const j = await r.json()
    setBrands(j.brands || [])
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (id: string) => {
    if (!confirm('Delete this brand and its products?')) return
    await fetch(`/api/brands/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Brands feed Clone & Script — voice, USPs, and product photos. Slots are set by your plan.</div>
        <button onClick={() => setAdding(true)} style={btn}><Plus size={15} /> Add brand</button>
      </div>
      {brands === null ? <div style={{ color: '#9ca3af' }}>Loading…</div>
        : brands.length === 0 ? <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9ca3af' }}>No brands yet. Add one to start cloning ads with your product.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {brands.map((b) => {
                const imgs = (b.products || []).flatMap((p) => p.image_urls || []).slice(0, 4)
                return (
                  <div key={b.id} style={{ ...card, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>{b.name}</div>
                        {b.website && <div style={{ fontSize: 12, color: '#6b7280' }}>{b.website}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEdit(b)} title="Edit" style={{ ...btnGhost, padding: 7 }}><Pencil size={14} /></button>
                        <button onClick={() => del(b.id)} title="Delete" style={{ ...btnGhost, padding: 7, color: '#b91c1c', borderColor: '#f0c4c4' }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                      {imgs.length ? imgs.map((u, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={u} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                      )) : <div style={{ fontSize: 12, color: '#9ca3af' }}>No product photos yet</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      {edit && <BrandModal brand={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {adding && <AddBrandModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
    </div>
  )
}

function BrandModal({ brand, onClose, onSaved }: { brand: Brand; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(brand.name)
  const [website, setWebsite] = useState(brand.website || '')
  const [tone, setTone] = useState(brand.tone || '')
  const [usps, setUsps] = useState((brand.usps || []).join(', '))
  const [palette, setPalette] = useState<Record<string, string>>({ ...(brand.brand_kit?.palette || {}) })
  const [extra, setExtra] = useState<string[]>(brand.brand_kit?.extraColors || [])
  const [hFont, setHFont] = useState(brand.brand_kit?.fonts?.heading || '')
  const [hWeight, setHWeight] = useState(brand.brand_kit?.fonts?.headingWeight || '700')
  const [bFont, setBFont] = useState(brand.brand_kit?.fonts?.body || '')
  const [bWeight, setBWeight] = useState(brand.brand_kit?.fonts?.bodyWeight || '400')
  const [logo, setLogo] = useState(brand.brand_kit?.logo || '')
  const [photos, setPhotos] = useState<string[]>((brand.products || []).flatMap((p) => p.image_urls || []))
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoMsg, setPhotoMsg] = useState<string | null>(null)
  const [detectSite, setDetectSite] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const flatColors = Array.from(new Set([...Object.values(palette).filter(Boolean), ...extra]))
  const save = async () => {
    setBusy(true)
    await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name, website, tone, usps: usps.split(',').map((s) => s.trim()).filter(Boolean),
        brand_kit: {
          palette, extraColors: extra, colors: flatColors, logo: logo || null,
          fonts: { heading: hFont || null, headingWeight: hWeight, body: bFont || null, bodyWeight: bWeight },
        },
      }),
    })
    setBusy(false); onSaved()
  }

  const addPhotos = async (images: string[]): Promise<string[]> => {
    if (!images.length) return photos
    setPhotoBusy(true)
    const r = await fetch(`/api/brands/${brand.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resource: 'photos', images }) })
    const j = await r.json()
    const merged = Array.isArray(j.image_urls) ? j.image_urls : photos
    setPhotos(merged); setPhotoBusy(false)
    return merged
  }
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    addPhotos(await Promise.all(Array.from(files).slice(0, 8).map(fileToDataUrl)))
  }
  const badFont = (v: string) => v.includes('(') || v.startsWith('--')
  const detect = async () => {
    const site = (detectSite.trim() || website.trim())
    if (!site) return
    setPhotoBusy(true); setPhotoMsg(null)
    try {
      const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: site }) })
      const j = await r.json()
      if (!r.ok) { setPhotoMsg(j.error || 'Could not read that site.'); return }
      // Refresh the kit: fill empty fields; also overwrite a font that leaked as a CSS var(...).
      if (j.palette && Object.keys(palette).length === 0) setPalette(j.palette)
      if (j.fonts?.heading && (!hFont.trim() || badFont(hFont))) setHFont(j.fonts.heading)
      if (j.fonts?.body && (!bFont.trim() || badFont(bFont))) setBFont(j.fonts.body)
      if (j.logo && !logo.trim()) setLogo(j.logo)
      // Prefer the ACCURATE product photos (Shopify /products.json) over homepage lifestyle images.
      const prod = (Array.isArray(j.productImages) && j.productImages.length) ? j.productImages : (j.images || [])
      const found = prod.length
      const before = photos.length
      const merged = found ? await addPhotos(prod.slice(0, 24)) : photos
      const added = Math.max(0, merged.length - before)
      setPhotoMsg(found === 0 ? 'No product images found on that page.'
        : added > 0 ? `Added ${added} new photo${added > 1 ? 's' : ''} (${found} found).`
        : `No new photos — the ${found} found are already saved.`)
    } finally { setPhotoBusy(false); setDetectSite('') }
  }
  const removePhoto = async (url: string) => {
    setPhotos((p) => p.filter((u) => u !== url))
    await fetch(`/api/brands/${brand.id}?photoUrl=${encodeURIComponent(url)}`, { method: 'DELETE' })
  }

  // Auto-detect + PERSIST the brand kit the first time a brand with a website has no colors yet, so it
  // never opens empty and survives reopen even if the user forgets to hit Save.
  useEffect(() => {
    const site = (brand.website || '').trim()
    if (!site || Object.keys(palette).length > 0) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: site }) })
        const j = await r.json()
        if (!r.ok || cancelled) return
        const nextPalette = j.palette && Object.keys(j.palette).length ? j.palette : palette
        const nextH = j.fonts?.heading || hFont
        const nextB = j.fonts?.body || bFont
        const nextLogo = logo || j.logo || ''
        setPalette(nextPalette); if (j.fonts?.heading) setHFont(nextH); if (j.fonts?.body) setBFont(nextB); if (!logo && j.logo) setLogo(nextLogo)
        // Persist immediately so a reopen shows it.
        await fetch(`/api/brands/${brand.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ brand_kit: {
            palette: nextPalette, extraColors: extra,
            colors: Array.from(new Set([...Object.values(nextPalette).filter(Boolean) as string[], ...extra])),
            fonts: { heading: nextH || null, headingWeight: hWeight, body: nextB || null, bodyWeight: bWeight },
            logo: nextLogo || null,
          } }),
        })
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 22, width: 480, maxWidth: '92vw', maxHeight: '88vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#111' }}>Edit brand</div>
        <Field label="Brand name"><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></Field>
        <Field label="Website"><input value={website} onChange={(e) => setWebsite(e.target.value)} style={input} /></Field>
        <Field label="Voice / tone"><input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. bold, playful, premium" style={input} /></Field>
        <Field label="USPs (comma-separated)"><input value={usps} onChange={(e) => setUsps(e.target.value)} placeholder="fast shipping, 30-day guarantee" style={input} /></Field>

        {/* Brand Kit — named color roles + typography, applied to every generated ad. */}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginTop: 4 }}>🎨 Brand kit — colors</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([['background', 'Background'], ['accent', 'Accent'], ['heading', 'Heading'], ['body', 'Body'], ['icon', 'Icon'], ['cta', 'CTA'], ['ctaText', 'CTA text']] as const).map(([key, label]) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>{label}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={palette[key] || '#ffffff'} onChange={(e) => setPalette((p) => ({ ...p, [key]: e.target.value }))} style={{ width: 34, height: 34, border: '1px solid #e2e8f0', borderRadius: 8, padding: 0, cursor: 'pointer', flexShrink: 0 }} />
                <input value={palette[key] || ''} onChange={(e) => setPalette((p) => ({ ...p, [key]: e.target.value }))} placeholder="#000000" style={{ ...input, flex: 1, fontSize: 12, padding: '7px 8px' }} />
              </div>
            </div>
          ))}
        </div>
        <Field label="Extra colors">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {extra.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f5f8f2', borderRadius: 8, padding: '3px 6px', fontSize: 11 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid #e2e8f0' }} />{c}
                <button onClick={() => setExtra((e) => e.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 0 }}><X size={11} /></button>
              </span>
            ))}
            <input type="color" onChange={(e) => setExtra((x) => Array.from(new Set([...x, e.target.value])))} style={{ width: 30, height: 30, border: '1px dashed #cbd5cb', borderRadius: 8, padding: 0, cursor: 'pointer' }} title="Add color" />
          </div>
        </Field>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginTop: 4 }}>Typography</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Heading font">
            <input value={hFont} onChange={(e) => setHFont(e.target.value)} placeholder="Plus Jakarta Sans" style={input} />
            <select value={hWeight} onChange={(e) => setHWeight(e.target.value)} style={{ ...input, marginTop: 6 }}>{['300', '400', '500', '600', '700', '800', '900'].map((w) => <option key={w} value={w}>Weight {w}</option>)}</select>
          </Field>
          <Field label="Body font">
            <input value={bFont} onChange={(e) => setBFont(e.target.value)} placeholder="Open Sans" style={input} />
            <select value={bWeight} onChange={(e) => setBWeight(e.target.value)} style={{ ...input, marginTop: 6 }}>{['300', '400', '500', '600', '700'].map((w) => <option key={w} value={w}>Weight {w}</option>)}</select>
          </Field>
        </div>
        <Field label="Logo URL (used as the brand mark in ads)">
          <input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" style={input} />
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="logo" style={{ height: 28, maxWidth: 140, objectFit: 'contain', marginTop: 8, background: '#f8fafc', borderRadius: 6, padding: 3, border: '1px solid #e2e8f0' }} />
          )}
        </Field>

        <Field label="Product photos">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((u) => (
              <div key={u} style={{ position: 'relative', width: 64, height: 64 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" style={{ width: '100%', height: '100%', borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                <button onClick={() => removePhoto(u)} title="Remove" style={{ position: 'absolute', top: -6, right: -6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b91c1c' }}><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} disabled={photoBusy} style={{ width: 64, height: 64, borderRadius: 8, border: '2px dashed #cbd5cb', background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: '#6b7280', fontSize: 10 }}>
              {photoBusy ? <Loader2 size={16} className="spin" /> : <><Upload size={15} /> Add</>}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={detectSite} onChange={(e) => setDetectSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} placeholder="…or detect from a website URL (blank = brand site)" style={{ ...input, flex: 1 }} />
            <button onClick={detect} disabled={photoBusy} style={btnGhost}>{photoBusy ? <Loader2 size={13} className="spin" /> : <Link2 size={14} />} Detect</button>
          </div>
          {photoMsg && <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 6 }}>{photoMsg}</div>}
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={save} disabled={busy || !name.trim()} style={{ ...btn, flex: 1, justifyContent: 'center', opacity: (busy || !name.trim()) ? 0.6 : 1 }}>{busy ? <Loader2 size={15} className="spin" /> : 'Save changes'}</button>
          <button onClick={onClose} style={btnGhost}>Done</button>
        </div>
      </div>
    </Overlay>
  )
}

function AddBrandModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [imgs, setImgs] = useState<string[]>([])
  const [kit, setKit] = useState<BrandKit>({})
  const [detecting, setDetecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const detect = async () => {
    if (!website.trim()) return
    setDetecting(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: website.trim() }) })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Could not read that site.'); return }
      if (j.brandName && !name.trim()) setName(j.brandName)
      setImgs(((Array.isArray(j.productImages) && j.productImages.length ? j.productImages : j.images) || []).slice(0, 24))
      setKit({ colors: j.colors || [], fonts: j.fonts || {}, logo: j.logo || null, palette: j.palette || {} } as any)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setDetecting(false) }
  }
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), website: website.trim() || null, product_images: imgs, brand_kit: kit }) })
      const j = await r.json()
      if (r.status === 402 && j.error === 'brand_limit_reached') { setErr(`You've used all ${j.limit} brand slots on your plan. Upgrade to add more.`); return }
      if (!r.ok) { setErr(j.error || 'Could not save brand.'); return }
      onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 22, width: 460, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#111' }}>Add a brand</div>
        <Field label="Website (we’ll auto-detect your product)">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} placeholder="yourstore.com" style={{ ...input, flex: 1 }} />
            <button onClick={detect} disabled={detecting || !website.trim()} style={btnGhost}>{detecting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Detect</button>
          </div>
        </Field>
        <Field label="Brand name"><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></Field>
        {imgs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {imgs.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
            ))}
          </div>
        )}
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={save} disabled={busy || !name.trim()} style={{ ...btn, flex: 1, justifyContent: 'center', opacity: (busy || !name.trim()) ? 0.6 : 1 }}>{busy ? <Loader2 size={15} className="spin" /> : 'Save brand'}</button>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
        </div>
      </div>
    </Overlay>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><div style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginBottom: 5 }}>{label}</div>{children}</label>
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', maxHeight: '92vh', position: 'relative', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, zIndex: 3, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        {children}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
