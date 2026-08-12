'use client'
/**
 * Admin → Experts. Curate the Top Picks: add experts, build their packs (pricing, early-bird,
 * gate), and attach ads from the corpus with a Canva template URL each.
 */
import { useEffect, useState, useCallback } from 'react'

const DARK = '#141d15', LIME = '#ff5a2c'
const dollars = (c: number) => (c / 100).toFixed(2)

interface Pack {
  id: string; expert_id: string; title: string; description: string | null; cover_url: string | null
  price_cents: number; original_price_cents: number | null; is_early_bird: boolean
  gate: 'free' | 'core' | 'paid'; sort_order: number; is_published: boolean; ad_count: number
}
interface Expert {
  id: string; name: string; handle: string | null; avatar_url: string | null; bio: string | null
  revenue_share_pct: number; sort_order: number; is_published: boolean; expert_packs: Pack[]
}
interface PackAd { id: string; ad_id: string; position: number; canva_template_url: string | null; page_name: string; copy: string; thumbnail: string | null }
interface SearchHit { ad_id: string; page_name: string; copy: string; is_active: boolean; days_running: number | null; thumbnail: string | null }

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 14 }
const inp: React.CSSProperties = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', width: '100%' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }
const btn = (primary = true): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid #d1d5db', background: primary ? DARK : '#fff', color: primary ? LIME : '#374151', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' })

