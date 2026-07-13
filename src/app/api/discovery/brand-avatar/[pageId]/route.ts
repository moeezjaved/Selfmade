/**
 * GET /api/discovery/brand-avatar/[pageId] — same-origin proxy for a brand's Facebook Page picture.
 *
 * The public Graph picture endpoint (graph.facebook.com/{id}/picture) 302-redirects to a hotlink-
 * protected fbcdn image the browser can't render directly, and weserv blocks facebook.com domains.
 * So we fetch it server-side (no referer → passes) and stream the bytes back, cached hard. On failure
 * we 404 so the client's letter-avatar fallback shows instead of a broken image.
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(_req: NextRequest, { params }: { params: { pageId: string } }) {
  const pid = (params.pageId || '').replace(/[^0-9]/g, '')
  if (!pid) return new NextResponse(null, { status: 404 })
  try {
    const res = await fetch(`https://graph.facebook.com/${V}/${pid}/picture?type=square&width=80&height=80`, { redirect: 'follow' })
    if (!res.ok) return new NextResponse(null, { status: 404 })
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return new NextResponse(null, { status: 404 })
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        // Cache 7 days at the browser + CDN; page pictures change rarely and only visible rows fetch.
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
