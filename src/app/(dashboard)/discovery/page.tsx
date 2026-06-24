'use client'
/**
 * Discovery route shell. The real page (DiscoveryClient) is loaded with ssr:false so it is NEVER
 * server-rendered — the canonical, bulletproof way to disable SSR for a component. The earlier
 * runtime mounted-gate *should* have been equivalent, but #418/#423/#425 persisted in incognito, so
 * we remove the component from the server render entirely: the server emits only the static
 * placeholder below, the client loads + renders the page after hydration → there is no hydration
 * step for the page to fail. (Dashboard is auth-gated — no SEO cost to client-only rendering.)
 */
import dynamic from 'next/dynamic'

const DiscoveryClient = dynamic(() => import('./DiscoveryClient'), {
  ssr: false,
  loading: () => <div style={{ minHeight: '100vh', background: '#f8fafc' }} />,
})

export default function DiscoveryPage() {
  return <DiscoveryClient />
}
