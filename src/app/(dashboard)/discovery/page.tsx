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

const DiscoveryClient = dynamic(() => import('./DiscoveryClient'), {
  ssr: false,
  loading: () => <div style={{ minHeight: '100vh', background: '#f8fafc' }} />,
})

export default function DiscoveryPage() {
  return <DiscoveryClient />
}
