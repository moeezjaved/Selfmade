'use client'
import { useState, useEffect } from 'react'
import { Plus, Trash2, ExternalLink, Bookmark, Sparkles } from 'lucide-react'
import { cleanCopy } from '@/lib/cleanCopy'
import CloneModal from '../CloneModal'
import CloneVideoModal from '../CloneVideoModal'
import { useIsMobile } from '@/lib/useIsMobile'
import HoverScrubVideo from '@/components/discovery/HoverScrubVideo'

interface Board { id: string; name: string; emoji: string; visibility?: string; isMine?: boolean; parent_board_id?: string | null; discovery_saved_ads?: { count: number }[] }
interface SavedAd { id: string; ad_id: string; page_name: string; snapshot_url: string; ad_data: any; saved_at: string; tags?: string[] }

export default function SavedAdsPage() {
  const isMobile = useIsMobile()
  const [boards, setBoards] = useState<Board[]>([])
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null)
  const [savedAds, setSavedAds] = useState<SavedAd[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAds, setLoadingAds] = useState(true)
  const [newBoardName, setNewBoardName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selectedEmoji, setSelectedEmoji] = useState('📋')
  const [canTeam, setCanTeam] = useState(false)       // plan.teamBoards — may this org make shared boards?
  const [newBoardTeam, setNewBoardTeam] = useState(false)
  // Atria-style toolbar filters (client-side — the whole board is already in memory)
  const [q, setQ] = useState('')
  const [fmt, setFmt] = useState('')        // '' | 'video' | 'image'
  const [status, setStatus] = useState('')  // '' | 'active' | 'inactive'
  const [sortBy, setSortBy] = useState('recent')  // recent | oldest | brand
  const [tagFilter, setTagFilter] = useState('')  // '' = all; else a single tag
  const [tagInput, setTagInput] = useState<string | null>(null)  // saved_ad_id whose add-tag box is open
  const [cloneImg, setCloneImg] = useState<SavedAd | null>(null)   // open image-clone modal for this saved ad
  const [cloneVid, setCloneVid] = useState<SavedAd | null>(null)   // open video-clone modal for this saved ad
  const [vidFailed, setVidFailed] = useState<Set<string>>(new Set())   // saved videos whose src can't load

  const addTag = async (savedId: string, tag: string) => {
    const t = tag.trim().slice(0, 40); if (!t) return
    setSavedAds(prev => prev.map(a => a.id === savedId ? { ...a, tags: Array.from(new Set([...(a.tags || []), t])) } : a))
    setTagInput(null)
    await fetch('/api/discovery/saved/tags', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ saved_ad_id: savedId, tag: t }) })
  }
  const removeTag = async (savedId: string, tag: string) => {
    setSavedAds(prev => prev.map(a => a.id === savedId ? { ...a, tags: (a.tags || []).filter(x => x !== tag) } : a))
    await fetch(`/api/discovery/saved/tags?saved_ad_id=${savedId}&tag=${encodeURIComponent(tag)}`, { method: 'DELETE' })
  }

  const EMOJIS = ['📋', '⭐', '🔥', '💡', '🎯', '🚀', '💎', '🎨', '📱', '🛒', '💄', '👗', '🏋️', '🍕', '✈️', '🏠']

  const loadBoards = async () => {
    const res = await fetch('/api/discovery/boards')
    const data = await res.json()
    setBoards(data.boards || [])
    setCanTeam(!!data.canTeam)
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
      // Merge tags added at SAVE-TIME (stored in ad_data.tags) with tags added later on the board
      // (the top-level `tags` column) — otherwise a tag chosen while saving never appeared here.
      setSavedAds((data.ads || []).map((a: any) => ({
        ...a, tags: Array.from(new Set([...(a.tags || []), ...(a.ad_data?.tags || [])])),
      })))
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
      body: JSON.stringify({ name: newBoardName.trim(), emoji: selectedEmoji, visibility: newBoardTeam ? 'team' : 'personal' }),
    })
    const data = await res.json()
    if (data.board) {
      setBoards(prev => [{ ...data.board, isMine: true }, ...prev])
      setSelectedBoard(data.board.id)
      setNewBoardName('')
      setShowCreate(false)
      setSelectedEmoji('📋')
      setNewBoardTeam(false)
    } else if (data.error === 'plan_limit') {
      alert(data.message || 'Team boards are a Pro feature — upgrade to share boards with your team.')
    }
    setCreating(false)
  }

  const createSub = async (parent: Board) => {
    const name = prompt(`New sub-board under "${parent.name}"`)?.trim(); if (!name) return
    const res = await fetch('/api/discovery/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, emoji: '📁', visibility: parent.visibility || 'personal', parent_board_id: parent.id }) })
    const data = await res.json()
    if (data.board) { setBoards(prev => [{ ...data.board, isMine: true }, ...prev]); setSelectedBoard(data.board.id) }
    else if (data.error === 'plan_limit') alert(data.message || 'Team boards are a Pro feature.')
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

  // Extension-saved ads write `media_type` (snake); internal saves use `mediaType`/`format`/`videoUrl`.
  const fmtOf = (s: SavedAd) => (s.ad_data?.media_type === 'video' || s.ad_data?.mediaType === 'video' || s.ad_data?.videoUrl || s.ad_data?.format === 'video') ? 'video' : 'image'
  // True for ads captured by the Chrome extension — their playable media IS the R2 snapshot_url.
  const isExternal = (s: SavedAd) => !!(s.ad_data?.external || s.ad_data?.source)
  const visibleAds = savedAds
    .filter(s => !q || `${s.page_name || ''} ${s.ad_data?.title || ''} ${s.ad_data?.body || ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter(s => !fmt || fmtOf(s) === fmt)
    .filter(s => !status || (status === 'active' ? !!s.ad_data?.isActive : !s.ad_data?.isActive))
    .filter(s => !tagFilter || (s.tags || []).includes(tagFilter))
    .sort((a, b) =>
      sortBy === 'brand' ? (a.page_name || '').localeCompare(b.page_name || '') :
      sortBy === 'oldest' ? +new Date(a.saved_at) - +new Date(b.saved_at) :
      +new Date(b.saved_at) - +new Date(a.saved_at))
  const selStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }
  const allTags = Array.from(new Set(savedAds.flatMap(s => s.tags || []))).sort()

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
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, overflow: isMobile ? 'visible' : 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: isMobile ? '100%' : 260, background: '#fff', borderRight: isMobile ? 'none' : '1px solid #e2e8f0', borderBottom: isMobile ? '1px solid #e2e8f0' : 'none', maxHeight: isMobile ? 240 : undefined, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 18px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>📚 Saved Ads</div>
            <button onClick={() => setShowCreate(o => !o)}
              style={{ width: 28, height: 28, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={14} />
            </button>
          </div>

          {showCreate && (
            // MOBILE: full-screen dimmed backdrop + centered opaque card (the inline panel bled into
            // the board list behind it). DESKTOP: unchanged inline panel.
            <div onClick={isMobile ? () => setShowCreate(false) : undefined}
              style={isMobile
                ? { position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
                : { background: '#f8fafc', borderRadius: 10, padding: 12, border: '1px solid #e2e8f0' }}>
            <div onClick={isMobile ? (e) => e.stopPropagation() : undefined}
              style={isMobile
                ? { background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #e2e8f0', width: '100%', maxWidth: 360, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }
                : { display: 'contents' }}>
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
              <label title={canTeam ? 'Everyone in your team can see this board' : 'Team boards are a Pro feature'}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: canTeam ? '#374151' : '#9ca3af', marginBottom: 8, cursor: canTeam ? 'pointer' : 'not-allowed' }}>
                <input type="checkbox" checked={newBoardTeam} disabled={!canTeam} onChange={e => setNewBoardTeam(e.target.checked)} />
                <span>👥 Share with team {canTeam ? '' : '(Pro)'}</span>
              </label>
              <button onClick={createBoard} disabled={creating || !newBoardName.trim()}
                style={{ width: '100%', padding: '7px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: creating ? 0.7 : 1 }}>
                {creating ? 'Creating…' : 'Create Board'}
              </button>
            </div>
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
          ) : (() => {
            const btn = (board: Board, depth = 0) => (
              <button key={board.id} onClick={() => setSelectedBoard(board.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: `9px 18px 9px ${18 + depth * 20}px`,
                  background: selectedBoard === board.id ? '#f0fdf4' : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  borderLeft: `3px solid ${selectedBoard === board.id ? '#1a3a1a' : 'transparent'}`,
                }}>
                <span style={{ fontSize: depth ? 14 : 18, flexShrink: 0 }}>{board.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: depth ? 12.5 : 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{board.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{adCount(board)} ads{board.visibility === 'team' && !board.isMine ? ' · shared' : ''}</div>
                </div>
                {depth === 0 && (board.isMine || board.visibility !== 'team') && (
                  <span onClick={e => { e.stopPropagation(); createSub(board) }} title="Add sub-board"
                    style={{ cursor: 'pointer', color: '#c7cdd4', padding: 3, display: 'flex' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#1a3a1a')} onMouseLeave={e => (e.currentTarget.style.color = '#c7cdd4')}>
                    <Plus size={13} />
                  </span>
                )}
                {(board.isMine || board.visibility !== 'team') && (
                  <span onClick={e => { e.stopPropagation(); deleteBoard(board.id) }}
                    style={{ cursor: 'pointer', color: '#d1d5db', padding: 3, display: 'flex' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')} onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}>
                    <Trash2 size={12} />
                  </span>
                )}
              </button>
            )
            // Render top-level boards with their sub-boards nested beneath.
            const tree = (list: Board[]) => list.filter(b => !b.parent_board_id).map(p => (
              <div key={p.id}>{btn(p, 0)}{list.filter(c => c.parent_board_id === p.id).map(c => btn(c, 1))}</div>
            ))
            const team = boards.filter(b => b.visibility === 'team')
            const mine = boards.filter(b => b.visibility !== 'team')
            const hdr = (t: string) => <div style={{ padding: '10px 18px 4px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9ca3af' }}>{t}</div>
            return (
              <>
                {team.length > 0 && <>{hdr('👥 Team boards')}{tree(team)}</>}
                {mine.length > 0 && <>{team.length > 0 && hdr('My boards')}{tree(mine)}</>}
              </>
            )
          })()}
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, padding: isMobile ? 12 : 24, overflowY: 'auto' }}>
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
            {currentBoard.name === 'Saved from Web' ? (
              <>
                <div style={{ fontSize: 14 }}>Install the browser extension, then save any ad you find on<br />Instagram, the Facebook Ad Library or TikTok — it lands here.</div>
                <a href="https://chromewebstore.google.com/detail/selfmade-%E2%80%94-save-winning-a/eekbcgdoonpmhoojoaggpfmfgcplaefi" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 20, padding: '10px 22px', background: '#1a3a1a', color: '#dffe95', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>
                  🧩 Get the Chrome extension
                </a>
              </>
            ) : (
              <div style={{ fontSize: 14 }}>Save ads from the Discovery page to this board.</div>
            )}
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
                style={{ ...selStyle, width: isMobile ? '100%' : 200, fontWeight: 500 }} />
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
              {allTags.length > 0 && (
                <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={selStyle}>
                  <option value="">🏷 Tag: All</option>
                  {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selStyle}>
                <option value="recent">Sort: Recently added</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="brand">Sort: Brand A–Z</option>
              </select>
            </div>

            {visibleAds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af', fontSize: 14 }}>No ads match your filters.</div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(248px,100%), 1fr))', gap: 16 }}>
              {visibleAds.map(saved => {
                const ad = saved.ad_data || {}
                const ext = isExternal(saved)
                const initials = (saved.page_name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                const isVid = fmtOf(saved) === 'video'
                // A video ad the extension could only save as a POSTER image (FB/IG feed blob videos):
                // remake works as a picture; for a true video remake the user finds it in Discovery.
                const posterVideo = ext && !!ad.was_video && !isVid
                // Extension ads: the R2 snapshot_url IS the creative (image jpg or video mp4). Internal
                // ads keep a Meta Ad Library page as snapshot_url, so use the stored thumbnail instead.
                // Poster: try every field a save might store it under (internal discovery saves,
                // extension saves, and asset saves all differ) so a video at least shows its thumbnail.
                const media = ad.thumbnailUrl || ad.poster_url || ad.creatives?.[0]?.poster_url || ad.creatives?.[0]?.url || (ext && !isVid ? saved.snapshot_url : null)
                // Playable video: accept any real mp4 we stored — internal discovery saves keep the R2
                // mp4 under videoUrl/r2_url; extension saves put it in snapshot_url. This fixes
                // "Video preview unavailable" for videos saved from Discovery.
                // Internal discovery saves keep a real R2 mp4 under videoUrl/r2_url — trust those as-is
                // (they can carry query strings). Extension blobs are only safe when they end in .mp4.
                const http = (u?: string) => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null
                const mp4 = (u?: string) => (typeof u === 'string' && /\.mp4(\?|$)/i.test(u)) ? u : null
                const videoSrc = isVid
                  ? (http(ad.videoUrl) || http(ad.r2_url) || http(ad.creatives?.[0]?.r2_url) || (ext ? mp4(saved.snapshot_url) : mp4(saved.snapshot_url)))
                  : null
                // Where the external "open" link should go — the page it was saved from, not the raw R2 file.
                const openUrl = (ext && ad.source_url) ? ad.source_url : saved.snapshot_url
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
                      {posterVideo && (
                        <span title="This was a video ad — the extension saved its poster. Remake it as a picture here, or find the ad in Discovery to remake as a full video."
                          style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: '.02em', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 100, textTransform: 'uppercase', color: '#3730a3', background: '#e0e7ff', border: '1px solid #c7d2fe' }}>🎬 Video</span>
                      )}
                      <button onClick={() => (isVid ? setCloneVid(saved) : setCloneImg(saved))} title={isVid ? 'Remake this video ad with your product' : posterVideo ? 'Remake as a picture (this is a video ad — open it in Discovery to remake as a full video)' : 'Remake this ad with your product'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a3a1a', padding: 0, flexShrink: 0, display: 'flex' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#65a30d')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#1a3a1a')}>
                        <Sparkles size={13} />
                      </button>
                      <a href={openUrl} target="_blank" rel="noopener noreferrer" title={ext ? 'Open original' : 'Open in Meta Ad Library'} style={{ color: '#9ca3af', flexShrink: 0, display: 'flex' }}><ExternalLink size={13} /></a>
                      <button onClick={() => unsaveAd(saved.ad_id)} title="Remove from board"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 0, flexShrink: 0, display: 'flex' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {/* media — playable video (controls) with graceful fallback; image = link to original */}
                    <div style={{ position: 'relative', width: '100%', paddingBottom: '118%', background: '#0f172a', overflow: 'hidden' }}>
                      {videoSrc && !vidFailed.has(saved.id) ? (
                        // A real R2 mp4 → hover-scrub + play. A dead src (blob/YouTube that couldn't be
                        // fetched at save time) fires onError → fall through to poster / "open original".
                        <HoverScrubVideo src={videoSrc} poster={media || undefined} brandBg="#0f172a"
                          onError={() => setVidFailed(s => { const n = new Set(s); n.add(saved.id); return n })} />
                      ) : media ? (
                        <a href={openUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', position: 'absolute', inset: 0 }}>
                          <img src={media} alt={saved.page_name} loading="lazy" decoding="async"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </a>
                      ) : (
                        <a href={openUrl} target="_blank" rel="noopener noreferrer"
                          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12, textDecoration: 'none' }}>
                          <span style={{ fontSize: 22 }}>{isVid ? '▶' : '🖼'}</span>
                          {isVid ? 'Video preview unavailable' : 'No preview'}
                          <span style={{ fontSize: 10.5, color: '#64748b' }}>Open original ↗</span>
                        </a>
                      )}
                      {isVid && (!videoSrc || vidFailed.has(saved.id)) && (
                        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '2px 7px', borderRadius: 100 }}>▶ Video</span>
                      )}
                    </div>
                    {/* copy */}
                    {(title || body) && (
                      <div style={{ padding: '9px 12px 12px' }}>
                        {title && <div style={{ fontSize: 12, fontWeight: 700, color: '#111', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{title}</div>}
                        {body && <div style={{ fontSize: 11.5, color: '#4b5563', marginTop: 2, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{body}</div>}
                      </div>
                    )}
                    {/* tags (cross-cutting, click to filter) */}
                    <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                      {(saved.tags || []).map(t => (
                        <span key={t} onClick={() => setTagFilter(t)} title="Filter by this tag"
                          style={{ fontSize: 10.5, fontWeight: 700, color: '#1e40af', background: '#dbeafe', padding: '2px 6px 2px 8px', borderRadius: 100, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                          {t}
                          <span onClick={e => { e.stopPropagation(); removeTag(saved.id, t) }} style={{ cursor: 'pointer', color: '#93a3c4', fontWeight: 800 }}>×</span>
                        </span>
                      ))}
                      {tagInput === saved.id ? (
                        <input autoFocus onBlur={() => setTagInput(null)}
                          onKeyDown={e => { if (e.key === 'Enter') addTag(saved.id, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setTagInput(null) }}
                          placeholder="tag…" style={{ fontSize: 10.5, padding: '2px 7px', border: '1px solid #c7d2fe', borderRadius: 100, outline: 'none', width: 72, fontFamily: 'inherit' }} />
                      ) : (
                        <button onClick={() => setTagInput(saved.id)} style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', background: '#f1f5f9', border: 'none', padding: '2px 8px', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit' }}>+ tag</button>
                      )}
                    </div>
                    {/* Clone CTA — prominent footer so it's unmissable */}
                    <div style={{ marginTop: 'auto', padding: '0 12px 12px' }}>
                      <button onClick={() => (isVid ? setCloneVid(saved) : setCloneImg(saved))}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#12290f')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#1a3a1a')}>
                        <Sparkles size={14} /> Remake{isVid ? ' video' : ''} with my product
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          </>
        )}
      </div>
      </div> {/* end body flex */}

      {/* Clone modals — reference is the saved creative (external R2 image/mp4 or an internal ad). */}
      {cloneImg && (
        <CloneModal
          ad={{
            id: cloneImg.ad_id,
            pageId: cloneImg.ad_data?.page_id || '',
            pageName: cloneImg.page_name || 'this brand',
            // External (extension) ads have no discovery_ads_index row → clone from the R2 image.
            // Internal saves keep their ad_id so the route can pull the ad's DNA.
            assetImageUrl: isExternal(cloneImg) ? (cloneImg.snapshot_url || undefined) : undefined,
          }}
          onClose={() => setCloneImg(null)}
        />
      )}
      {cloneVid && (
        <CloneVideoModal
          sourceAdId={isExternal(cloneVid) ? '' : cloneVid.ad_id}
          sourceVideoUrl={isExternal(cloneVid) ? cloneVid.snapshot_url : undefined}
          sourcePoster={cloneVid.ad_data?.thumbnailUrl || undefined}
          onClose={() => setCloneVid(null)}
        />
      )}
    </div>
  )
}
