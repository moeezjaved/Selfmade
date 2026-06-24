'use client'
import { useState, useEffect } from 'react'
import { Plus, Trash2, ExternalLink, Bookmark } from 'lucide-react'
import { cleanCopy } from '@/lib/cleanCopy'

interface Board { id: string; name: string; emoji: string; discovery_saved_ads?: { count: number }[] }
interface SavedAd { id: string; ad_id: string; page_name: string; snapshot_url: string; ad_data: any; saved_at: string }

export default function SavedAdsPage() {
  const [boards, setBoards] = useState<Board[]>([])
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null)
  const [savedAds, setSavedAds] = useState<SavedAd[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAds, setLoadingAds] = useState(true)
  const [newBoardName, setNewBoardName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selectedEmoji, setSelectedEmoji] = useState('📋')
  // Atria-style toolbar filters (client-side — the whole board is already in memory)
  const [q, setQ] = useState('')
  const [fmt, setFmt] = useState('')        // '' | 'video' | 'image'
  const [status, setStatus] = useState('')  // '' | 'active' | 'inactive'
  const [sortBy, setSortBy] = useState('recent')  // recent | oldest | brand

  const EMOJIS = ['📋', '⭐', '🔥', '💡', '🎯', '🚀', '💎', '🎨', '📱', '🛒', '💄', '👗', '🏋️', '🍕', '✈️', '🏠']

  const loadBoards = async () => {
    const res = await fetch('/api/discovery/boards')
    const data = await res.json()
    setBoards(data.boards || [])
    if (data.boards?.length && !selectedBoard) {
      setSelectedBoard(data.boards[0].id)
    }
    setLoading(false)
  }

  const loadSavedAds = async () => {
    if (!selectedBoard) return
    // Track in-flight so the panel shows a loader, NOT a premature "board is empty"
    // (the fetch starts empty → without this it flashes the empty state every load /
    // board-switch even when the board has ads).
    setLoadingAds(true)
    try {
      const res = await fetch(`/api/discovery/saved?board_id=${selectedBoard}`)
      const data = await res.json()
      setSavedAds(data.ads || [])
    } finally {
      setLoadingAds(false)
    }
  }

  useEffect(() => { loadBoards() }, [])
  useEffect(() => { loadSavedAds() }, [selectedBoard])

  const createBoard = async () => {
    if (!newBoardName.trim()) return
    setCreating(true)
    const res = await fetch('/api/discovery/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBoardName.trim(), emoji: selectedEmoji }),
    })
    const data = await res.json()
    if (data.board) {
      setBoards(prev => [data.board, ...prev])
      setSelectedBoard(data.board.id)
      setNewBoardName('')
      setShowCreate(false)
      setSelectedEmoji('📋')
    }
    setCreating(false)
  }

  const deleteBoard = async (id: string) => {
    if (!confirm('Delete this board? All saved ads in it will be removed.')) return
    await fetch(`/api/discovery/boards?id=${id}`, { method: 'DELETE' })
    setBoards(prev => prev.filter(b => b.id !== id))
    if (selectedBoard === id) setSelectedBoard(boards.find(b => b.id !== id)?.id || null)
  }

  const unsaveAd = async (adId: string) => {
    await fetch(`/api/discovery/saved?ad_id=${adId}&board_id=${selectedBoard}`, { method: 'DELETE' })
    setSavedAds(prev => prev.filter(a => a.ad_id !== adId))
    setBoards(prev => prev.map(b => b.id === selectedBoard
      ? { ...b, discovery_saved_ads: [{ count: Math.max(0, (b.discovery_saved_ads?.[0]?.count || 1) - 1) }] }
      : b))
  }

  const currentBoard = boards.find(b => b.id === selectedBoard)
  const adCount = (b: Board) => b.discovery_saved_ads?.[0]?.count ?? 0

  const fmtOf = (s: SavedAd) => (s.ad_data?.mediaType === 'video' || s.ad_data?.videoUrl || s.ad_data?.format === 'video') ? 'video' : 'image'
  const visibleAds = savedAds
    .filter(s => !q || `${s.page_name || ''} ${s.ad_data?.title || ''} ${s.ad_data?.body || ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter(s => !fmt || fmtOf(s) === fmt)
    .filter(s => !status || (status === 'active' ? !!s.ad_data?.isActive : !s.ad_data?.isActive))
    .sort((a, b) =>
      sortBy === 'brand' ? (a.page_name || '').localeCompare(b.page_name || '') :
      sortBy === 'oldest' ? +new Date(a.saved_at) - +new Date(b.saved_at) :
      +new Date(b.saved_at) - +new Date(a.saved_at))
  const selStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Top nav ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ marginRight: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>Ad Discovery</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Browse live ads from Meta Ads Library</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 9, padding: 3 }}>
          {[{ label: '🔍 Explore', href: '/discovery' }, { label: '🔖 Saved', href: '/discovery/saved' }].map(tab => (
            <a key={tab.href} href={tab.href}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600,
                background: tab.href === '/discovery/saved' ? '#fff' : 'transparent',
                color: tab.href === '/discovery/saved' ? '#111' : '#6b7280',
                textDecoration: 'none',
                boxShadow: tab.href === '/discovery/saved' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>
              {tab.label}
            </a>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 260, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 18px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>📚 Saved Ads</div>
            <button onClick={() => setShowCreate(o => !o)}
              style={{ width: 28, height: 28, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={14} />
            </button>
          </div>

          {showCreate && (
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>New Board</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setSelectedEmoji(e)}
                    style={{ width: 28, height: 28, borderRadius: 6, border: `2px solid ${selectedEmoji === e ? '#1a3a1a' : 'transparent'}`, background: selectedEmoji === e ? '#f0fdf4' : 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {e}
                  </button>
                ))}
              </div>
              <input
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createBoard()}
                placeholder="Board name…"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8 }}
              />
              <button onClick={createBoard} disabled={creating || !newBoardName.trim()}
                style={{ width: '100%', padding: '7px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: creating ? 0.7 : 1 }}>
                {creating ? 'Creating…' : 'Create Board'}
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading ? (
            <div style={{ padding: '20px 18px', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
          ) : boards.length === 0 ? (
            <div style={{ padding: '24px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>No boards yet.<br />Create one to start saving ads.</div>
            </div>
          ) : (
            boards.map(board => (
              <button key={board.id} onClick={() => setSelectedBoard(board.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
                  background: selectedBoard === board.id ? '#f0fdf4' : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  borderLeft: `3px solid ${selectedBoard === board.id ? '#1a3a1a' : 'transparent'}`,
                }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{board.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{adCount(board)} ads</div>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteBoard(board.id) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 4 }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}>
                  <Trash2 size={12} />
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {!currentBoard ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}><Bookmark size={48} strokeWidth={1} /></div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 8 }}>Create your first board</div>
            <div style={{ fontSize: 14 }}>Save and organise ads you love.</div>
            <button onClick={() => setShowCreate(true)}
              style={{ marginTop: 20, padding: '10px 24px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              + New Board
            </button>
          </div>
        ) : loadingAds && savedAds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#9ca3af', fontSize: 14 }}>
            Loading {currentBoard.name}…
          </div>
        ) : savedAds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{currentBoard.emoji}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 8 }}>{currentBoard.name} is empty</div>
            <div style={{ fontSize: 14 }}>Save ads from the Discovery page to this board.</div>
          </div>
        ) : (
          <>
            {/* ── Atria-style toolbar ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginRight: 4 }}>
                {currentBoard.emoji} {currentBoard.name}
                <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginLeft: 8 }}>{visibleAds.length} ads</span>
              </div>
              <div style={{ flex: 1 }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search saved ads…"
                style={{ ...selStyle, width: 200, fontWeight: 500 }} />
              <select value={fmt} onChange={e => setFmt(e.target.value)} style={selStyle}>
                <option value="">Format: All</option>
                <option value="video">Video</option>
                <option value="image">Image</option>
              </select>
              <select value={status} onChange={e => setStatus(e.target.value)} style={selStyle}>
                <option value="">Status: All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selStyle}>
                <option value="recent">Sort: Recently added</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="brand">Sort: Brand A–Z</option>
              </select>
            </div>

            {visibleAds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af', fontSize: 14 }}>No ads match your filters.</div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 16 }}>
              {visibleAds.map(saved => {
                const ad = saved.ad_data || {}
                const initials = (saved.page_name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                const isVid = fmtOf(saved) === 'video'
                const media = ad.thumbnailUrl || ad.creatives?.[0]?.url || null
                const tier = ad.performanceTier
                const title = cleanCopy(ad.title)
                const body = cleanCopy(ad.body)
                return (
                  <div key={saved.id} className="animate-fade-up"
                    style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'box-shadow .2s, transform .2s' }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}>
                    {/* header */}
                    <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saved.page_name}</div>
                        <div style={{ fontSize: 10.5, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db', animation: ad.isActive ? 'livepulse 2s infinite' : 'none' }} />
                          Saved {new Date(saved.saved_at).toLocaleDateString()}
                        </div>
                      </div>
                      {(tier === 'winning' || tier === 'optimized') && (
                        <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: '.02em', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 100, textTransform: 'uppercase',
                          color: tier === 'winning' ? '#166534' : '#92600a', background: tier === 'winning' ? '#dcfce7' : '#fef9c3', border: `1px solid ${tier === 'winning' ? '#bbf7d0' : '#fde68a'}` }}>
                          {tier === 'winning' ? '🏆 Winning' : '⚡ Optimized'}
                        </span>
                      )}
                      <a href={saved.snapshot_url} target="_blank" rel="noopener noreferrer" title="Open in Meta Ad Library" style={{ color: '#9ca3af', flexShrink: 0, display: 'flex' }}><ExternalLink size={13} /></a>
                      <button onClick={() => unsaveAd(saved.ad_id)} title="Remove from board"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 0, flexShrink: 0, display: 'flex' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {/* media — REAL creative (no more Meta iframe) */}
                    <a href={saved.snapshot_url} target="_blank" rel="noopener noreferrer"
                      style={{ position: 'relative', display: 'block', width: '100%', paddingBottom: '118%', background: '#0f172a', overflow: 'hidden' }}>
                      {media ? (
                        <img src={media} alt={saved.page_name} loading="lazy" decoding="async"
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>No preview</div>
                      )}
                      {isVid && (
                        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '2px 7px', borderRadius: 100 }}>▶ Video</span>
                      )}
                    </a>
                    {/* copy */}
                    {(title || body) && (
                      <div style={{ padding: '9px 12px 12px' }}>
                        {title && <div style={{ fontSize: 12, fontWeight: 700, color: '#111', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{title}</div>}
                        {body && <div style={{ fontSize: 11.5, color: '#4b5563', marginTop: 2, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{body}</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )}
          </>
        )}
      </div>
      </div> {/* end body flex */}
    </div>
  )
}
