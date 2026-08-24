/**
 * GET /api/ads-studio/media?u=<fbcdn-url> — permanent R2 cache for live competitor-ad media.
 * Meta's fbcdn URLs are referrer-gated and expire, and we must NOT hotlink them. So the first time an
 * ad image is requested we pull it into R2 (our existing media store) and thereafter redirect to the
 * permanent R2 copy — same pattern the crawler uses for corpus creatives. Falls back to the original
 * URL only if R2 isn't configured or the fetch fails.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { uploadBufferToR2, r2PublicUrl, headObjectSize, isR2Configured } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const extOf = (url: string, ct: string) => {
  if (/\.(png|webp|gif|mp4)(\?|$)/i.test(url)) return url.match(/\.(png|webp|gif|mp4)/i)![1].toLowerCase()
  if (ct.includes('png')) return 'png'; if (ct.includes('webp')) return 'webp'; if (ct.includes('gif')) return 'gif'
  return 'jpg'
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('u') || ''
  if (!/^https?:\/\//i.test(u)) return NextResponse.json({ error: 'u (url) required' }, { status: 400 })
  const redirectTo = (dest: string) => { const r = NextResponse.redirect(dest, 302); r.headers.set('Cache-Control', 'public, max-age=86400'); return r }

  const hash = createHash('sha1').update(u).digest('hex')
  try {
    if (isR2Configured()) {
      // Guess the key (ext from the URL); if already stored, redirect straight to R2.
      const guessKey = `live-ads/${hash}.${extOf(u, '')}`
      const size = await headObjectSize(guessKey).catch(() => null)
      if (size && size > 0) { const pub = r2PublicUrl(guessKey); if (pub) return redirectTo(pub) }

      // Not cached yet — fetch the fbcdn bytes server-side (no referrer gating) and store in R2.
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*' }, signal: AbortSignal.timeout(15000) })
      if (res.ok) {
        const ct = res.headers.get('content-type') || 'image/jpeg'
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 0) {
          const key = `live-ads/${hash}.${extOf(u, ct)}`
          const pub = await uploadBufferToR2(buf, key, ct)
          if (pub) return redirectTo(pub)
          // R2 upload failed — stream the bytes we already have.
          return new NextResponse(buf, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } })
        }
      }
    }
  } catch { /* fall through to original */ }
  return redirectTo(u)
}
