'use client'
/**
 * TRY MELLO — the feature-discovery deck at the top of the Brief (Ploy's Overview
 * pattern). Founders didn't know they could spy a brand, remake a competitor's ad,
 * upload their own ad to clone, generate fresh, or let Mello run daily. Each is now a
 * card with a badge + one-liner + a real action button. Cards dismiss individually
 * (localStorage); once all are gone the deck disappears — it's a nudge, not clutter.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Eye, Trophy, Upload, Sparkles, CalendarClock, X, Loader2 } from 'lucide-react'

const CloneVideoModal = dynamic(() => import('@/app/(dashboard)/discovery/CloneVideoModal'), { ssr: false })
const CloneModal = dynamic(() => import('@/app/(dashboard)/discovery/CloneModal'), { ssr: false })
const MakeAdsModal = dynamic(() => import('@/components/MakeAdsModal'), { ssr: false })

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', FOREST = '#17251c', GREEN = '#3f8f4f', SEL_BG = '#f4fbe6', SEL_BORDER = '#a8cf6f'
const DISMISS_KEY = 'brief_trymello_v1'

type Tone = 'try' | 'opp'
type Card = { id: string; icon: any; badge: string; tone: Tone; title: string; short: string; desc: string; cta: string; run: () => void }

export default function TryMello({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [makeAds, setMakeAds] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Cards render immediately (SSR + first paint show all 5, dismissed=[]); after mount
  // we hide any the user already dismissed — no flash, no hydration mismatch.
  useEffect(() => {
    try { setDismissed(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')) } catch {}
  }, [])
  const dismiss = (id: string) => {
    const next = Array.from(new Set([...dismissed, id]))
    setDismissed(next)
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)) } catch {}
  }

  // Upload → clone (same flow as the Create chooser's "Remake my own ad")
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const isVideo = f.type.startsWith('video/')
    const cap = isVideo ? 200e6 : 25e6
    if (f.size > cap) { setErr(`${isVideo ? 'Video' : 'Image'} must be under ${Math.round(cap / 1e6)} MB.`); return }
    setBusy(true); setErr(null)
    try {
      const pres = await fetch('/api/discovery/remake-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileType: f.type, sizeBytes: f.size }) })
      const pj = await pres.json().catch(() => ({}))
      if (!pres.ok) throw new Error(pj?.message || 'Upload is temporarily unavailable.')
      const putOnce = () => fetch(pj.uploadUrl, { method: 'PUT', headers: { 'content-type': f.type }, body: f })
      let put: Response
      try { put = await putOnce() } catch { put = await putOnce() }
      if (!put.ok) throw new Error(`Upload failed (${put.status}) — please try again.`)
      if (pj.kind === 'image') setImageUrl(pj.publicUrl); else setVideoUrl(pj.publicUrl)
    } catch (e: any) { setErr(e?.message || 'Upload failed — please try again.') }
    finally { setBusy(false) }
  }

  const cards: Card[] = [
    { id: 'spy', icon: Eye, badge: 'Try this', tone: 'try', title: 'Spy on a competitor brand', short: 'Spy a brand', desc: 'Track any brand and Mello watches every ad they launch — new drops land in this brief.', cta: 'Spy a brand', run: () => router.push('/discovery/brand-spy') },
    { id: 'remake', icon: Trophy, badge: 'Try this', tone: 'try', title: 'Remake a winning competitor ad', short: 'Remake a winner', desc: 'Browse thousands of live winners and rebuild any one of them around your product.', cta: 'Browse winners', run: () => router.push('/discovery') },
    { id: 'upload', icon: Upload, badge: 'Try this', tone: 'try', title: 'Upload your own ad — we’ll clone it', short: busy ? 'Uploading…' : 'Upload & clone', desc: 'Drop in an image or a video from your computer and Mello rebuilds it as a fresh ad.', cta: busy ? 'Uploading…' : 'Upload & clone', run: () => fileRef.current?.click() },
    { id: 'fresh', icon: Sparkles, badge: 'Try this', tone: 'try', title: 'Create a fresh ad with AI', short: 'Create fresh', desc: 'No ad in mind? Mello designs an original from scratch, on-brand, in minutes.', cta: 'Create an ad', run: () => router.push('/studio') },
    { id: 'daily', icon: CalendarClock, badge: 'Opportunity', tone: 'opp', title: 'Let Mello make ads for you daily', short: 'Daily ads', desc: 'Pick how many per day — see the credit cost first, then Mello delivers them to your brief every morning.', cta: 'Set it up', run: () => setMakeAds(true) },
  ]

  // Shared tail — the hidden file input + modals + error, used by both variants.
  const tail = (
    <>
      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '8px 12px' }}>{err}</div>}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden onChange={onFile} />
      {makeAds && <MakeAdsModal brandId={null} onClose={() => setMakeAds(false)} />}
      {videoUrl && <CloneVideoModal sourceAdId="" sourceVideoUrl={videoUrl} onClose={() => setVideoUrl(null)} />}
      {imageUrl && <CloneModal ad={{ id: `upload:${Date.now()}`, pageId: '', pageName: 'Your ad', assetImageUrl: imageUrl, sourceThumb: imageUrl }} onClose={() => setImageUrl(null)} />}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )

  // ── Compact variant — a quiet row of chips that keeps every action on the brief without a wall of cards ──
  if (compact) {
    return (
      <div style={{ marginTop: 30 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>Or start something</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {cards.map(c => {
            const Icon = c.icon
            return (
              <button key={c.id} onClick={c.run} disabled={busy && c.id === 'upload'} title={c.desc}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '9px 15px', fontSize: 13, fontWeight: 750, color: INK, cursor: (busy && c.id === 'upload') ? 'default' : 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = SEL_BORDER; e.currentTarget.style.background = SEL_BG }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = LINE; e.currentTarget.style.background = '#fff' }}>
                {busy && c.id === 'upload' ? <Loader2 size={14} className="spin" color={GREEN} /> : <Icon size={14} color={GREEN} />}
                {c.short}
              </button>
            )
          })}
        </div>
        {tail}
      </div>
    )
  }

  const visible = cards.filter(c => !dismissed.includes(c.id))
  if (visible.length === 0) return null

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }}>What Mello can do for you</div>
        <button onClick={() => cards.forEach(c => dismiss(c.id))} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#9aa79a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Hide all</button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {visible.map(c => {
          const Icon = c.icon
          return (
            <div key={c.id} style={{ position: 'relative', border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: '15px 16px', display: 'flex', gap: 13, alignItems: 'flex-start' }}>
              <span style={{ width: 40, height: 40, borderRadius: 11, background: SEL_BG, border: `1px solid ${SEL_BORDER}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={19} color={GREEN} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', borderRadius: 100, padding: '3px 9px', background: c.tone === 'opp' ? '#eaf6df' : '#fff6d6', color: c.tone === 'opp' ? '#2c4a1f' : '#7a5a12' }}>{c.badge}</span>
                <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: '-.012em', margin: '9px 0 3px' }}>{c.title}</div>
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, maxWidth: '52ch' }}>{c.desc}</div>
                <button onClick={c.run} disabled={busy && c.id === 'upload'} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, background: FOREST, color: '#dffe95', border: 'none', borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {busy && c.id === 'upload' && <Loader2 size={13} className="spin" />}{c.cta}
                </button>
              </div>
              <button onClick={() => dismiss(c.id)} aria-label="Dismiss" style={{ position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: 7, border: 'none', background: 'transparent', color: '#b4bcb2', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><X size={15} /></button>
            </div>
          )
        })}
      </div>

      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '8px 12px' }}>{err}</div>}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden onChange={onFile} />

      {makeAds && <MakeAdsModal brandId={null} onClose={() => setMakeAds(false)} />}
      {videoUrl && <CloneVideoModal sourceAdId="" sourceVideoUrl={videoUrl} onClose={() => setVideoUrl(null)} />}
      {imageUrl && <CloneModal ad={{ id: `upload:${Date.now()}`, pageId: '', pageName: 'Your ad', assetImageUrl: imageUrl, sourceThumb: imageUrl }} onClose={() => setImageUrl(null)} />}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
