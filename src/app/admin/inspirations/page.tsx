'use client'
/**
 * Admin — AI Ad Studio inspiration library. Drag-drop images → uploaded to R2 + auto-tagged by
 * Gemini vision. These are the aesthetic ground truth every generated ad draws from.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Insp = { id: string; r2_url: string; niche: string | null; format: string | null; aspect: string | null; palette: string[] | null; style_tags: string[] | null; layout_type: string | null; tagged: boolean }

const BATCH = 6   // upload N per request (each does a vision call) to stay under the function timeout

export default function InspirationsAdmin() {
  const [items, setItems] = useState<Insp[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const j = await fetch('/api/admin/inspirations').then(r => r.json()).catch(() => ({ inspirations: [] }))
    setItems(j.inspirations || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f)
  })

  const handleFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    setUploading(true); setProgress({ done: 0, total: imgs.length })
    try {
      const dataUrls = await Promise.all(imgs.map(fileToDataUrl))
      for (let i = 0; i < dataUrls.length; i += BATCH) {
        const chunk = dataUrls.slice(i, i + BATCH)
        const j = await fetch('/api/admin/inspirations', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images: chunk }),
        }).then(r => r.json()).catch(() => ({ saved: [] }))
        if (j.saved?.length) setItems(prev => [...j.saved, ...prev])
        setProgress({ done: Math.min(i + BATCH, dataUrls.length), total: dataUrls.length })
      }
    } finally { setUploading(false); setProgress(null); if (fileRef.current) fileRef.current.value = '' }
  }

  const del = async (id: string) => {
    if (!confirm('Remove this inspiration?')) return
    setItems(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/admin/inspirations?id=${id}`, { method: 'DELETE' })
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: 0 }}>Inspiration Library</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        The curated designs the AI Ad Studio takes inspiration from. Drag in your best ads — each is auto-tagged (niche, layout, style) so we match the right references per user industry. {items.length} active.
      </p>

      {/* Dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? '#2563eb' : '#cbd5e1'}`, borderRadius: 14, padding: '38px 20px',
          textAlign: 'center', cursor: 'pointer', background: drag ? '#eff6ff' : '#fafafa', marginBottom: 24, transition: 'all .15s',
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => e.target.files && handleFiles(e.target.files)} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>{uploading ? 'Uploading & tagging…' : '📥 Drag images here, or click to choose'}</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6 }}>
          {progress ? `${progress.done} / ${progress.total} processed — auto-tagging with AI…` : 'JPG / PNG / WebP · uploads in batches, tags each automatically'}
        </div>
      </div>

      {/* Grid */}
      {loading ? <div style={{ color: '#aaa' }}>Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
          {items.map(it => (
            <div key={it.id} style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              <div style={{ position: 'relative', aspectRatio: '4/5', background: '#111' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.r2_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button onClick={() => del(it.id)} title="Remove"
                  style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', fontSize: 13 }}>✕</button>
                {!it.tagged && <span style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(180,83,9,.85)', color: '#fff', borderRadius: 5, fontSize: 9, fontWeight: 700, padding: '2px 6px' }}>untagged</span>}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111', textTransform: 'capitalize' }}>{it.niche || '—'} <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {it.aspect || '?'}</span></div>
                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.layout_type || ''}{it.style_tags?.length ? ` · ${it.style_tags.slice(0, 3).join(', ')}` : ''}</div>
                <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                  {(it.palette || []).slice(0, 5).map((c, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid #0001' }} />)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
