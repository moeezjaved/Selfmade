'use client'

/**
 * /studio/storyboard — the storyboard-before-generation view (Phase 2). Shows a job's analysis as
 * editable scene cards; approving generates only the plan you kept. Client-only for URL param reads.
 */
import dynamic from 'next/dynamic'

const Storyboard = dynamic(() => import('@/components/video/Storyboard'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 14, color: '#6f6d5a' }}>Loading the storyboard…</div>,
})

export default function StoryboardPage() {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '28px 24px 80px' }}>
      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b7a62' }}>Storyboard · before generation</div>
      <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 30, color: '#1c2617', margin: '4px 0 6px', fontWeight: 400 }}>Shape the plan, then shoot</h1>
      <p style={{ fontSize: 14, color: '#66755d', margin: '0 0 22px', lineHeight: 1.6 }}>Mello analyzed the winning ad into scenes and a script. Edit anything here — it’s free. Seedance only shoots once you approve.</p>
      <Storyboard />
    </div>
  )
}
