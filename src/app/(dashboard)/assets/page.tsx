'use client'
/**
 * Assets — the org's uploaded media library (spec §10.3). Direct-to-R2 upload via a presigned URL,
 * storage-capped by plan.assetsGb (the cap is enforced server-side; the meter here mirrors it).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { UploadCloud, Trash2, Image as ImageIcon, Film, Music, X, MoreHorizontal, Share2, Download, FolderPlus, Sparkles } from 'lucide-react'
import CloneModal from '../discovery/CloneModal'

const INK = '#0e1b12'
type Asset = { id: string; file_url: string; file_type: string; file_name: string; size_bytes: number; width?: number; height?: number; status: string; uploader_name?: string; uploaded_by?: string; created_at?: string; tags?: string[]; scene?: string | null; audio_kind?: string | null; has_captions?: boolean | null; roll?: string | null }

const fmtSize = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [usedBytes, setUsedBytes] = useState(0)
  const [limitGb, setLimitGb] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [typeF, setTypeF] = useState('')
  const [search, setSearch] = useState('')     // committed semantic query
  const [searchBox, setSearchBox] = useState('')
  const [uploaderF, setUploaderF] = useState('')   // filter by uploader name
  const [sortBy, setSortBy] = useState('recent')   // recent | oldest | name | size
  const [tagFilter, setTagFilter] = useState('')
  const [tagInput, setTagInput] = useState<string | null>(null)   // asset id whose add-tag box is open
  const [sceneF, setSceneF] = useState(''); const [audioF, setAudioF] = useState(''); const [capF, setCapF] = useState(''); const [rollF, setRollF] = useState('')  // video clip filters

  const addTag = async (id: string, tag: string) => {
    const t = tag.trim().slice(0, 40); if (!t) return
    setAssets(prev => prev.map(a => a.id === id ? { ...a, tags: Array.from(new Set([...(a.tags || []), t])) } : a))
    setTagInput(null)
    await fetch('/api/assets/tags', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, tag: t }) })
  }
  const removeTag = async (id: string, tag: string) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, tags: (a.tags || []).filter(x => x !== tag) } : a))
    await fetch(`/api/assets/tags?id=${id}&tag=${encodeURIComponent(tag)}`, { method: 'DELETE' })
  }
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (typeF) params.set('type', typeF)
    if (search.trim()) params.set('q', search.trim())
    const r = await fetch(`/api/assets?${params}`).then(r => r.json()).catch(() => ({}))
    setAssets(r.assets || []); setUsedBytes(r.usedBytes || 0); setLimitGb(r.limitGb ?? null); setLoading(false)
  }, [typeF, search])
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
    if (conf.error) return false
    // 4) fire AI enrichment (caption + embedding) — non-blocking; the card shows 'processing' until done
    if (conf.asset?.id) fetch('/api/assets/enrich', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: conf.asset.id }) }).then(() => load()).catch(() => {})
    return true
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

  // Per-asset actions menu (Add to board / Download / Share).
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [boardSub, setBoardSub] = useState(false)
  const [boardList, setBoardList] = useState<{ id: string; name: string; emoji: string }[]>([])
  const openMenu = async (id: string) => {
    setMenuFor(m => m === id ? null : id); setBoardSub(false)
    if (!boardList.length) { const r = await fetch('/api/discovery/boards').then(r => r.json()).catch(() => ({})); setBoardList(r.boards || []) }
  }
  const shareAsset = (a: Asset) => { navigator.clipboard?.writeText(a.file_url); setMenuFor(null); setMsg('✓ Link copied to clipboard.') }
  const downloadAsset = async (a: Asset) => {
    setMenuFor(null)
    try { const r = await fetch(a.file_url); const b = await r.blob(); const u = URL.createObjectURL(b); const el = document.createElement('a'); el.href = u; el.download = a.file_name || 'asset'; el.click(); URL.revokeObjectURL(u) }
    catch { window.open(a.file_url, '_blank') }
  }
  const addToBoard = async (a: Asset, boardId: string) => {
    setMenuFor(null); setBoardSub(false)
    const r = await fetch('/api/discovery/saved', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, ad_id: 'asset:' + a.id, page_name: a.file_name || 'Asset', snapshot_url: a.file_url, ad_data: { thumbnailUrl: a.file_url, isAsset: true, mediaType: a.file_type } }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setMsg(r.error ? `Could not add to board: ${r.error}` : '✓ Added to board.')
  }

  const [cloneAsset, setCloneAsset] = useState<Asset | null>(null)   // asset being cloned via CloneModal

  // Video Clone → Assets: animate an image asset into a video (lands in My Creatives).
  const [busyAnimate, setBusyAnimate] = useState<string | null>(null)
  const animate = async (a: Asset) => {
    if (a.file_type !== 'image') return
    setBusyAnimate(a.id); setMsg('')
    const r = await fetch('/api/discovery/animate', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: a.file_url, style: 'zoom', resolution: '1080p' }) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setBusyAnimate(null)
    if (r.jobId) setMsg('✓ Animating this asset into a video (40 credits) — it will appear in My Creatives shortly.')
    else setMsg(r.error === 'insufficient_credits' ? 'Not enough credits to animate (video = 40 credits).' : (r.error || 'Could not start the animation.'))
  }

  const pct = limitGb == null ? 0 : Math.min(100, (usedBytes / (limitGb * 1e9)) * 100)
  const near = pct >= 85
  const uploaders = Array.from(new Set(assets.map(a => a.uploader_name).filter(Boolean))) as string[]
  const allTags = Array.from(new Set(assets.flatMap(a => a.tags || []))).sort()
  // Apply uploader + tag filters + sort client-side. When searching, keep the semantic ranking.
  const hasVideos = assets.some(a => a.file_type === 'video')
  let shown = assets
    .filter(a => !uploaderF || a.uploader_name === uploaderF)
    .filter(a => !tagFilter || (a.tags || []).includes(tagFilter))
    .filter(a => !sceneF || a.scene === sceneF)
    .filter(a => !audioF || a.audio_kind === audioF)
    .filter(a => !capF || (capF === 'yes' ? a.has_captions === true : a.has_captions === false))
    .filter(a => !rollF || a.roll === rollF)
  if (!search) shown = [...shown].sort((a, b) =>
    sortBy === 'name' ? (a.file_name || '').localeCompare(b.file_name || '') :
    sortBy === 'size' ? (b.size_bytes || 0) - (a.size_bytes || 0) :
    sortBy === 'oldest' ? +new Date(a.created_at || 0) - +new Date(b.created_at || 0) :
    +new Date(b.created_at || 0) - +new Date(a.created_at || 0))
  const selStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#374151', padding: '7px 11px', borderRadius: 100, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }
  const menuItem: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 9px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, color: '#1f2937', fontFamily: 'inherit' }

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

      {msg && (() => { const ok = msg.startsWith('✓'); return <div style={{ fontSize: 13, fontWeight: 600, color: ok ? '#166534' : '#b91c1c', background: ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, padding: '8px 12px', margin: '8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>{msg}<X size={13} style={{ cursor: 'pointer', marginLeft: 'auto' }} onClick={() => setMsg('')} /></div> })()}

      {/* search + filter */}
      <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={searchBox} onChange={e => setSearchBox(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') setSearch(searchBox); if (e.key === 'Escape') { setSearch(''); setSearchBox('') } }}
          placeholder="Search by meaning — e.g. “UGC unboxing clips”, “green product shot”…"
          style={{ flex: 1, minWidth: 220, padding: '9px 13px', border: '1px solid #d1d5db', borderRadius: 100, fontSize: 13.5, outline: 'none', fontFamily: 'inherit' }} />
        {search && <button onClick={() => { setSearch(''); setSearchBox('') }} style={{ fontSize: 12.5, fontWeight: 700, color: '#6b7280', background: '#f1f5f9', border: 'none', padding: '7px 13px', borderRadius: 100, cursor: 'pointer' }}>Clear search</button>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[['', 'All'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio']].map(([v, label]) => (
            <button key={v} onClick={() => setTypeF(v)}
              style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 13px', borderRadius: 100, cursor: 'pointer',
                border: `1px solid ${typeF === v ? INK : '#e5e7eb'}`, background: typeF === v ? INK : '#fff', color: typeF === v ? '#fff' : '#374151' }}>{label}</button>
          ))}
          {uploaders.length > 1 && (
            <select value={uploaderF} onChange={e => setUploaderF(e.target.value)} style={selStyle}>
              <option value="">Uploader: All</option>
              {uploaders.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          {allTags.length > 0 && (
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={selStyle}>
              <option value="">🏷 Tag: All</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {hasVideos && <>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', alignSelf: 'center' }}>Clip:</span>
            <select value={sceneF} onChange={e => setSceneF(e.target.value)} style={selStyle}>
              <option value="">Scene: All</option>
              {['unboxing', 'talking_head', 'lifestyle', 'product_demo', 'other'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <select value={rollF} onChange={e => setRollF(e.target.value)} style={selStyle}>
              <option value="">A/B-roll: All</option>
              <option value="a_roll">A-roll</option>
              <option value="b_roll">B-roll</option>
            </select>
            <select value={capF} onChange={e => setCapF(e.target.value)} style={selStyle}>
              <option value="">Caption: All</option>
              <option value="yes">Has captions</option>
              <option value="no">No captions</option>
            </select>
            <select value={audioF} onChange={e => setAudioF(e.target.value)} style={selStyle}>
              <option value="">Audio: All</option>
              <option value="voiceover">Voice-over</option>
              <option value="music">Music</option>
              <option value="silent">Silent</option>
            </select>
          </>}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} disabled={!!search} style={{ ...selStyle, opacity: search ? 0.5 : 1 }} title={search ? 'Sorted by relevance while searching' : ''}>
            <option value="recent">Sort: Recently added</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="name">Sort: Name A–Z</option>
            <option value="size">Sort: Largest</option>
          </select>
        </div>
      </div>
      {search && <div style={{ fontSize: 12.5, color: '#6b7280', margin: '-4px 0 10px' }}>Semantic results for “{search}” — ranked by visual/meaning similarity.</div>}

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
            {shown.map(a => (
              <div key={a.id} style={{ background: '#fff', border: '1px solid #eef0ee', borderRadius: 12, position: 'relative', overflow: menuFor === a.id ? 'visible' : 'hidden', zIndex: menuFor === a.id ? 5 : 'auto' }}>
                <div style={{ position: 'relative', width: '100%', paddingBottom: '100%', background: '#0f172a', overflow: 'hidden', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
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
                  {a.status === 'processing' && (
                    <span style={{ position: 'absolute', bottom: 7, left: 7, background: 'rgba(14,27,18,0.85)', color: '#dffe95', borderRadius: 6, padding: '2px 7px', fontSize: 9.5, fontWeight: 800 }}>✨ AI tagging…</span>
                  )}
                  <button onClick={() => del(a.id)} title="Delete"
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', color: '#fecaca', display: 'flex' }}>
                    <Trash2 size={13} />
                  </button>
                  {a.file_type === 'image' && (
                    <div style={{ position: 'absolute', bottom: 7, right: 7, display: 'flex', gap: 5 }}>
                      <button onClick={() => setCloneAsset(a)} title="Clone this creative with your product"
                        style={{ background: '#dffe95', color: '#14281a', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 9.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Sparkles size={11} /> Clone
                      </button>
                      <button onClick={() => animate(a)} disabled={busyAnimate === a.id} title="Animate into a video (40 credits)"
                        style={{ background: 'rgba(14,27,18,0.85)', color: '#dffe95', border: 'none', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 9.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Film size={11} /> {busyAnimate === a.id ? '…' : 'Animate'}
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name || 'Untitled'}</div>
                    <button onClick={() => openMenu(a.id)} title="Actions" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, display: 'flex', flexShrink: 0 }}><MoreHorizontal size={16} /></button>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{a.file_type} · {fmtSize(a.size_bytes)}</div>
                  {/* tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center' }}>
                    {(a.tags || []).map(t => (
                      <span key={t} onClick={() => setTagFilter(t)} title="Filter by this tag"
                        style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', background: '#dbeafe', padding: '1px 5px 1px 7px', borderRadius: 100, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                        {t}<span onClick={e => { e.stopPropagation(); removeTag(a.id, t) }} style={{ cursor: 'pointer', color: '#93a3c4', fontWeight: 800 }}>×</span>
                      </span>
                    ))}
                    {tagInput === a.id ? (
                      <input autoFocus onBlur={() => setTagInput(null)}
                        onKeyDown={e => { if (e.key === 'Enter') addTag(a.id, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setTagInput(null) }}
                        placeholder="tag…" style={{ fontSize: 10, padding: '1px 6px', border: '1px solid #c7d2fe', borderRadius: 100, outline: 'none', width: 60, fontFamily: 'inherit' }} />
                    ) : (
                      <button onClick={() => setTagInput(a.id)} style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f1f5f9', border: 'none', padding: '1px 7px', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit' }}>+ tag</button>
                    )}
                  </div>
                </div>
                {menuFor === a.id && (
                  <>
                    <div onClick={() => setMenuFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                    <div style={{ position: 'absolute', right: 8, bottom: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 26px rgba(0,0,0,0.16)', padding: 5, minWidth: 160, zIndex: 10 }}>
                      {!boardSub ? (
                        <>
                          <button onClick={() => setBoardSub(true)} style={menuItem}><FolderPlus size={14} /> Add to board</button>
                          <button onClick={() => downloadAsset(a)} style={menuItem}><Download size={14} /> Download</button>
                          <button onClick={() => shareAsset(a)} style={menuItem}><Share2 size={14} /> Share link</button>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 10, color: '#9ca3af', padding: '3px 9px 5px', fontWeight: 800, letterSpacing: '.05em' }}>ADD TO BOARD</div>
                          {boardList.length === 0 && <div style={{ fontSize: 12, color: '#9ca3af', padding: '5px 9px' }}>No boards yet</div>}
                          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                            {boardList.map(b => <button key={b.id} onClick={() => addToBoard(a, b.id)} style={menuItem}>{b.emoji} {b.name}</button>)}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      {cloneAsset && (
        <CloneModal
          ad={{ id: 'asset:' + cloneAsset.id, pageId: '', pageName: cloneAsset.file_name || 'Asset', assetImageUrl: cloneAsset.file_url }}
          onClose={() => setCloneAsset(null)}
        />
      )}
    </div>
  )
}
