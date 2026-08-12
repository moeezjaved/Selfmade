'use client'
/**
 * Ad Detail page (Atria-style 3-column layout).
 *   [ad preview] [ad info] [save details + Atria-AI clone]
 */
import { useEffect, useState, useRef } from 'react'
import CloneModal from '../CloneModal'
import CloneVideoModal from '../CloneVideoModal'
import RemakeAdaptation from '../RemakeAdaptation'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { X, Bookmark, Link as LinkIcon, Download, Sparkles, ExternalLink } from 'lucide-react'
import { cleanCopy } from '@/lib/cleanCopy'
import { useCredits, confirmCredits, refreshCredits } from '@/components/credits/CreditCounter'
import { imagesAreFree } from '@/lib/plans'
import toast from 'react-hot-toast'
import { useIsMobile } from '@/lib/useIsMobile'

interface Creative {
  position: number
  asset_type: 'image' | 'video'
  r2_url: string
  hash: string | null
}

interface Ad {
  id: string
  pageId: string
  pageName: string
  body: string
  title: string
  caption: string
  description: string
  snapshotUrl: string
  thumbnailUrl: string | null
  videoUrl: string | null
  creatives: Creative[]
  startDate: string
  stopDate: string | null
  platforms: string[]
  languages: string[]
  isActive: boolean
  daysRunning: number
  country: string
  format: string
  industries: string[]
  topics: string[]
  hookType: string | null
  angle: string | null
  persona: string | null
  usp: string | null
  aiClassified: boolean
  cta: string | null
  mediaType: string
}

const PLATFORM_ICONS: Record<string, string> = {
  facebook: '📘', instagram: '📸', audience_network: '🌐', messenger: '💬',
}

