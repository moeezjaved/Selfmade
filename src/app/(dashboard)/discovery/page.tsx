'use client'
/**
 * Discovery route shell. DiscoveryClient is client-only (masonic + handler-level window access), so
 * it loads via dynamic(ssr:false) — which ALSO keeps it out of this route's server bundle, so the
 * serverless function stays lean and cold-starts fast.
 *
 * NOTE on the historical "blank /discovery on direct load": that was NOT a hydration/gate issue.
 * The dashboard route group's server payload intermittently 503s under load / cold start, and with
 * no error boundary the screen stayed blank-green. The real fix is (dashboard)/error.tsx +
 * loading.tsx (retry + spinner), not this file's SSR strategy. Keeping ssr:false here (vs a static
 * import) deliberately minimizes /discovery's server function to make those 503s less likely.
 */
import dynamic from 'next/dynamic'

const DiscoveryClient = dynamic(() => import('./DiscoveryClient'), {
  ssr: false,
  loading: () => <div style={{ minHeight: '100vh', background: '#f8fafc' }} />,
})

export default function DiscoveryPage() {
  return <DiscoveryClient />
}
