'use client'
/**
 * Assets — the org's uploaded media library (spec §10.3). Direct-to-R2 upload via a presigned URL,
 * storage-capped by plan.assetsGb (the cap is enforced server-side; the meter here mirrors it).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { UploadCloud, Trash2, Image as ImageIcon, Film, Music, X } from 'lucide-react'

const INK = '#0e1b12'
type Asset = { id: string; file_url: string; file_type: string; file_name: string; size_bytes: number; width?: number; height?: number; status: string }

const fmtSize = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [usedBytes, setUsedBytes] = useState(0)
  const [limitGb, setLimitGb] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [typeF, setTypeF] = useState('')
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/assets${typeF ? `?type=${typeF}` : ''}`).then(r => r.json()).catch(() => ({}))
    setAssets(r.assets || []); setUsedBytes(r.usedBytes || 0); setLimitGb(r.limitGb ?? null); setLoading(false)
  }, [typeF])
  useEffect(() => { load() }, [load])

  const uploadOne = async (file: File): Promise<boolean> => {
    // 1) ask for a presigned URL (server enforces MIME + per-file + storage cap)
    const signed = await fetch('/api/assets/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileType: file.type, sizeBytes: file.size, fileName: file.name }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    if (signed.error) {
      setMsg(signed.error === 'storage_limit'
        ? `Storage full — ${signed.usedGb}/${signed.limitGb} GB used. Upgrade to ${signed.upgradeTo} for more space.`
        : (signed.message || signed.error))
      return false
    }
    // 2) PUT straight to R2
    const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }).catch(() => null)
    if (!put || !put.ok) { setMsg(`Upload failed for ${file.name}`); return false }
    // 3) confirm → records the row after verifying the object
    const conf = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: signed.assetId, key: signed.key, fileType: file.type, fileName: file.name }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    return !conf.error
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setMsg(''); const list = Array.from(files)
    setUploading({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i++) { await uploadOne(list[i]); setUploading({ done: i + 1, total: list.length }) }
    setUploading(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Delete this asset?')) return
    setAssets(prev => prev.filter(a => a.id !== id))
    await fetch(`/api/assets?id=${id}`, { method: 'DELETE' }); load()
  }

  const pct = limitGb == null ? 0 : Math.min(100, (usedBytes / (limitGb * 1e9)) * 100)
  const near = pct >= 85

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", maxWidth: 1100, margin: '0 auto', padding: '28px 24px', color: INK }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 4px' }}>Assets</h1>
          <p style={{ color: '#6b7280', fontSize: 14.5, margin: 0 }}>Your team's uploaded creatives, b-roll, logos & footage — shared across the org.</p>
        </div>
        <button onClick={() => fileInput.current?.click()} disabled={!!uploading}
          style={{ background: INK, color: '#fff', border: 'none', padding: '11px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UploadCloud size={16} /> {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : 'Upload'}
        </button>
        <input ref={fileInput} type="file" multiple accept="image/*,video/*,audio/*" style={{ display: 'none' }} onChange={e => onFiles(e.target.files)} />
      </div>

      {/* storage meter */}
      <div style={{ margin: '16px 0 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: near ? '#b91c1c' : '#6b7280', marginBottom: 5 }}>
          <span>{fmtSize(usedBytes)} used{limitGb != null ? ` of ${limitGb} GB` : ' · unlimited'}</span>
          {limitGb != null && <span>{pct.toFixed(0)}%</span>}
        </div>
        {limitGb != null && (
          <div style={{ height: 7, borderRadius: 100, background: '#eef0ee', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: near ? '#dc2626' : '#84cc16', transition: 'width .3s' }} />
          </div>
        )}
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>{msg}<X size={13} style={{ cursor: 'pointer', marginLeft: 'auto' }} onClick={() => setMsg('')} /></div>}

      {/* filter */}
      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        {[['', 'All'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio']].map(([v, label]) => (
          <button key={v} onClick={() => setTypeF(v)}
            style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 13px', borderRadius: 100, cursor: 'pointer',
              border: `1px solid ${typeF === v ? INK : '#e5e7eb'}`, background: typeF === v ? INK : '#fff', color: typeF === v ? '#fff' : '#374151' }}>{label}</button>
        ))}
      </div>

      {loading ? <div style={{ color: '#9ca3af', padding: 40 }}>Loading…</div>
        : assets.length === 0 ? (
          <div onClick={() => fileInput.current?.click()}
            style={{ border: '2px dashed #d1d5db', borderRadius: 16, padding: '56px 20px', textAlign: 'center', cursor: 'pointer', color: '#6b7280' }}>
            <UploadCloud size={40} style={{ margin: '0 auto 12px', display: 'block', color: '#9ca3af' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 4 }}>Upload your first asset</div>
            <div style={{ fontSize: 13.5 }}>Images, videos & audio. Drag files here or click to browse.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
            {assets.map(a => (
              <div key={a.id} style={{ background: '#fff', border: '1px solid #eef0ee', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ position: 'relative', width: '100%', paddingBottom: '100%', background: '#0f172a' }}>
                  {a.file_type === 'image' ? (
                    <img src={a.file_url} alt={a.file_name} loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : a.file_type === 'video' ? (
                    <video src={a.file_url} muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}><Music size={34} /></div>
                  )}
                  <span style={{ position: 'absolute', top: 7, left: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 6, padding: '2px 5px', display: 'flex' }}>
                    {a.file_type === 'video' ? <Film size={12} /> : a.file_type === 'audio' ? <Music size={12} /> : <ImageIcon size={12} />}
                  </span>
                  <button onClick={() => del(a.id)} title="Delete"
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', color: '#fecaca', display: 'flex' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name || 'Untitled'}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{a.file_type} · {fmtSize(a.size_bytes)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
