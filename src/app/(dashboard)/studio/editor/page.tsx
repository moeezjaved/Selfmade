'use client'

/**
 * /studio/editor — the Remotion editor landing (Phase 1 Step 3). Loads the user's latest finished
 * remake as an editable timeline and plays it live with a free-edit inspector. Editor is client-only
 * (ssr:false) because @remotion/player is browser-only; jobId (optional) is read from the URL inside it.
 */
import dynamic from 'next/dynamic'

const RemotionEditor = dynamic(() => import('@/components/video/RemotionEditor'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 14, color: '#68756b' }}>Loading the editor…</div>,
})

export default function EditorPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 24px 80px' }}>
      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b7a62' }}>Video editor · preview</div>
      <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 30, color: '#1c2617', margin: '4px 0 18px', fontWeight: 400 }}>Edit your ad — live, instant, free</h1>
      <RemotionEditor />
    </div>
  )
}
