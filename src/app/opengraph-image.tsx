/**
 * Dynamic 1200×630 OG/Twitter card for the landing. Next auto-wires og:image + twitter:image from
 * this file, so a shared link (LinkedIn, X, Slack, iMessage) renders a branded preview. Self-contained
 * (no external fonts/images) so it can never break a share preview — the editorial voice is carried by
 * hierarchy and the single lime rule, mirroring the landing (cream ground, forest ink, one accent).
 */
import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Selfmade — The Marketing Co-founder'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 76, background: '#faf9f4', color: '#171d18', fontFamily: 'Georgia, serif', position: 'relative' }}>
        {/* lime rule — the one accent, top edge */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: '#ff5a2c' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'sans-serif' }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, letterSpacing: -1, color: '#171d18' }}>Selfmade</div>
          <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color: '#8a927f' }}>Introducing Mello</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 96, fontWeight: 500, lineHeight: 0.98, letterSpacing: -3, maxWidth: 1000 }}>The Marketing Co&#8209;founder.</div>
          <div style={{ display: 'flex', fontSize: 29, lineHeight: 1.4, color: '#4c5347', marginTop: 30, maxWidth: 920, fontFamily: 'sans-serif', fontWeight: 500 }}>Mello studies your market all night — then walks in every morning with the work, already done.</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'sans-serif' }}>
          <div style={{ display: 'flex', background: '#ef4a1e', color: '#fff', fontSize: 24, fontWeight: 800, padding: '14px 30px', borderRadius: 100 }}>tryselfmade.ai</div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, color: '#8a927f' }}>$49/mo · starts tonight</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
