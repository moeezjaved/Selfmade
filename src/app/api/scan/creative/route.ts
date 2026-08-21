/**
 * POST /api/scan/creative — PUBLIC, capped image render for the anonymous audit payoff.
 *
 * The scan theater ends with a "here's the ad we'd make you" moment. This renders ONE preview image
 * from a brief (built client-side from the DNA gaps) using the shared Gemini image lib. It is
 * deliberately cheap-to-abuse-proof: a per-IP hourly cap AND a global daily budget cap, both
 * best-effort in-memory (no Redis in this stack). Never watermarks server-side — the UI overlays a
 * CSS "preview" mark. Any render failure returns a clean 503, never an unhandled 500, and only a
 * SUCCESSFUL render burns global budget.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { generateImage, geminiEnabled, geminiImageMime, type ImageInput } from '@/lib/gemini/image'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Best-effort in-memory IP limiter (no Redis in this stack). Per warm instance. Rendering costs real
// money, so this is tighter than scan/run: max 4 renders per IP per hour.
const HITS = new Map<string, { n: number; t: number }>()
const WINDOW = 3600_000, MAX_PER_IP = 4
function limited(ip: string): boolean {
  const now = Date.now(); const h = HITS.get(ip)
  if (!h || now - h.t > WINDOW) { HITS.set(ip, { n: 1, t: now }); return false }
  h.n++; return h.n > MAX_PER_IP
}

// Global daily budget guard — a hard ceiling on paid renders across ALL IPs, so a warm instance can
// never run away with spend. Counter resets when the UTC day string rolls over. Incremented ONLY on a
// successful render (failures must not burn budget).
const budget: { day: string; n: number } = { day: '', n: 0 }
function todayUTC(): string { return new Date().toISOString().slice(0, 10) }
function overDailyCap(): boolean {
  const day = todayUTC()
  if (budget.day !== day) { budget.day = day; budget.n = 0 }
  const cap = parseInt(process.env.SCAN_CREATIVE_DAILY_MAX || '300', 10)
  return budget.n >= (Number.isFinite(cap) ? cap : 300)
}
function noteSuccess(): void {
  const day = todayUTC()
  if (budget.day !== day) { budget.day = day; budget.n = 0 }
  budget.n++
}

type Brief = {
  key?: string; gapLabel?: string; headline?: string; hook?: string
  angle?: string; persona?: string; offer?: string; prompt?: string
}

// Best-effort: fetch the product image URL and turn it into a Gemini ImageInput (base64). Returns null
// on any failure (bad URL, timeout, non-image, oversized) so a missing reference never fails the render.
async function fetchProductImage(url: string): Promise<ImageInput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const rawMime = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 500 || buf.byteLength > 8_000_000) return null
    const mime = geminiImageMime(rawMime, buf.subarray(0, 64))
    if (!mime) return null
    return { mimeType: mime, dataB64: buf.toString('base64') }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon'
  if (limited(ip)) return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 })
  if (overDailyCap()) return NextResponse.json({ error: 'busy', retryAfter: 3600 }, { status: 429 })

  let body: { brief?: Brief; brandName?: string; niche?: string | null; productImageUrl?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const prompt = body?.brief?.prompt
  const brandName = body?.brandName
  if (!prompt || typeof prompt !== 'string' || !prompt.trim() || !brandName || typeof brandName !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  if (!geminiEnabled) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  try {
    // Optional product photo as a reference image (base64). Best-effort — skipped if it can't be fetched.
    const images: ImageInput[] = []
    if (body.productImageUrl && typeof body.productImageUrl === 'string') {
      const img = await fetchProductImage(body.productImageUrl)
      if (img) images.push(img)
    }

    const gen = await generateImage(prompt, images, 'default', { imageSize: '2K' })
    if (!gen.ok) return NextResponse.json({ error: 'render_failed' }, { status: 503 })

    const buf = Buffer.from(gen.dataB64, 'base64')
    const hash = crypto.createHash('sha1').update(prompt + '|' + brandName).digest('hex')
    const key = 'scan-previews/' + hash + '.png'
    const url = await uploadBufferToR2(buf, key, gen.mimeType || 'image/png') || r2PublicUrl(key)
    if (!url) return NextResponse.json({ error: 'render_failed' }, { status: 503 })

    noteSuccess()
    return NextResponse.json({ imageUrl: url, preview: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'render_failed' }, { status: 503 })
  }
}