export default function AdminExpertsPage() {
  const [experts, setExperts] = useState<Expert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editExpert, setEditExpert] = useState<Partial<Expert> | null>(null)
  const [editPack, setEditPack] = useState<Partial<Pack> | null>(null)
  const [adsPackId, setAdsPackId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/experts')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setExperts(d.experts || [])
    } catch (e) { setError(e instanceof Error ? e.message : 'failed') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const saveExpert = async () => {
    if (!editExpert?.name?.trim()) return
    try {
      const r = await fetch('/api/admin/experts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editExpert) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      setEditExpert(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'save failed') }
  }
  const delExpert = async (id: string) => {
    if (!confirm('Delete this expert and all their packs?')) return
    await fetch(`/api/admin/experts?id=${id}`, { method: 'DELETE' }); await load()
  }
  const savePack = async () => {
    if (!editPack?.title?.trim() || !editPack.expert_id) return
    try {
      const r = await fetch('/api/admin/experts/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editPack) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      setEditPack(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'save failed') }
  }
  const delPack = async (id: string) => {
    if (!confirm('Delete this pack?')) return
    await fetch(`/api/admin/experts/packs?id=${id}`, { method: 'DELETE' }); await load()
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 4 }}>Experts & Top Picks</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Curate experts, build their packs, and attach ads with a Canva template each. Published packs show on <code>/discovery/top-picks</code>.</p>
      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      <button onClick={() => setEditExpert({ revenue_share_pct: 50, sort_order: experts.length, is_published: false })} style={{ ...btn(), marginBottom: 16 }}>+ New expert</button>

      {loading ? <div style={{ color: '#9ca3af' }}>Loading…</div> : experts.map(ex => (
        <div key={ex.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {ex.avatar_url ? <img src={ex.avatar_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 40, height: 40, borderRadius: '50%', background: DARK, color: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{ex.name.slice(0, 1)}</div>}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>{ex.name} {ex.handle && <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: 13 }}>@{ex.handle.replace(/^@/, '')}</span>}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{ex.expert_packs.length} pack(s) · {ex.revenue_share_pct}% share · {ex.is_published ? <span style={{ color: '#059669', fontWeight: 700 }}>Published</span> : <span style={{ color: '#9ca3af' }}>Draft</span>}</div>
            </div>
            <button onClick={() => setEditExpert(ex)} style={btn(false)}>Edit</button>
            <button onClick={() => setEditPack({ expert_id: ex.id, gate: 'paid', price_cents: 9900, is_early_bird: false, is_published: false, sort_order: ex.expert_packs.length })} style={btn(false)}>+ Pack</button>
            <button onClick={() => delExpert(ex.id)} style={{ ...btn(false), color: '#dc2626', borderColor: '#fecaca' }}>Delete</button>
          </div>

          {/* Packs */}
          {ex.expert_packs.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ex.expert_packs.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: '#111', flex: 1 }}>{p.title}</span>
                  <span style={{ color: '#6b7280' }}>{p.ad_count} ads</span>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: p.gate === 'free' ? '#dcfce7' : p.gate === 'core' ? '#f3e8ff' : '#fef9c3', color: p.gate === 'free' ? '#166534' : p.gate === 'core' ? '#7e22ce' : '#854d0e' }}>{p.gate}</span>
                  <span style={{ fontWeight: 700, color: DARK, width: 64, textAlign: 'right' }}>{p.gate === 'free' || !p.price_cents ? 'Free' : `$${dollars(p.price_cents)}`}</span>
                  {p.is_early_bird && <span style={{ fontSize: 10, fontWeight: 800, color: '#854d0e' }}>⚡EB</span>}
                  <span style={{ fontSize: 11, color: p.is_published ? '#059669' : '#9ca3af', fontWeight: 700 }}>{p.is_published ? '● live' : '○ draft'}</span>
                  <button onClick={() => setAdsPackId(p.id)} style={{ ...btn(false), padding: '4px 10px', fontSize: 12 }}>Ads</button>
                  <button onClick={() => setEditPack(p)} style={{ ...btn(false), padding: '4px 10px', fontSize: 12 }}>Edit</button>
                  <button onClick={() => delPack(p.id)} style={{ ...btn(false), padding: '4px 10px', fontSize: 12, color: '#dc2626', borderColor: '#fecaca' }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {editExpert && <ExpertModal value={editExpert} onChange={setEditExpert} onSave={saveExpert} onClose={() => setEditExpert(null)} />}
      {editPack && <PackModal value={editPack} onChange={setEditPack} onSave={savePack} onClose={() => setEditPack(null)} />}
      {adsPackId && <AdsModal packId={adsPackId} onClose={() => { setAdsPackId(null); load() }} />}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 22 }}>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#111', margin: '0 0 16px' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function ExpertModal({ value, onChange, onSave, onClose }: { value: Partial<Expert>; onChange: (v: Partial<Expert>) => void; onSave: () => void; onClose: () => void }) {
  const set = (k: keyof Expert, v: any) => onChange({ ...value, [k]: v })
  return (
    <Modal title={value.id ? 'Edit expert' : 'New expert'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label style={lbl}>Name</label><input style={inp} value={value.name || ''} onChange={e => set('name', e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Handle</label><input style={inp} value={value.handle || ''} onChange={e => set('handle', e.target.value)} placeholder="username" /></div>
          <div><label style={lbl}>Revenue share %</label><input type="number" style={inp} value={value.revenue_share_pct ?? 50} onChange={e => set('revenue_share_pct', Number(e.target.value))} /></div>
        </div>
        <div><label style={lbl}>Avatar URL</label><input style={inp} value={value.avatar_url || ''} onChange={e => set('avatar_url', e.target.value)} placeholder="https://…" /></div>
        <div><label style={lbl}>Bio</label><textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={value.bio || ''} onChange={e => set('bio', e.target.value)} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={!!value.is_published} onChange={e => set('is_published', e.target.checked)} /> Published</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><label style={{ fontSize: 13 }}>Sort</label><input type="number" style={{ ...inp, width: 70 }} value={value.sort_order ?? 0} onChange={e => set('sort_order', Number(e.target.value))} /></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <button style={btn(false)} onClick={onClose}>Cancel</button>
        <button style={btn()} onClick={onSave}>Save</button>
      </div>
    </Modal>
  )
}

function PackModal({ value, onChange, onSave, onClose }: { value: Partial<Pack>; onChange: (v: Partial<Pack>) => void; onSave: () => void; onClose: () => void }) {
  const set = (k: keyof Pack, v: any) => onChange({ ...value, [k]: v })
  return (
    <Modal title={value.id ? 'Edit pack' : 'New pack'} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label style={lbl}>Title</label><input style={inp} value={value.title || ''} onChange={e => set('title', e.target.value)} placeholder="e.g. 50 winning DTC static ads" /></div>
        <div><label style={lbl}>Description</label><textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={value.description || ''} onChange={e => set('description', e.target.value)} /></div>
        <div><label style={lbl}>Cover image URL</label><input style={inp} value={value.cover_url || ''} onChange={e => set('cover_url', e.target.value)} placeholder="https://…" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Gate</label>
            <select style={inp} value={value.gate || 'paid'} onChange={e => set('gate', e.target.value)}>
              <option value="free">free</option><option value="core">core</option><option value="paid">paid</option>
            </select>
          </div>
          <div><label style={lbl}>Price ¢</label><input type="number" style={inp} value={value.price_cents ?? 0} onChange={e => set('price_cents', Number(e.target.value))} /><div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>${dollars(value.price_cents || 0)}</div></div>
          <div><label style={lbl}>Was ¢</label><input type="number" style={inp} value={value.original_price_cents ?? ''} onChange={e => set('original_price_cents', e.target.value === '' ? null : Number(e.target.value))} placeholder="—" /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={!!value.is_early_bird} onChange={e => set('is_early_bird', e.target.checked)} /> Early bird ⚡</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={!!value.is_published} onChange={e => set('is_published', e.target.checked)} /> Published</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><label style={{ fontSize: 13 }}>Sort</label><input type="number" style={{ ...inp, width: 64 }} value={value.sort_order ?? 0} onChange={e => set('sort_order', Number(e.target.value))} /></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <button style={btn(false)} onClick={onClose}>Cancel</button>
        <button style={btn()} onClick={onSave}>Save</button>
      </div>
    </Modal>
  )
}

function AdsModal({ packId, onClose }: { packId: string; onClose: () => void }) {
  const [ads, setAds] = useState<PackAd[]>([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadAds = useCallback(async () => {
    const r = await fetch(`/api/admin/experts/packs/ads?packId=${packId}`)
    const d = await r.json(); if (r.ok) setAds(d.ads || [])
  }, [packId])
  useEffect(() => { loadAds() }, [loadAds])

  const search = async () => {
    if (!q.trim()) return
    setSearching(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/experts/packs/ads?q=${encodeURIComponent(q.trim())}`)
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'failed'); setHits(d.results || [])
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed') } finally { setSearching(false) }
  }
  const add = async (ad_id: string) => {
    await fetch('/api/admin/experts/packs/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack_id: packId, ad_id, position: ads.length }) })
    await loadAds()
  }
  const setCanva = async (a: PackAd, url: string) => {
    setAds(prev => prev.map(x => x.id === a.id ? { ...x, canva_template_url: url } : x))
  }
  const saveCanva = async (a: PackAd) => {
    await fetch('/api/admin/experts/packs/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack_id: packId, ad_id: a.ad_id, canva_template_url: a.canva_template_url, position: a.position }) })
  }
  const remove = async (id: string) => { await fetch(`/api/admin/experts/packs/ads?id=${id}`, { method: 'DELETE' }); await loadAds() }
  const inPack = new Set(ads.map(a => a.ad_id))

  return (
    <Modal title="Pack ads & Canva templates" onClose={onClose}>
      {/* Search corpus */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={inp} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Search ads by brand, copy, or ad_id…" />
        <button style={btn()} onClick={search} disabled={searching}>{searching ? '…' : 'Search'}</button>
      </div>
      {err && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {hits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 200, overflow: 'auto', border: '1px solid #f1f5f9', borderRadius: 8, padding: 8 }}>
          {hits.map(h => (
            <div key={h.ad_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              {h.thumbnail ? <img src={h.thumbnail} alt="" style={{ width: 32, height: 32, borderRadius: 5, objectFit: 'cover' }} /> : <div style={{ width: 32, height: 32, borderRadius: 5, background: '#f1f5f9' }} />}
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, color: '#111' }}>{h.page_name}</div><div style={{ color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.copy}</div></div>
              {inPack.has(h.ad_id) ? <span style={{ color: '#059669', fontWeight: 700 }}>✓ added</span> : <button style={{ ...btn(), padding: '4px 10px', fontSize: 12 }} onClick={() => add(h.ad_id)}>Add</button>}
            </div>
          ))}
        </div>
      )}

      {/* Current pack ads */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>In this pack ({ads.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ads.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            {a.thumbnail ? <img src={a.thumbnail} alt="" style={{ width: 36, height: 36, borderRadius: 5, objectFit: 'cover' }} /> : <div style={{ width: 36, height: 36, borderRadius: 5, background: '#f1f5f9' }} />}
            <div style={{ width: 110, minWidth: 0 }}><div style={{ fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.page_name}</div></div>
            <input style={{ ...inp, flex: 1 }} value={a.canva_template_url || ''} onChange={e => setCanva(a, e.target.value)} onBlur={() => saveCanva(a)} placeholder="Canva template URL…" />
            <button style={{ ...btn(false), padding: '5px 10px', color: '#dc2626', borderColor: '#fecaca' }} onClick={() => remove(a.id)}>×</button>
          </div>
        ))}
        {ads.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No ads yet — search above to add some.</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}><button style={btn()} onClick={onClose}>Done</button></div>
    </Modal>
  )
}
