/**
 * Dynamic 1200×630 OG/Twitter card for the landing page. Next auto-wires og:image + twitter:image
 * from this file — so shared links (LinkedIn, X, Slack, iMessage) render a branded preview instead of
 * a bare text link. Self-contained (no external fonts/images), so it can never break a share preview.
 */
import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Selfmade — Find Winning Meta Ads & Launch in Minutes'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 84, background: '#0e1b12', color: '#fff', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', fontSize: 36, fontWeight: 800, letterSpacing: -1, color: '#dffe95' }}>Selfmade</div>
        <div style={{ display: 'flex', fontSize: 68, fontWeight: 800, lineHeight: 1.05, marginTop: 22, maxWidth: 940, letterSpacing: -2 }}>Find winning Meta ads &amp; launch in minutes</div>
        <div style={{ display: 'flex', fontSize: 30, color: 'rgba(255,255,255,.72)', marginTop: 30, maxWidth: 900 }}>Spy on 3M+ proven ads · remake or generate with AI · launch</div>
        <div style={{ display: 'flex', marginTop: 44, background: '#dffe95', color: '#0e1b12', fontSize: 26, fontWeight: 800, padding: '14px 30px', borderRadius: 100, alignSelf: 'flex-start' }}>tryselfmade.ai</div>
      </div>
    ),
    { ...size },
  )
}
