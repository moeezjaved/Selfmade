/**
 * /ads-studio — the AI ads workspace (Lapis-style, our orange). Deployed to production but SEPARATE:
 * noindex, not linked from any app nav. Reachable by direct URL while we build. Entry will be the ads
 * audit (distinct from the SEO audit → /mission/seo).
 */
import type { Metadata } from 'next'
import AdsStudio from '@/components/ads/AdsStudio'

export const metadata: Metadata = {
  title: 'Ads Studio | Selfmade',
  robots: { index: false, follow: false },
}

export default function AdsStudioPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,800&display=swap" rel="stylesheet" />
      <AdsStudio />
    </>
  )
}
