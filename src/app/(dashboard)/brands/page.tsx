'use client'
/**
 * Brand catalog page — manage the brands + products that Clone and Script Duplicate
 * use as input. Create a brand (voice, USPs, tone), then add products with their REAL
 * photos (Clone composites those so it never hallucinates the product).
 */
import { useEffect, useState } from 'react'

interface Product { id: string; name: string; price: string | null; image_urls: string[] }
interface Brand {
  id: string; name: string; website: string | null; description: string | null
  industry: string[]; usps: string[]; tone: string | null; target_audience: string | null
  preferred_words: string[]; avoid_words: string[]; products: Product[]
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1a3a1a', color: '#dffe95', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
const csv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [form, setForm] = useState<any>({ name: '', website: '', description: '', industry: '', usps: '', tone: '', target_audience: '' })
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
      const r = await fetch('/api/brands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, industry: csv(form.industry), usps: csv(form.usps) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Most common: the plan's brand slots are used up (was failing silently → "nothing happens").
        setMsg({ ok: false, text: d.message || (d.error === 'brand_limit_reached'
          ? `You’ve used all ${d.limit ?? ''} brand slots on your plan — upgrade to add more.`
          : d.error || 'Could not save the brand. Please try again.') })
        return
      }
      setForm({ name: '', website: '', description: '', industry: '', usps: '', tone: '', target_audience: '' })
      setCreating(false); setMsg({ ok: true, text: `✓ “${(d.brand?.name || form.name)}” saved.` })
      await load()
    } catch { setMsg({ ok: false, text: 'Network error — please try again.' }) }
    finally { setSaving(false) }
  }
  const delBrand = async (id: string) => { if (confirm('Delete this brand and its products?')) { await fetch(`/api/brands/${id}`, { method: 'DELETE' }); load() } }
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
        <button style={btn} onClick={() => setCreating(v => !v)}>{creating ? 'Cancel' : '+ New brand'}</button>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>Your brands feed Clone and Script Duplicate — voice, USPs, and real product photos.</p>

      {creating && (
        <div style={{ ...card, marginBottom: 20 }}>
          <input style={input} placeholder="Brand name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input style={input} placeholder="Website" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
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
        : brands.length === 0 ? <div style={{ ...card, color: '#9ca3af', textAlign: 'center' }}>No brands yet — create your first to start cloning ads.</div>
        : brands.map(b => <BrandCard key={b.id} brand={b} onDelete={() => delBrand(b.id)} onAddProduct={addProduct} onDelProduct={delProduct} />)}
    </div>
  )
}

function BrandCard({ brand, onDelete, onAddProduct, onDelProduct }: {
  brand: Brand; onDelete: () => void
  onAddProduct: (b: string, n: string, p: string, i: string) => void
  onDelProduct: (b: string, p: string) => void
}) {
  const [p, setP] = useState({ name: '', price: '', image: '' })
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{brand.name}</div>
          {brand.website && <div style={{ fontSize: 12, color: '#6b7280' }}>{brand.website}</div>}
          {brand.tone && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Tone: {brand.tone}</div>}
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Delete</button>
      </div>
      {brand.usps?.length > 0 && <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>USPs: {brand.usps.join(' · ')}</div>}

      <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>PRODUCTS ({brand.products?.length || 0})</div>
        {brand.products?.map(pr => (
          <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            {pr.image_urls?.[0] && <img src={pr.image_urls[0]} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />}
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
