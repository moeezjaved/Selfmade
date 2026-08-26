'use client'
/**
 * The old standalone Studio UI is retired. This route now redirects into the new embedded Ad Studio
 * (/ads-workspace), forwarding the query string so remake handoffs (?ad=&img=&brand=…) continue there —
 * Ad Studio seeds the remake from ?img=. The old implementation is kept in StudioLegacyClient.tsx for
 * rollback (not routed).
 */
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function Redirector() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const qs = params.toString()
    router.replace(`/ads-workspace${qs ? `?${qs}` : ''}`)
  }, [router, params])
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa196', fontSize: 14 }}>
      Opening Ad Studio…
    </div>
  )
}

export default function StudioRedirectPage() {
  return <Suspense fallback={null}><Redirector /></Suspense>
}
