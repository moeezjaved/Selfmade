'use client'
/**
 * The one "Create an ad" launcher (sidebar CTA, on every dashboard page). It unifies what used to be
 * two confusing entry points ("Create Ad" = original picture only, "Remake an ad" = video upload only)
 * into a single, layperson-clear chooser with three doors:
 *   1. Remake a winning ad → /discovery (pick a proven ad; picture or video, auto-detected on the card)
 *   2. Remake my own ad     → upload an IMAGE or a VIDEO from your computer → remake it
 *        • image → presign R2 PUT (/api/discovery/remake-upload) → CloneModal (assetImageUrl = uploaded)
 *        • video → same presign → CloneVideoModal (sourceVideoUrl = uploaded)
 *   3. Create a fresh ad    → /creative-studio?studio=1 (AI Studio — design an original from scratch)
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Upload, Trophy, Sparkles, X, Loader2 } from 'lucide-react'

const CloneVideoModal = dynamic(() => import('@/app/(dashboard)/discovery/CloneVideoModal'), { ssr: false })
const CloneModal = dynamic(() => import('@/app/(dashboard)/discovery/CloneModal'), { ssr: false })

const LIME = '#dffe95', FOREST = '#17251c', L_INK = '#161c17', L_MUTED = '#68756b', L_LINE = '#e7ece7', SEL_BG = '#f4fbe6', SEL_BORDER = '#a8cf6f', GREEN = '#3f8f4f'

export default function RemakeStarter() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const isVideo = f.type.startsWith('video/')
    const cap = isVideo ? 200e6 : 25e6
    if (f.size > cap) { setErr(`${isVideo ? 'Video' : 'Image'} must be under ${Math.round(cap / 1e6)} MB.`); return }
    setBusy(true); setErr(null)
    try {
      const pres = await fetch('/api/discovery/remake-upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileType: f.type, sizeBytes: f.size }),
      })
      const pj = await pres.json().catch(() => ({}))
      if (!pres.ok) throw new Error(pj?.message || 'Upload is temporarily unavailable.')
      // Direct browser→R2 PUT. A dropped connection / transient block throws "Failed to fetch" — retry
      // once before giving up, and translate the raw network error into something actionable.
      const putOnce = () => fetch(pj.uploadUrl, { method: 'PUT', headers: { 'content-type': f.type }, body: f })
      let put: Response
      try { put = await putOnce() }
      catch { try { put = await putOnce() } catch { throw new Error(`Couldn't upload the ${isVideo ? 'video' : 'image'} to storage — check your connection and try again. If it keeps failing on a large video, try a smaller file.`) } }
      if (!put.ok) throw new Error(`Upload failed (${put.status}) — please try again.`)
      setOpen(false)
      if (pj.kind === 'image') setImageUrl(pj.publicUrl)   // → CloneModal (picture remake of the upload)
      else setVideoUrl(pj.publicUrl)                        // → CloneVideoModal (video remake of the upload)
    } catch (e: any) {
      setErr(e?.message || 'Upload failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => { setErr(null); setOpen(true) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
          margin: '0 0 4px', padding: '13px 14px', borderRadius: 14, cursor: 'pointer',
          background: 'radial-gradient(120% 140% at 85% 0%, #fdf6c9 0%, transparent 55%), radial-gradient(130% 120% at 0% 100%, #d9f7d0 0%, transparent 60%), linear-gradient(135deg, #eefbd2 0%, #dffe95 55%, #d3f4e2 100%)',
          border: '1px solid #cfe9a4', color: FOREST,
          boxShadow: '0 6px 18px rgba(190,240,90,.25)',
        }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 9, background: FOREST, color: LIME, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>＋</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, letterSpacing: '-.01em' }}>Create an ad</span>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#41543f' }}>Remake a winner, upload your own, or start fresh</span>
        </span>
      </button>

      {open && (
        <div onClick={() => !busy && setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,10,.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 20, border: '1px solid #dfe4de', boxShadow: '0 30px 90px -30px rgba(23,37,28,.4)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid #e0eecb', background: 'radial-gradient(90% 200% at 100% 0%, #fdf3cf 0%, transparent 50%),radial-gradient(80% 160% at 0% 30%, #e3f9d6 0%, transparent 55%),linear-gradient(120deg,#f6fceb,#f0fae2 45%,#edf8ee)' }}>
              <b style={{ fontSize: 16.5, color: L_INK, letterSpacing: '-.01em' }}>What do you want to make?</b>
              <button onClick={() => !busy && setOpen(false)} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid #dcebc4', background: 'rgba(255,255,255,.8)', color: '#3c473e', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            <div style={{ padding: 18 }}>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: L_MUTED, lineHeight: 1.5 }}>Pick one — no editing skills needed. We do the work; you approve before anything is charged.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button style={opt} disabled={busy} onClick={() => { setOpen(false); router.push('/discovery') }}>
                  <span style={iconWrap}><Trophy size={20} color={GREEN} /></span>
                  <span style={{ flex: 1 }}>
                    <b style={{ fontSize: 14.5, display: 'block' }}>Remake a winning ad</b>
                    <small style={{ fontSize: 12, color: L_MUTED }}>Copy a proven ad with your product — browse thousands of live winners.</small>
                  </span>
                </button>

                <button style={{ ...opt, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => fileRef.current?.click()}>
                  <span style={iconWrap}>{busy ? <Loader2 size={20} color={GREEN} className="spin" /> : <Upload size={20} color={GREEN} />}</span>
                  <span style={{ flex: 1 }}>
                    <b style={{ fontSize: 14.5, display: 'block' }}>{busy ? 'Uploading…' : 'Remake my own ad'}</b>
                    <small style={{ fontSize: 12, color: L_MUTED }}>Upload an image or a video from your computer and we’ll rebuild it.</small>
                  </span>
                </button>

                <button style={opt} disabled={busy} onClick={() => { setOpen(false); router.push('/creative-studio?studio=1') }}>
                  <span style={iconWrap}><Sparkles size={20} color={GREEN} /></span>
                  <span style={{ flex: 1 }}>
                    <b style={{ fontSize: 14.5, display: 'block' }}>Create a fresh ad</b>
                    <small style={{ fontSize: 12, color: L_MUTED }}>No ad in mind? We’ll design an original from scratch with AI.</small>
                  </span>
                </button>
              </div>

              {err && <div style={{ marginTop: 12, fontSize: 13, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 12px' }}>{err}</div>}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden onChange={onFile} />
            </div>
          </div>
          <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {videoUrl && <CloneVideoModal sourceAdId="" sourceVideoUrl={videoUrl} onClose={() => setVideoUrl(null)} />}
      {imageUrl && <CloneModal ad={{ id: `upload:${Date.now()}`, pageId: '', pageName: 'Your ad', assetImageUrl: imageUrl, sourceThumb: imageUrl }} onClose={() => setImageUrl(null)} />}
    </>
  )
}

const opt: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
  padding: '14px 15px', borderRadius: 14, border: `1.5px solid ${L_LINE}`, background: '#fff',
  cursor: 'pointer', color: L_INK, fontFamily: 'inherit',
}
const iconWrap: React.CSSProperties = { width: 40, height: 40, borderRadius: 11, background: SEL_BG, border: `1px solid ${SEL_BORDER}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
