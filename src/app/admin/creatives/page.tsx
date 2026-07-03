'use client'
import { useEffect, useState } from 'react'

type C = { id: string; image_url: string | null; type: string; media_type: string; status: string; tier: string; prompt: string | null; created_at: string; email: string; name: string; brand: string | null }
const fmt = (d: string) => new Date(d).toLocaleString()

export default function AdminCreatives() {
  const [items, setItems] = useState<C[]>([])
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => { setLoading(true); fetch(`/api/admin/creatives${type ? `?type=${type}` : ''}`).then(r => r.json()).then(j => setItems(j.creatives || [])).finally(() => setLoading(false)) }
  useEffect(load, [type])

  const shown = items.filter(c => !q || c.email.toLowerCase().includes(q.toLowerCase()) || (c.brand || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <div style={{ padding: 28, color: '#111' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Creatives</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>Everything users generate — with who made it.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['', 'clone', 'edit', 'animated', 'inspired'].map(t => (
          <button key={t || 'all'} onClick={() => setType(t)} style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid #e2e8f0', background: type === t ? '#111' : '#fff', color: type === t ? '#fff' : '#111', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, textTransform: 'capitalize' }}>{t || 'all'}</button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email or brand" style={{ marginLeft: 'auto', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, minWidth: 220 }} />
        <button onClick={load} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Refresh</button>
      </div>

      {loading ? <div style={{ color: '#9ca3af' }}>Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
          {shown.map(c => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '1', background: '#0d120e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {c.status === 'processing' ? <span style={{ color: '#dffe95', fontSize: 12 }}>Generating…</span>
                  : c.media_type === 'video' && c.image_url ? <video src={c.image_url} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={c.image_url || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
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