export default function AdDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [ad, setAd] = useState<Ad | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tags, setTags] = useState('')
  const [copied, setCopied] = useState(false)
  const isMobile = useIsMobile()
  const [boards, setBoards] = useState<{ id: string; name: string; emoji?: string }[]>([])
  const [selectedBoard, setSelectedBoard] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!params?.id) return
    ;(async () => {
      try {
        const res = await fetch(`/api/discovery/ad/${params.id}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        setAd(j.ad)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [params?.id])

  // Load the user's boards for the "Save to board" picker.
  useEffect(() => {
    fetch('/api/discovery/boards').then(r => r.json()).then(d => setBoards(d.boards || [])).catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!ad) return
    if (!selectedBoard) { toast.error('Pick a board to save into first.'); return }
    setSaving(true)
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean)
      const res = await fetch('/api/discovery/saved', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_id: selectedBoard, ad_id: ad.id, page_id: ad.pageId, page_name: ad.pageName, snapshot_url: ad.snapshotUrl, ad_data: { ...ad, tags: tagList } }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || 'Could not save') }
      toast.success('✓ Saved to board')
    } catch (e: any) { toast.error(e?.message || 'Could not save') }
    finally { setSaving(false) }
  }

  const copyLink = async () => {
    if (!ad) return
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  if (loading) return <div style={{ padding: 28, color: '#6b7280' }}>Loading…</div>
  if (error) return <div style={{ padding: 28, color: '#c0392b' }}>Error: {error}</div>
  if (!ad) return <div style={{ padding: 28 }}>Ad not found.</div>

  const slides: { type: 'image' | 'video'; url: string }[] = (() => {
    if (ad.creatives && ad.creatives.length > 0) {
      const sorted = [...ad.creatives].sort((a, b) => {
        if (a.asset_type !== b.asset_type) return a.asset_type === 'image' ? -1 : 1
        return a.position - b.position
      })
      return sorted.map((c) => ({ type: c.asset_type, url: c.r2_url }))
    }
    const fallback: { type: 'image' | 'video'; url: string }[] = []
    if (ad.thumbnailUrl) fallback.push({ type: 'image', url: ad.thumbnailUrl })
    if (ad.videoUrl) fallback.push({ type: 'video', url: ad.videoUrl })
    return fallback
  })()

  const brandPicture = ad.pageId ? `https://graph.facebook.com/${ad.pageId}/picture?type=large` : null
  const startFmt = ad.startDate ? new Date(ad.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const endFmt = ad.stopDate ? new Date(ad.stopDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const runningTime = ad.daysRunning > 0 ? `${ad.daysRunning} days` : '—'

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto', minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.back()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#6b7280' }}>
            <X size={18} />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>Ad Detail</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleSave} disabled={saving}
            title={selectedBoard ? 'Save to the selected board' : 'Pick a board under “Save Details” first'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: '#ff5a2c', color: '#fff', border: 'none', fontWeight: 800, fontSize: 13, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>
            <Bookmark size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={copyLink}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: '#fff', color: '#111', border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            <LinkIcon size={14} /> {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>

      {/* Mello's pre-adaptation — the winning ad, already rewritten for the user's brand */}
      <RemakeAdaptation adId={ad.id} isVideo={!!ad.videoUrl} videoUrl={ad.videoUrl} poster={ad.thumbnailUrl} />

      {/* 3-column layout */}
      <div id="remake-cta" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px 360px', gap: 18, alignItems: 'start' }}>
        {/* ── LEFT: ad preview ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#141d15', overflow: 'hidden', flexShrink: 0 }}>
              {brandPicture && <img src={brandPicture} alt={ad.pageName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{ad.pageName}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Sponsored</div>
            </div>
            <button style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#111', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              ♡ Follow
            </button>
          </div>
          <div style={{ padding: '0 16px 8px', fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db' }} />
            <span>{startFmt} – {ad.stopDate ? endFmt : 'Present'}</span>
          </div>
          {cleanCopy(ad.body) && (
            <div style={{ padding: '0 16px 14px', fontSize: 13, color: '#1f2937', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {cleanCopy(ad.body)}
            </div>
          )}
          <DetailMedia slides={slides} adId={ad.id} />
          {(ad.title || ad.caption) && (
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {ad.caption && <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'lowercase' }}>{ad.caption}</div>}
                {ad.title && <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginTop: 2 }}>{ad.title}</div>}
                {ad.description && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{ad.description}</div>}
              </div>
              <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer"
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0', color: '#111', textDecoration: 'none' }}>
                {ad.cta || 'Learn more'}
              </a>
            </div>
          )}
        </div>

        {/* ── MIDDLE: ad info ── */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#d1d5db' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{ad.isActive ? 'Active' : 'Inactive'}</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>· Ad ID: {ad.id}</span>
            <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280' }}>
              <ExternalLink size={13} />
            </a>
          </div>

          <InfoRow label="Start date" value={startFmt} />
          <InfoRow label="End date" value={ad.stopDate ? endFmt : '—'} />
          <InfoRow label="Running time" value={runningTime} />
          <InfoRow label="Platforms" value={
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {ad.platforms.map(p => <span key={p} style={{ fontSize: 16 }} title={p}>{PLATFORM_ICONS[p] || '🌐'}</span>)}
            </div>
          } />
          <InfoRow label="Display format" value={ad.format} />
          {/* Accurate AI topics (gpt-4o-mini) — the old `industries` keyword-detection
              was unreliable (e.g. "Travel & Tourism" on a shampoo ad). Fall back to it
              only if an ad hasn't been classified yet. */}
          <InfoRow label="Categories" value={
            (ad.topics && ad.topics.length ? ad.topics : (ad.industries || []))
              .map(t => t.replace(/\b\w/g, c => c.toUpperCase())).join(', ') || '—'
          } />
        </div>

        {/* ── RIGHT: save details + Atria AI ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 12 }}>Save Details</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>🏷 Tags</div>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="Add tags..."
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', marginBottom: 14 }}
            />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>📋 Boards</div>
            <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', marginBottom: 14, background: '#fff' }}>
              <option value="">Select board…</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.emoji ? `${b.emoji} ` : ''}{b.name}</option>)}
            </select>
            <button onClick={handleSave} disabled={saving || !selectedBoard}
              style={{ width: '100%', padding: '10px', background: '#ff5a2c', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: (saving || !selectedBoard) ? 'default' : 'pointer', fontFamily: 'inherit', opacity: (saving || !selectedBoard) ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>

          <AiPanel ad={ad} />

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>Comments</div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', background: '#f1f5f9', padding: '2px 8px', borderRadius: 100 }}>Coming soon</span>
            </div>
            <input placeholder="Team comments on ads are coming soon…" disabled style={{ marginTop: 10, width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#f8fafc', color: '#9ca3af', cursor: 'not-allowed' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{value}</div>
    </div>
  )
}

/** Format-aware AI actions: Scripts (transcribe → framework → duplicate) for VIDEO
 *  ads, Clone for IMAGE ads. Each action goes through the credit gate. */
function AiPanel({ ad }: { ad: Ad }) {
  const { balance, pricing, plan } = useCredits()
  const imagesFree = imagesAreFree(plan)   // Creator/Agency: image remakes are free + unlimited
  const isVideo = ad.format === 'Video' || !!ad.videoUrl
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneVideoOpen, setCloneVideoOpen] = useState(false)
  const [script, setScript] = useState<any>(null)
  const [thin, setThin] = useState(false)
  const [gen, setGen] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [brands, setBrands] = useState<any[]>([])
  const [brandId, setBrandId] = useState('')
  const [scriptLang, setScriptLang] = useState('en')   // target language for the rewrite (matches Remake — defaults to English, not the source ad's language)

  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then(d => {
      setBrands(d.brands || []); if (d.brands?.[0]) setBrandId(d.brands[0].id)
    }).catch(() => {})
  }, [])

  // Opened via the grid's "📝 Scripts →" button (?script=1) → auto-generate the free transcript so the
  // user lands on the populated script flow, not an empty panel. The paid "Rewrite for my brand" step
  // stays a deliberate click (with its credit confirm) — never auto-charged.
  const wantScript = useSearchParams().get('script')
  const didAutoScript = useRef(false)
  useEffect(() => {
    if (!wantScript || didAutoScript.current || !isVideo || script) return
    didAutoScript.current = true
    run('/api/scripts/transcribe', { adId: ad.id }, 'transcribe', 0, d => { setScript(d.script); setThin(!!d.thinSpeech) })
  }, [wantScript, isVideo])   // eslint-disable-line react-hooks/exhaustive-deps

  const cost = (a: string, d: number) => pricing?.[a]?.credits ?? d

  async function run(url: string, body: any, action: string, dflt: number, onOk: (d: any) => void) {
    // dflt <= 0 marks a FREE action (e.g. Generate Script) — don't read the price row or gate on balance.
    const c = dflt <= 0 ? 0 : cost(action, dflt)
    if (c > 0 && !confirmCredits(action.replace('_', ' '), c, balance)) return
    setLoading(true); setErr(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error === 'insufficient_credits' ? `Need ${d.need} credits (you have ${d.have})` : d.error || 'failed'); return }
      onOk(d); refreshCredits()
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }

  const cardS: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }
  const ctaS: React.CSSProperties = { width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(135deg,#141d15,#2d5a2d 50%,#ff5a2c)', color: '#fff', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }

  return (
    <div style={cardS}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>Selfmade AI</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>◆ {balance.toLocaleString()} credits</div>
      </div>

      {isVideo ? (
        <>
        {/* Primary action for a video ad: clone it into the user's OWN product ad (Seedance). */}
        <button style={ctaS} onClick={() => setCloneVideoOpen(true)}>
          <Sparkles size={16} /> Remake this video · from {cost('video_clone', 600)} cr
        </button>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>Recreate this ad’s hook &amp; pacing with your product — you approve the script before any credits are spent.</div>
        {cloneVideoOpen && <CloneVideoModal sourceAdId={ad.id} sourceVideoUrl={ad.videoUrl} sourcePoster={ad.thumbnailUrl} onClose={() => setCloneVideoOpen(false)} />}
        {/* Secondary: script tools (transcribe → framework → duplicate). */}
        <div style={{ borderTop: '1px solid #eef2f0', marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Or turn it into a script</div>
        {!script ? (
          // Enabled 2026-07-30 — the transcribe→framework flow is live (was gated 'Coming soon' for the
          // clone-first launch). Show the cost up front so the price isn't a surprise after clicking.
          <>
          <button style={{ ...ctaS, background: '#eef7dc', color: '#141d15' }}
            onClick={() => run('/api/scripts/transcribe', { adId: ad.id }, 'transcribe', 0, d => { setScript(d.script); setThin(!!d.thinSpeech) })}>
            <Sparkles size={16} /> Generate Script · Free
          </button>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>Reads this ad&rsquo;s hook &amp; structure. Rewriting it around your product is a separate step.</div>
          </>
        ) : (
          <div>
            {thin && <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 8px', marginBottom: 8 }}>⚠ Mostly on-screen text / little speech — analyzed from the ad copy. Full on-screen transcription coming soon.</div>}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Framework: <span style={{ color: '#141d15' }}>{script.framework || '—'}</span></div>
            {script.hooks?.length > 0 && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Hooks: {script.hooks.join(' · ')}</div>}
            <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 12, color: '#374151', background: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
              {(script.transcript || []).map((s: any, i: number) => <div key={i}>{s.text}</div>)}
            </div>
            {brands.length === 0 ? (
              <a href="/brands" style={{ fontSize: 12, color: '#141d15', fontWeight: 700 }}>+ Create a brand to duplicate this script →</a>
            ) : (
              <>
                <select value={brandId} onChange={e => setBrandId(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, marginBottom: 8 }}>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {/* Language selector — parity with Remake: the rewrite is transcreated into THIS language
                    (default English), not the source ad's language. */}
                <select value={scriptLang} onChange={e => setScriptLang(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, marginBottom: 8 }}>
                  {[['en','English'],['ur','Urdu'],['hi','Hindi'],['ar','Arabic'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese']].map(([v,l]) => <option key={v} value={v}>Script language: {l}</option>)}
                </select>
                <button style={{ ...ctaS, opacity: loading ? 0.6 : 1 }} disabled={loading}
                  onClick={() => run('/api/scripts/duplicate', { sourceAdId: ad.id, brandId, language: scriptLang }, 'script_duplicate', 5, d => setGen(d.generated?.script))}>
                  {loading ? 'Writing…' : `Rewrite for my brand · ${cost('script_duplicate', 5)} cr`}
                </button>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>Mello rewrites the whole script around your product — that&rsquo;s what the credits pay for.</div>
              </>
            )}
            {gen && <div style={{ marginTop: 10, fontSize: 12, color: '#111', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap' }}>{gen}</div>}
          </div>
        )}
        </div>
        </>
      ) : (
        <>
          <button style={ctaS} onClick={() => setCloneOpen(true)}>
            <Sparkles size={16} /> Remake ad · from ${((cost('image_clone_pro', 15)) / 100).toFixed(2)}
          </button>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>Composite your product onto this winning ad — 2K or 4K.</div>
          {cloneOpen && <CloneModal ad={{ id: ad.id, pageId: ad.pageId, pageName: ad.pageName, sourceThumb: ad.creatives?.find(c => c.asset_type === 'image')?.r2_url || ad.thumbnailUrl || undefined }} onClose={() => setCloneOpen(false)} />}
        </>
      )}
      {err && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{err}</div>}
    </div>
  )
}

function DetailMedia({ slides, adId }: { slides: { type: 'image' | 'video'; url: string }[]; adId: string }) {
  const [idx, setIdx] = useState(0)
  if (slides.length === 0) return <div style={{ aspectRatio: '4/5', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>No media</div>
  const slide = slides[idx]
  const total = slides.length

  const download = () => {
    // Route through the same-origin proxy — the browser ignores the `download` attribute on a
    // cross-origin URL (R2 / fbcdn), which made it open in a new tab instead of downloading.
    const name = `${adId}-${slide.type}-${idx}.${slide.type === 'video' ? 'mp4' : 'jpg'}`
    const a = document.createElement('a')
    a.href = `/api/download?url=${encodeURIComponent(slide.url)}&name=${encodeURIComponent(name)}`
    a.download = name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div style={{ position: 'relative', background: '#000', overflow: 'hidden', lineHeight: 0 }}>
      {slide.type === 'image' ? (
        <img src={slide.url} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
      ) : (
        <video src={slide.url} controls preload="metadata" style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 600 }} />
      )}
      {/* Download dropdown */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}>
        <button onClick={download}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Download size={12} /> Download
        </button>
      </div>
      {total > 1 && (
        <>
          <button onClick={() => setIdx(i => (i - 1 + total) % total)} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 18, fontWeight: 700, padding: 0, zIndex: 4 }}>‹</button>
          <button onClick={() => setIdx(i => (i + 1) % total)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.92)', color: '#111', border: 'none', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 18, fontWeight: 700, padding: 0, zIndex: 4 }}>›</button>
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5, zIndex: 4 }}>
            {slides.map((_, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,0.5)' }} />)}
          </div>
        </>
      )}
    </div>
  )
}
