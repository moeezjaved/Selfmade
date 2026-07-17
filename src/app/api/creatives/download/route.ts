/**
 * Same-origin download proxy for finished creatives (and source ads).
 *
 * Why this exists: generated videos/images live on a cross-origin R2 domain (pub-*.r2.dev) that sends
 * no CORS headers, and the HTML `download` attribute is ignored for cross-origin links — so the old
 * client-side `fetch(r2url).blob()` download silently failed and the browser just navigated to (played)
 * the raw file. Streaming the bytes back through our own origin with `Content-Disposition: attachment`
 * makes it a real "Save as…" download with the right filename, in every browser, no new tab.
 *
 * SSRF guard: only ever proxies known PUBLIC media hosts (our R2 + Meta's fbcdn + our CDN). It is never
 * a general-purpose proxy.
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOW_SUFFIX = ['.r2.dev', '.r2.cloudflarestorage.com', '.fbcdn.net', '.cdninstagram.com', '.tryselfmade.ai']
const ALLOW_EXACT = ['cdn.tryselfmade.ai']

const allowed = (host: string) => ALLOW_EXACT.includes(host) || ALLOW_SUFFIX.some((s) => host.endsWith(s))

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  // Sanitize the download filename (header-injection + path safety); keep it human-readable.
  const name = (req.nextUrl.searchParams.get('name') || 'selfmade-ad').replace(/[^\w.\- ]+/g, '_').slice(0, 120).trim() || 'selfmade-ad'
  if (!raw) return new NextResponse('missing url', { status: 400 })

  let u: URL
  try { u = new URL(raw) } catch { return new NextResponse('bad url', { status: 400 }) }
  if (u.protocol !== 'https:' || !allowed(u.hostname)) return new NextResponse('forbidden host', { status: 403 })

  let upstream: Response
  try { upstream = await fetch(u.toString(), { redirect: 'follow' }) }
  catch { return new NextResponse('fetch failed', { status: 502 }) }
  if (!upstream.ok || !upstream.body) return new NextResponse('upstream error', { status: 502 })

  const h = new Headers()
  h.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
  const len = upstream.headers.get('content-length'); if (len) h.set('Content-Length', len)
  h.set('Content-Disposition', `attachment; filename="${name}"`)
  h.set('Cache-Control', 'private, no-store')
  return new NextResponse(upstream.body, { status: 200, headers: h })
}
