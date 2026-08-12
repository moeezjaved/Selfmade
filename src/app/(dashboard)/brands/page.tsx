'use client'
/**
 * Brand catalog page — manage the brands + products that Clone and Script Duplicate
 * use as input. Create a brand (voice, USPs, tone), then add products with their REAL
 * photos (Clone composites those so it never hallucinates the product).
 */
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { confirmAction } from '@/components/ConfirmDialog'

// The competitor step that used to live only in onboarding — a brand with no rivals to watch
// never appears in a brief, so every creation path now offers it.
const AddCompetitors = dynamic(() => import('@/components/AddCompetitors'), { ssr: false })

interface Product { id: string; name: string; price: string | null; image_urls: string[] }
interface Brand {
  id: string; name: string; website: string | null; description: string | null
  industry: string[]; usps: string[]; tone: string | null; target_audience: string | null
  preferred_words: string[]; avoid_words: string[]; products: Product[]
  brand_type?: string
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#141d15', color: '#ff5a2c', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
const csv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
// Pasted product image URLs are often referrer/hotlink-protected → a raw <img> renders broken.
// Route through the weserv proxy (same as every other image surface). R2 objects pass through.
const cdn = (u: string, w = 72) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('cdn.tryselfmade'))
  ? u : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&q=72&output=webp`

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [watchFor, setWatchFor] = useState<{ id: string | null; name: string; website?: string | null; industry?: string[] | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // `category` is the plain-language choice shown to the user (physical | app | service); 'app' and
  // 'service' both mean "no physical product", so they map to brand_type='service' for generation.
  const [form, setForm] = useState<any>({ name: '', website: '', description: '', industry: '', usps: '', tone: '', target_audience: '', category: 'physical' })
  const isService = form.category !== 'physical'
  const [detected, setDetected] = useState<{ images: string[]; name: string } | null>(null)  // preview of URL-detected photos
  const [detectedKit, setDetectedKit] = useState<any>(null)  // logo/colors/fonts/palette from the site
  const [detecting, setDetecting] = useState(false)

  // Read the website so the user SEES what we found before creating. Physical → real product photos;
  // service/app → the site's own imagery (hero + app/product-UI screenshots + og image), never
  // Shopify product shots. Logo + colors are pulled for every type.
  const detectProducts = async () => {
    if (!form.website?.trim() || detecting) return
    setDetecting(true); setMsg(null); setDetected(null)
    try {
      const dr = await fetch('/api/discovery/detect-product', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: form.website.trim() }),
      }).then((x) => x.json())
      setDetectedKit({ colors: dr?.colors || [], fonts: dr?.fonts || null, logo: dr?.logo || null, palette: dr?.palette || null })
      if (isService) {
        const prod = new Set<string>(dr?.productImages || [])
        const imgs = (dr?.images || []).filter((u: string) => !prod.has(u)).slice(0, 12)
        setDetected({ images: imgs, name: (dr?.brandName || '').trim() })
        setMsg(imgs.length
          ? { ok: true, text: `Found ${imgs.length} screenshot${imgs.length === 1 ? '' : 's'}${dr?.logo ? ' + your logo' : ''}${dr?.colors?.length ? ' & colors' : ''}.` }
          : { ok: false, text: 'No screenshots found — you can still create the brand and upload screenshots after.' })
        if (dr?.brandName && !form.name.trim()) setForm((f: any) => ({ ...f, name: dr.brandName }))
      } else {
        const imgs = Array.isArray(dr?.productImages) ? dr.productImages.slice(0, 12) : []
        setDetected({ images: imgs, name: (dr?.productTitle || dr?.brandName || '').trim() })
        if (!imgs.length) setMsg({ ok: false, text: 'No product photos found on that URL — you can still create the brand and add photos manually.' })
        else if (dr?.productTitle && !form.name.trim()) setForm((f: any) => ({ ...f, name: dr.brandName || f.name }))
      }
    } catch { setMsg({ ok: false, text: 'Could not read that site — check the URL.' }) }
    finally { setDetecting(false) }
  }
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/brands'); const d = await r.json()
    setBrands(d.brands || []); if (d.quota) setQuota(d.quota); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const createBrand = async () => {
    if (!form.name.trim() || saving) return
    setSaving(true); setMsg(null)
    try {
      // Read the website so the brand is immediately usable in Remake — physical → real product
      // photos (Shopify /products.json + og/JSON-LD); service/app → the site's own screenshots/hero
      // imagery. Prefer what the user already previewed; otherwise detect inline now (best-effort).
      let images: string[] = detected?.images || []
      let detectedName = detected?.name || ''
      let kit: any = detectedKit
      if (!detected && form.website?.trim()) {
        setMsg({ ok: true, text: isService ? 'Reading your site…' : 'Detecting products from your site…' })
        try {
          const dr = await fetch('/api/discovery/detect-product', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: form.website.trim() }),
          }).then((x) => x.json())
          if (isService) {
            const prod = new Set<string>(dr?.productImages || [])
            images = (dr?.images || []).filter((u: string) => !prod.has(u)).slice(0, 12)
            detectedName = (dr?.brandName || '').trim()
          } else {
            images = Array.isArray(dr?.productImages) ? dr.productImages.slice(0, 12) : []
            detectedName = (dr?.productTitle || '').trim()
          }
          kit = { colors: dr?.colors || [], fonts: dr?.fonts || null, logo: dr?.logo || null, palette: dr?.palette || null }
        } catch { /* detection is best-effort — brand still saves without it */ }
      }
      const r = await fetch('/api/brands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, brand_type: isService ? 'service' : 'physical', brand_kit: { ...(kit || {}), category: form.category }, industry: csv(form.industry), usps: csv(form.usps), product_images: images, product_name: detectedName || undefined }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Most common: the plan's brand slots are used up (was failing silently → "nothing happens").
        setMsg({ ok: false, text: d.message || (d.error === 'brand_limit_reached'
          ? `You’ve used all ${d.limit ?? ''} brand slots on your plan — upgrade to add more.`
          : d.error || 'Could not save the brand. Please try again.') })
        return
      }
      setForm({ name: '', website: '', description: '', industry: '', usps: '', tone: '', target_audience: '', category: 'physical' })
      setDetected(null); setDetectedKit(null); setCreating(false)
      setMsg({ ok: true, text: images.length ? `✓ “${(d.brand?.name || form.name)}” saved with ${images.length} product photo${images.length === 1 ? '' : 's'}.` : `✓ “${(d.brand?.name || form.name)}” saved.` })
      await load()
      // A brand with nothing to watch produces an empty brief — ask now, while intent is high.
      setWatchFor({ id: d.brand?.id || null, name: d.brand?.name || form.name, website: form.website || null, industry: csv(form.industry) })
    } catch { setMsg({ ok: false, text: 'Network error — please try again.' }) }
    finally { setSaving(false) }
  }
  const delBrand = async (id: string) => { if (await confirmAction({ title: 'Delete this brand and its products?', body: 'This can’t be undone.' })) { await fetch(`/api/brands/${id}`, { method: 'DELETE' }); load() } }
  const setBrandType = async (id: string, brand_type: string) => { await fetch(`/api/brands/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand_type }) }); load() }
  const editBrand = async (id: string, patch: { name: string; website: string; tone: string }) => {
    await fetch(`/api/brands/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    load()
  }
  const addProduct = async (brandId: string, name: string, price: string, imageUrl: string) => {
    await fetch(`/api/brands/${brandId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource: 'product', name, price, image_urls: imageUrl ? [imageUrl] : [] }),
    }); load()
  }
  const delProduct = async (brandId: string, productId: string) => { await fetch(`/api/brands/${brandId}?productId=${productId}`, { method: 'DELETE' }); load() }

  return (
    <div style={{ padding: 28, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>Brands</h1>
          {quota && <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>{quota.limit < 0 ? `${quota.used} · unlimited on your plan` : `${quota.used} / ${quota.limit} used`}</span>}
        </div>
        {/* New brand runs the FULL onboarding interview (same as the brief's switcher) — consistent entry,
            not the lighter inline form. The inline create form below is kept for now but no longer the path. */}
        <button style={btn} onClick={() => { window.location.href = '/onboarding?new=1' }}>+ New brand</button>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>Your brands feed Remake and Script Duplicate — voice, USPs, and real product photos.</p>

      {creating && (
        <div style={{ ...card, marginBottom: 20 }}>
          {/* What kind of brand — a physical product (we composite real product photos) or a
              service/app/website (the creator talks about it; we never render a physical product). */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#3a382f', marginBottom: 7 }}>What are you promoting?</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                ['physical', '🧴 A physical product', 'Something you ship — a bottle, box, gadget, apparel. We place your real product photos into ads.'],
                ['app', '📱 An app or website', 'Software, a SaaS tool, or an online platform. We never render a physical product.'],
                ['service', '🛠️ A service', 'You do something for people — agency, coaching, salon, clinic. The creator talks about it.'],
              ].map(([v, label, sub]) => {
                const on = form.category === v
                return (
                  <button key={v} type="button" onClick={() => { setForm({ ...form, category: v }); setDetected(null) }}
                    style={{ flex: '1 1 180px', textAlign: 'left', border: `1.5px solid ${on ? '#a8cf6f' : '#e2e8f0'}`, background: on ? '#f4fbe6' : '#fff', borderRadius: 12, padding: '10px 13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#2c4a1f' : '#111' }}>{label}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <input style={input} placeholder="Brand name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...input, flex: 1 }} placeholder={isService ? 'Website (for your logo, colors & screenshots)' : 'Website or product URL'} value={form.website}
              onChange={e => { setForm({ ...form, website: e.target.value }); setDetected(null); setDetectedKit(null) }}
              onKeyDown={e => e.key === 'Enter' && detectProducts()} />
            <button type="button" onClick={detectProducts} disabled={detecting || !form.website.trim()}
              style={{ ...btn, whiteSpace: 'nowrap', opacity: (detecting || !form.website.trim()) ? 0.6 : 1 }}>
              {detecting ? 'Reading…' : isService ? 'Detect from site' : 'Detect photos'}
            </button>
          </div>
          {isService && <div style={{ fontSize: 11.5, color: '#6b7280', margin: '2px 0 8px' }}>We’ll pull your <b>logo, colors and any screenshots</b> from the site — no physical product is ever invented. You can also upload more screenshots on the brand after saving.</div>}
          {detected && (
            <div style={{ margin: '4px 0 10px' }}>
              {detected.images.length ? (
                <>
                  <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 6 }}>✓ Found {detected.images.length} {isService ? 'screenshot' : 'product photo'}{detected.images.length === 1 ? '' : 's'}{detected.name ? ` — ${detected.name}` : ''}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6 }}>
                    {detected.images.map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={cdn(u, 128)} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb' }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 5 }}>These become your brand’s {isService ? 'screenshots' : 'product photos'} for Remake. Create the brand to save them.</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: '#b45309' }}>No {isService ? 'screenshots' : 'product photos'} found — you can still create the brand and add {isService ? 'screenshots' : 'photos'} manually.</div>
              )}
            </div>
          )}
          <textarea style={{ ...input, minHeight: 60 }} placeholder="Description — what the brand sells" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <input style={input} placeholder="Industries (comma-separated)" value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} />
          <input style={input} placeholder="USPs (comma-separated)" value={form.usps} onChange={e => setForm({ ...form, usps: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={input} placeholder="Tone (e.g. confident, scientific)" value={form.tone} onChange={e => setForm({ ...form, tone: e.target.value })} />
            <input style={input} placeholder="Target audience" value={form.target_audience} onChange={e => setForm({ ...form, target_audience: e.target.value })} />
          </div>
          <button style={{ ...btn, opacity: saving ? 0.7 : 1, cursor: saving ? 'default' : 'pointer' }} onClick={createBrand} disabled={saving}>{saving ? 'Saving…' : 'Create brand'}</button>
        </div>
      )}

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: msg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}`, color: msg.ok ? '#15803d' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      {loading ? <div style={{ color: '#9ca3af' }}>Loading…</div>
        : brands.length === 0 ? <div style={{ ...card, color: '#9ca3af', textAlign: 'center' }}>No brands yet — create your first to start remaking ads.</div>
        : brands.map(b => <BrandCard key={b.id} brand={b} onDelete={() => delBrand(b.id)} onWatch={() => setWatchFor({ id: b.id, name: b.name, website: b.website, industry: b.industry })} onEdit={editBrand} onSetType={setBrandType} onAddProduct={addProduct} onDelProduct={delProduct} />)}

      {watchFor && (
        <AddCompetitors brandId={watchFor.id} brandName={watchFor.name} website={watchFor.website} industry={watchFor.industry}
          onClose={() => setWatchFor(null)}
          onDone={(n) => setMsg({ ok: true, text: `✓ Watching ${n} competitor${n === 1 ? '' : 's'} for ${watchFor.name} — their new ads will land in your brief.` })} />
      )}
    </div>
  )
}

function BrandCard({ brand, onDelete, onWatch, onEdit, onSetType, onAddProduct, onDelProduct }: {
  brand: Brand; onDelete: () => void; onWatch: () => void
  onEdit: (id: string, patch: { name: string; website: string; tone: string }) => void
  onSetType: (id: string, t: string) => void
  onAddProduct: (b: string, n: string, p: string, i: string) => void
  onDelProduct: (b: string, p: string) => void
}) {
  const isSvc = brand.brand_type === 'service'
  const [p, setP] = useState({ name: '', price: '', image: '' })
  const [editing, setEditing] = useState(false)
  const [ef, setEf] = useState({ name: brand.name, website: brand.website || '', tone: brand.tone || '' })
  const resetEf = () => setEf({ name: brand.name, website: brand.website || '', tone: brand.tone || '' })
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        {editing ? (
          <div style={{ flex: 1 }}>
            <input style={input} placeholder="Brand name" value={ef.name} onChange={e => setEf({ ...ef, name: e.target.value })} />
            <input style={input} placeholder="Website (https://…)" value={ef.website} onChange={e => setEf({ ...ef, website: e.target.value })} />
            <input style={{ ...input, marginBottom: 0 }} placeholder="Tone (e.g. bold, playful, warm)" value={ef.tone} onChange={e => setEf({ ...ef, tone: e.target.value })} />
          </div>
        ) : (
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#111', wordBreak: 'break-word' }}>{brand.name}</div>
              <button onClick={() => onSetType(brand.id, isSvc ? 'physical' : 'service')}
                title="Click to switch — service brands never render a physical product"
                style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, cursor: 'pointer', border: `1px solid ${isSvc ? '#c7d2fe' : '#e2e8f0'}`, background: isSvc ? '#e0e7ff' : '#f1f5f9', color: isSvc ? '#3730a3' : '#475569' }}>
                {isSvc ? '💻 Service' : '🧴 Product'}
              </button>
            </div>
            {brand.website && <div style={{ fontSize: 12, color: '#6b7280' }}>{brand.website}</div>}
            {brand.tone && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Tone: {brand.tone}</div>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          {editing ? (
            <>
              <button onClick={() => { if (ef.name.trim()) { onEdit(brand.id, ef); setEditing(false) } }} style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Save</button>
              <button onClick={() => { resetEf(); setEditing(false) }} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => { resetEf(); setEditing(true) }} style={{ background: 'none', border: 'none', color: '#141d15', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Edit</button>
              <button onClick={onWatch} style={{ background: 'none', border: 'none', color: '#ef4a1e', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Watch competitors</button>
              <button onClick={onDelete} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Delete</button>
            </>
          )}
        </div>
      </div>
      {brand.usps?.length > 0 && <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>USPs: {brand.usps.join(' · ')}</div>}

      <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>PRODUCTS ({brand.products?.length || 0})</div>
        {brand.products?.map(pr => (
          <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            {pr.image_urls?.[0] && <img src={cdn(pr.image_urls[0])} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />}
            <div style={{ flex: 1, fontSize: 13 }}>{pr.name} {pr.price && <span style={{ color: '#6b7280' }}>· {pr.price}</span>}</div>
            <button onClick={() => onDelProduct(brand.id, pr.id)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 11 }}>remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input style={{ ...input, marginBottom: 0, flex: 2 }} placeholder="Product name" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} />
          <input style={{ ...input, marginBottom: 0, flex: 1 }} placeholder="Price" value={p.price} onChange={e => setP({ ...p, price: e.target.value })} />
          <input style={{ ...input, marginBottom: 0, flex: 2 }} placeholder="Product image URL" value={p.image} onChange={e => setP({ ...p, image: e.target.value })} />
          <button style={{ ...btn, padding: '8px 12px' }} onClick={() => { if (p.name) { onAddProduct(brand.id, p.name, p.price, p.image); setP({ name: '', price: '', image: '' }) } }}>Add</button>
        </div>
      </div>
    </div>
  )
}
