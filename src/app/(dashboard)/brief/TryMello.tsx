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

  // ── THE MENU — what Mello can take off your plate.
  // Polsia's lesson (a verb per capability, and "do it now" paired with "just do it every day")
  // in a premium form: ranked rows, serif verbs, hairlines instead of boxes, and the accent spent
  // exactly once — on the delegation. It never self-destructs; a menu you can lose isn't a menu.
  const MENU: { id: string; verb: string; desc: string; auto?: boolean }[] = [
    { id: 'remake', verb: 'Remake a winner', desc: 'Their proven ad, rebuilt around your product.' },
    { id: 'fresh', verb: 'Create a fresh ad', desc: 'An original, on-brand, from your product photos.' },
    { id: 'spy', verb: 'Spy on a competitor', desc: 'I’ll watch every ad they launch and tell you here.' },
    { id: 'upload', verb: 'Clone your own ad', desc: 'Drop in an image or a video — I’ll rebuild it.' },
    { id: 'daily', verb: 'Make ads for me daily', desc: 'Pick how many and I’ll deliver them every morning.', auto: true },
  ]
  if (compact) {
    const runById = (id: string) => cards.find(c => c.id === id)?.run()
    return (
      <div style={{ marginTop: 46 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 }}>What Mello can do</div>
        <div>
          {MENU.map((m, i) => (
            <button key={m.id} onClick={() => runById(m.id)} disabled={busy && m.id === 'upload'} className="mello-menu-row"
              style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left', background: 'none', border: 'none',
                borderTop: i === 0 ? 'none' : `1px solid ${LINE}`, padding: '15px 0', cursor: (busy && m.id === 'upload') ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="mm-verb" style={{ display: 'block', fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 21, fontWeight: 400, letterSpacing: '-.01em', color: INK, transition: 'color .15s' }}>
                  {busy && m.id === 'upload' ? 'Uploading…' : m.verb}
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: MUTED, marginTop: 2 }}>{m.desc}</span>
              </span>
              {m.auto
                ? <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: FOREST, background: SEL_BG, border: `1px solid ${SEL_BORDER}`, borderRadius: 100, padding: '5px 11px' }}>Auto</span>
                : <span className="mm-arrow" style={{ flexShrink: 0, color: '#c2ccc0', fontSize: 15, transition: 'color .15s, transform .15s' }}>→</span>}
            </button>
          ))}
        </div>
        <style>{`.mello-menu-row:hover .mm-verb{color:${GREEN}}.mello-menu-row:hover .mm-arrow{color:${GREEN};transform:translateX(3px)}`}</style>
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
