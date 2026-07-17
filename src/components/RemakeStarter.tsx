'use client'
/**
 * The always-visible "＋ Remake an ad" entry (sidebar, above Ask Mello). After onboarding, this is the
 * one button that restarts the core loop from anywhere. Two doors:
 *   1. Pick a winning ad  → /discovery (the existing library flow)
 *   2. Upload your own video → presign R2 PUT (/api/discovery/remake-upload), then reuse CloneVideoModal
 *      with the uploaded URL as sourceVideoUrl (sourceAdId=""), so a user can remake ANY video they
 *      have — not just ads in our library. Product photo is uploaded inside the modal as usual.
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Upload, Compass, X } from 'lucide-react'

const CloneVideoModal = dynamic(() => import('@/app/(dashboard)/discovery/CloneVideoModal'), { ssr: false })

export default function RemakeStarter() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 200e6) { setErr('Video must be under 200 MB.'); return }
    setBusy(true); setErr(null)
    try {
      const pres = await fetch('/api/discovery/remake-upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileType: f.type, sizeBytes: f.size }),
      })
      const pj = await pres.json().catch(() => ({}))
      if (!pres.ok) throw new Error(pj?.message || 'Upload is temporarily unavailable.')
      const put = await fetch(pj.uploadUrl, { method: 'PUT', headers: { 'content-type': f.type }, body: f })
      if (!put.ok) throw new Error('Upload failed — please try again.')
      setOpen(false)
      setVideoUrl(pj.publicUrl)   // opens CloneVideoModal on the uploaded source
    } catch (e: any) {
      setErr(e?.message || 'Upload failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const opt: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
    padding: '13px 14px', borderRadius: 12, border: '1px solid #e4ece0', background: '#fff',
    cursor: 'pointer', color: '#16261a',
  }

  return (
    <>
      <button
        onClick={() => { setErr(null); setOpen(true) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
          margin: '0 0 4px', padding: '13px 14px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: '#dffe95', color: '#0e1b12',
          boxShadow: '0 6px 18px rgba(190,240,90,.28)',
        }}
      >
        <span style={{
          width: 30, height: 30, borderRadius: 9, background: '#0e1b12', color: '#dffe95',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, lineHeight: 1, flexShrink: 0,
        }}>＋</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, letterSpacing: '-.01em' }}>Remake an ad</span>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#3a5a2a' }}>A winner, or your own video</span>
        </span>
      </button>

      {open && (
        <div
          onClick={() => !busy && setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,10,.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18, padding: 20, boxShadow: '0 24px 60px rgba(8,16,10,.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <b style={{ fontSize: 17, color: '#16261a' }}>Remake an ad</b>
              <button onClick={() => !busy && setOpen(false)} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7a6b', padding: 4 }}><X size={18} /></button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, color: '#6b7a6b' }}>Start from a proven winner, or bring your own.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button style={opt} disabled={busy} onClick={() => { setOpen(false); router.push('/discovery') }}>
                <Compass size={22} color="#16321a" style={{ flexShrink: 0 }} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontSize: 14 }}>Pick a winning ad</b>
                  <small style={{ fontSize: 12, color: '#6b7a6b' }}>Browse thousands of live ads and remake one</small>
                </span>
              </button>
              <button style={{ ...opt, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={22} color="#16321a" style={{ flexShrink: 0 }} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontSize: 14 }}>{busy ? 'Uploading…' : 'Upload your own video'}</b>
                  <small style={{ fontSize: 12, color: '#6b7a6b' }}>Remake any video from your computer</small>
                </span>
              </button>
            </div>

            {err && <div style={{ marginTop: 12, fontSize: 13, color: '#b42318', background: '#fef3f2', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 12px' }}>{err}</div>}
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={onFile} />
          </div>
        </div>
      )}

      {videoUrl && <CloneVideoModal sourceAdId="" sourceVideoUrl={videoUrl} onClose={() => setVideoUrl(null)} />}
    </>
  )
}
