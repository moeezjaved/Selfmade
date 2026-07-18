'use client'
import { useEffect, useState } from 'react'

type C = { id: string; image_url: string | null; type: string; media_type: string; status: string; tier: string; prompt: string | null; created_at: string; email: string; name: string; brand: string | null; source_ad_id?: string | null; source_thumb?: string | null; featured?: boolean }
const fmt = (d: string) => new Date(d).toLocaleString()

export default function AdminCreatives() {
  const [items, setItems] = useState<C[]>([])
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [featOnly, setFeatOnly] = useState(false)

  const load = () => { setLoading(true); fetch(`/api/admin/creatives${type ? `?type=${type}` : ''}`).then(r => r.json()).then(j => setItems(j.creatives || [])).finally(() => setLoading(false)) }
  useEffect(load, [type])

  // Toggle whether a creative appears in the public "Made with Selfmade" landing showcase.
  const toggleFeature = async (c: C) => {
    const next = !c.featured
    setItems(prev => prev.map(x => x.id === c.id ? { ...x, featured: next } : x))   // optimistic
    const r = await fetch('/api/admin/creatives', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id, featured: next }) })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      alert(j.error || 'Could not update')
      setItems(prev => prev.map(x => x.id === c.id ? { ...x, featured: !next } : x))   // revert
    }
  }
  const featuredCount = items.filter(c => c.featured).length

  const shown = items.filter(c => (!q || c.email.toLowerCase().includes(q.toLowerCase()) || (c.brand || '').toLowerCase().includes(q.toLowerCase())) && (!featOnly || c.featured))

  return (
    <div style={{ padding: 28, color: '#111' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Creatives</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>Everything users generate — with who made it.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['', 'clone', 'edit', 'animated', 'inspired'].map(t => (
          <button key={t || 'all'} onClick={() => setType(t)} style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid #e2e8f0', background: type === t ? '#111' : '#fff', color: type === t ? '#fff' : '#111', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, textTransform: 'capitalize' }}>{t || 'all'}</button>
        ))}
        <button onClick={() => setFeatOnly(v => !v)} title="Ads shown in the public landing showcase" style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${featOnly ? '#a16207' : '#e2e8f0'}`, background: featOnly ? '#fef9c3' : '#fff', color: featOnly ? '#854d0e' : '#111', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>★ Featured {featuredCount}/12</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email or brand" style={{ marginLeft: 'auto', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, minWidth: 220 }} />
        <button onClick={load} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Refresh</button>
      </div>

      {loading ? <div style={{ color: '#9ca3af' }}>Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
          {shown.map(c => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '1', background: '#0d120e', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {c.status === 'processing' || c.status === 'analyzing' ? <span style={{ color: '#dffe95', fontSize: 12 }}>{c.status === 'analyzing' ? 'Analyzing…' : 'Generating…'}</span>
                  : !c.image_url ? <span style={{ color: '#9aa79a', fontSize: 11, textAlign: 'center', padding: 8 }}>{c.status === 'failed' ? '⚠️ Failed' : '📝 Draft · no output'}</span>
                  : c.media_type === 'video'
                    // Controls + first-frame preview (no autoplay) so admins can actually watch it.
                    ? <video src={c.image_url} controls muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
                    // Click the image to open it full-size in a new tab.
                    // eslint-disable-next-line @next/next/no-img-element
                    : <a href={c.image_url} target="_blank" rel="noreferrer" style={{ width: '100%', height: '100%', display: 'block' }}><img src={c.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></a>}
                {/* "Cloned from" — the source ad this creative was made from. Click to open it in Discovery. */}
                {(c.source_thumb || c.source_ad_id) && (
                  <a href={c.source_ad_id ? `/discovery/${c.source_ad_id}` : undefined} target="_blank" rel="noreferrer"
                    title="Cloned from this ad — click to open the source" onClick={e => e.stopPropagation()}
                    style={{ position: 'absolute', top: 6, left: 6, width: 40, borderRadius: 6, overflow: 'hidden', border: '1.5px solid rgba(255,255,255,0.85)', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', textDecoration: 'none', background: '#000', display: 'block' }}>
                    {c.source_thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={c.source_thumb} alt="source ad" style={{ width: '100%', height: 50, objectFit: 'cover', display: 'block' }} />
                      : <div style={{ width: '100%', height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa79a', fontSize: 9 }}>ad ↗</div>}
                    <div style={{ fontSize: 7.5, fontWeight: 800, color: '#fff', textAlign: 'center', letterSpacing: '.05em', padding: '1px 0', background: 'rgba(0,0,0,0.75)' }}>SOURCE</div>
                  </a>
                )}
                {/* Feature on the public "Made with Selfmade" landing showcase (image or video). */}
                {c.image_url && c.status !== 'processing' && c.status !== 'analyzing' && (
                  <button onClick={() => toggleFeature(c)} title={c.featured ? 'Featured on landing — click to remove' : 'Feature on landing showcase'}
                    style={{ position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer', background: c.featured ? '#facc15' : 'rgba(0,0,0,0.55)', color: c.featured ? '#7c2d12' : '#fff', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>
                    {c.featured ? '★' : '☆'}
                  </button>
                )}
              </div>
              <div style={{ padding: '9px 11px' }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, background: '#eef5eb', color: '#3f6b3f', borderRadius: 5, padding: '2px 6px', textTransform: 'capitalize' }}>{c.type}</span>
                  {c.media_type === 'video' && <span style={{ fontSize: 10, fontWeight: 700, background: '#111', color: '#fff', borderRadius: 5, padding: '2px 6px' }}>🎬</span>}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.email}>{c.email || '—'}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.brand || '—'} · {fmt(c.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && shown.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>No creatives.</div>}
    </div>
  )
}
