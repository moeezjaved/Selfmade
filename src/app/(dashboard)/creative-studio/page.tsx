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

type Gen = { id: string; image_url: string; type: string; tier: string; prompt?: string | null; brand_name?: string | null; source_ad_id?: string | null; created_at: string }
type Product = { id: string; name?: string | null; image_urls?: string[] }
type Brand = { id: string; name: string; website?: string | null; tone?: string | null; usps?: string[]; products?: Product[] }

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
                <button onClick={() => setOpen(g)} style={{ display: 'block', width: '100%', border: 'none', padding: 0, cursor: 'pointer', background: '#f1f5f1', aspectRatio: '1', overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
  const tier: 'pro' = 'pro'   // Pro-only (Nano Banana Pro)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const editCost = tier === 'pro' ? 4 : 2

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

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', maxWidth: 900 }}>
        <div style={{ background: '#0d120e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8, opacity: busy ? 0.5 : 1 }} />
          {busy && <div style={{ position: 'absolute', color: LIME, display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><Loader2 size={18} className="spin" /> Editing…</div>}
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Edit creative</div>
          <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={3}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyEdit() }}
            placeholder="Tweak this creative — headline, subhead, colors, scene, background…" style={{ ...input, resize: 'vertical' }} />
          {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>{err}</div>}
          <button onClick={applyEdit} disabled={busy || !instr.trim()} style={{ ...btn, justifyContent: 'center', opacity: (busy || !instr.trim()) ? 0.6 : 1 }}><Sparkles size={15} /> Apply edit · {editCost} cr</button>
          <a href={img} download={`creative-${gen.id}.png`} style={{ ...btnGhost, justifyContent: 'center', textDecoration: 'none' }}><Download size={15} /> Download</a>
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
  const [photos, setPhotos] = useState<string[]>((brand.products || []).flatMap((p) => p.image_urls || []))
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [detectSite, setDetectSite] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    setBusy(true)
    await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, website, tone, usps: usps.split(',').map((s) => s.trim()).filter(Boolean) }),
    })
    setBusy(false); onSaved()
  }

  const addPhotos = async (images: string[]) => {
    if (!images.length) return
    setPhotoBusy(true)
    const r = await fetch(`/api/brands/${brand.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resource: 'photos', images }) })
    const j = await r.json()
    if (Array.isArray(j.image_urls)) setPhotos(j.image_urls)
    setPhotoBusy(false)
  }
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    addPhotos(await Promise.all(Array.from(files).slice(0, 8).map(fileToDataUrl)))
  }
  const detect = async () => {
    if (!detectSite.trim()) return
    setPhotoBusy(true)
    try {
      const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: detectSite.trim() }) })
      const j = await r.json()
      if (Array.isArray(j.images) && j.images.length) await addPhotos(j.images.slice(0, 8))
    } finally { setPhotoBusy(false); setDetectSite('') }
  }
  const removePhoto = async (url: string) => {
    setPhotos((p) => p.filter((u) => u !== url))
    await fetch(`/api/brands/${brand.id}?photoUrl=${encodeURIComponent(url)}`, { method: 'DELETE' })
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 22, width: 480, maxWidth: '92vw', maxHeight: '88vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#111' }}>Edit brand</div>
        <Field label="Brand name"><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></Field>
        <Field label="Website"><input value={website} onChange={(e) => setWebsite(e.target.value)} style={input} /></Field>
        <Field label="Voice / tone"><input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. bold, playful, premium" style={input} /></Field>
        <Field label="USPs (comma-separated)"><input value={usps} onChange={(e) => setUsps(e.target.value)} placeholder="fast shipping, 30-day guarantee" style={input} /></Field>

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
            <input value={detectSite} onChange={(e) => setDetectSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} placeholder="…or detect from a website URL" style={{ ...input, flex: 1 }} />
            <button onClick={detect} disabled={photoBusy || !detectSite.trim()} style={btnGhost}><Link2 size={14} /> Detect</button>
          </div>
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
      setImgs((j.images || []).slice(0, 8))
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setDetecting(false) }
  }
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), website: website.trim() || null, product_images: imgs }) })
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
