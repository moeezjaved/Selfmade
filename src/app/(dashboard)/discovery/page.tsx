'use client'
/**
 * Discovery route shell. DiscoveryClient loads via next/dynamic(ssr:false) — this keeps it (and its
 * masonic + heavy import graph) OUT of the server bundle entirely, so the /discovery serverless
 * function renders only this tiny shell + the loading fallback. That's the LIGHTEST, most reliable
 * server render.
 *
 * A static import was tried and REVERTED: pulling DiscoveryClient into the page module made it
 * evaluate server-side, which broke the document on direct load (client JS stopped firing — the page
 * went fully dead, worse than before). ssr:false is the correct lever here. (error.tsx + loading.tsx
 * handle the separate intermittent server-render failures.)
 */
import dynamic from 'next/dynamic'

// Skeleton shown WHILE the (heavy) DiscoveryClient chunk loads + hydrates. Previously this was a plain
// grey div → the user saw blank, then the whole grid slammed in at once ("flash on load"). A shimmer
// card grid makes the load read as intentional/progressive instead of blank-then-burst.
function GridSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '14px 24px' }}>
      <div style={{ height: 38, width: 360, maxWidth: '60%', background: '#e9edf2', borderRadius: 10, marginBottom: 16 }} className="shimmer" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14, alignItems: 'start' }}>
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e9edf2', overflow: 'hidden' }}>
            <div style={{ aspectRatio: i % 3 === 0 ? '3 / 4' : i % 3 === 1 ? '1 / 1' : '4 / 5', background: '#e9edf2' }} className="shimmer" />
            <div style={{ padding: 12 }}>
              <div style={{ height: 10, background: '#e9edf2', borderRadius: 6, marginBottom: 7, width: '72%' }} className="shimmer" />
              <div style={{ height: 9, background: '#eef1f5', borderRadius: 6, width: '45%' }} className="shimmer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const DiscoveryClient = dynamic(() => import('./DiscoveryClient'), {
  ssr: false,
  loading: () => <GridSkeleton />,
})

export default function DiscoveryPage() {
  return <DiscoveryClient />
}
