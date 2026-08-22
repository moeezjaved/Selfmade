/**
 * POST /api/scan/creative — PUBLIC, capped, STUDIO-QUALITY image render for the anonymous audit payoff.
 *
 * The scan theater ends with "here's the ad we'd make you". This renders ONE preview using the SAME Pro
 * pipeline the logged-in Studio uses (src/app/api/discovery/generate-ad) — only importing shared libs, so
 * no studio endpoint is touched:
 *   • the brand's OWN best crawled ad image as the product reference (anonymous users have no upload)
 *   • niche inspirations (pickInspirations) for the aesthetic bar + industry insights (getNicheInsights)
 *   • buildStudioPrompt(...) + generateImage(..., 'pro', { imageSize:'2K' })  ← gemini-3-pro-image
 *
 * Pro costs real money and this is public/no-login, so it's guarded by a tight per-IP hourly cap AND a
 * global daily budget cap (both best-effort in-memory). Never watermarks server-side (the UI overlays a
 * CSS "preview" mark). Any failure returns a clean 503, never an unhandled 500; only a SUCCESSFUL render
 * burns global budget.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { generateImage, buildStudioPrompt, geminiEnabled, geminiImageMime, type ImageInput } from '@/lib/gemini/image'
import { getNicheInsights } from '@/lib/studio/insights'
import { pickInspirations } from '@/lib/studio/inspiration'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Best-effort in-memory IP limiter (no Redis in this stack). Per warm instance. Pro rendering costs real
// money, so this is tight: max 4 renders per IP per hour.
const HITS = new Map<string, { n: number; t: number }>()
const WINDOW = 3600_000, MAX_PER_IP = 4
function limited(ip: string): boolean {
  const now = Date.now(); const h = HITS.get(ip)
  if (!h || now - h.t > WINDOW) { HITS.set(ip, { n: 1, t: now }); return false }
  h.n++; return h.n > MAX_PER_IP
}

// Global daily budget guard — a hard ceiling on paid Pro renders across ALL IPs. Resets on UTC day roll.
// Incremented ONLY on a successful render. Default 150/day (Pro is pricier than flash) — env-tunable.
const budget: { day: string; n: number } = { day: '', n: 0 }
function todayUTC(): string { return new Date().toISOString().slice(0, 10) }
function overDailyCap(): boolean {
  const day = todayUTC()
  if (budget.day !== day) { budget.day = day; budget.n = 0 }
  const cap = parseInt(process.env.SCAN_CREATIVE_DAILY_MAX || '150', 10)
  return budget.n >= (Number.isFinite(cap) ? cap : 150)
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

// Fetch an image URL → Gemini ImageInput (base64). Null on any failure (bad URL, timeout, non-image,
// oversized) so a missing reference never fails the render.
async function fetchImageB64(url: string): Promise<ImageInput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 500 || buf.byteLength > 8_000_000) return null
    const mime = geminiImageMime(res.headers.get('content-type') || '', buf.subarray(0, 64))
    if (!mime) return null
    return { mimeType: mime, dataB64: buf.toString('base64') }
  } catch { return null }
}

// The brand's best crawled ad image (highest performer, full-res), to stand in for an uploaded product
// photo. Anonymous users can't upload, but we already crawled their ads — so the generated ad features
// their real product/brand.
async function brandProductImage(admin: ReturnType<typeof createAdminClient>, pageId: string): Promise<ImageInput | null> {
  const { data } = await admin.from('discovery_ads_index')
    .select('raw_image_urls, thumbnail_url, snapshot_url')
    .eq('page_id', pageId).eq('has_creative', true)
    .order('performance_score', { ascending: false, nullsFirst: false }).limit(8)
  for (const r of (data || []) as { raw_image_urls?: string[] | null; thumbnail_url?: string | null; snapshot_url?: string | null }[]) {
    const url = (Array.isArray(r.raw_image_urls) && r.raw_image_urls[0]) || r.thumbnail_url || r.snapshot_url
    if (!url) continue
    const img = await fetchImageB64(String(url))
    if (img) return img
  }
  return null
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon'
  if (limited(ip)) return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 })
  if (overDailyCap()) return NextResponse.json({ error: 'busy', retryAfter: 3600 }, { status: 429 })

  let body: { brief?: Brief; brandName?: string; niche?: string | null; pageId?: string; productImageUrl?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const brief = body?.brief || {}
  const brandName = body?.brandName
  // The brief's `headline`/`hook` are META (a prescription TITLE like "Testimonial-Driven Ad" and a hook
  // TYPE like "Testimonial") — never stamp those as the on-image headline. The real message is the offer;
  // we hand that to the model as direction and let the Studio pipeline write the actual headline copy.
  const offer = (brief.offer || '').trim()
  const persona = (brief.persona || '').trim()
  if (!brandName || typeof brandName !== 'string' || (!offer && !brief.hook && !brief.prompt)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!geminiEnabled) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  try {
    const admin = createAdminClient()
    const niche = (body.niche && String(body.niche).trim()) || null
    const ASPECT = '4:5'

    // 1) the brand's product reference — their own best ad, else a passed url, else none (service branch)
    let product: ImageInput | null = null
    if (body.pageId && /^\d{5,}$/.test(String(body.pageId))) product = await brandProductImage(admin, String(body.pageId))
    if (!product && body.productImageUrl) product = await fetchImageB64(String(body.productImageUrl))

    // 2) niche inspirations (aesthetic bar) + industry insights ("what wins here") — best-effort
    let inspImgs: ImageInput[] = []
    const styleTags: string[] = []
    try {
      const insp = await pickInspirations(admin, { niche, aspect: ASPECT, limit: 3 })
      const fetched = await Promise.all((insp || []).map((r: any) => r?.r2_url ? fetchImageB64(String(r.r2_url)) : Promise.resolve(null)))
      inspImgs = fetched.filter((x): x is ImageInput => !!x)
      for (const r of (insp || [])) for (const t of ((r as any)?.style_tags || [])) if (typeof t === 'string') styleTags.push(t)
    } catch { /* inspirations optional */ }

    let insights: { topHooks?: string[]; topAngles?: string[]; topFormats?: string[]; topEmotions?: string[]; topCtas?: string[] } | undefined
    try {
      const ni = await getNicheInsights(admin, niche)
      if (ni) insights = { topHooks: ni.topHooks, topAngles: ni.topAngles, topFormats: ni.topFormats, topEmotions: ni.topEmotions, topCtas: ni.topCtas }
    } catch { /* insights optional */ }

    // 3) the Studio Pro prompt + call. We DON'T pass newHeadline — the pipeline writes the headline copy
    // itself (it's good at it); we steer it with the offer/persona/angle so the headline fits the fix.
    let prompt = buildStudioPrompt({
      brandName, aspectRatio: ASPECT, hasLogo: false,
      numInspirations: inspImgs.length, numProducts: product ? 1 : 0,
      styleTags: styleTags.slice(0, 8), insights, angle: brief.angle || undefined, isService: !product,
    }) || brief.prompt || `${brandName} ad.`
    if (offer) prompt += ` Write a short, punchy headline that lands this message: "${offer}"${persona ? `, speaking to ${persona}` : ''}. Do not write the words "ad", "testimonial", "pain point" or the ad type as the headline — write real marketing copy a shopper would see.`
    // Composition guard: the product REFERENCE here is the brand's own crawled AD (not a clean cutout), so
    // the model tends to over-scale/crop the product. Steer it to a natural portrait ad layout with room
    // for the copy — keeps the whole creative visible (no head-cropping) and the product life-sized.
    prompt += ' Compose as a portrait ad with clear headroom at the top for the headline and space at the bottom for the call-to-action. Show the product at a natural, moderate size — centered in the frame, fully visible, neither oversized nor cropped at any edge.'
    // order MUST be [inspirations…, product?] to match the prompt's image-index math
    const genImages: ImageInput[] = [...inspImgs, ...(product ? [product] : [])]

    let gen = await generateImage(prompt, genImages, 'pro', { aspectRatio: ASPECT, imageSize: '2K' })
    // Pro model congested → one flash-tier fallback so the visitor still gets a preview.
    if (!gen.ok) gen = await generateImage(prompt, genImages, 'default', { aspectRatio: ASPECT })
    if (!gen.ok) return NextResponse.json({ error: 'render_failed' }, { status: 503 })

    const buf = Buffer.from(gen.dataB64, 'base64')
    const hash = crypto.createHash('sha1').update(`${brandName}|${offer}|${brief.gapLabel || ''}|${brief.angle || ''}|v2`).digest('hex')
    const key = 'scan-previews/' + hash + '.png'
    const url = await uploadBufferToR2(buf, key, gen.mimeType || 'image/png') || r2PublicUrl(key)
    if (!url) return NextResponse.json({ error: 'render_failed' }, { status: 503 })

    noteSuccess()
    return NextResponse.json({ imageUrl: url, preview: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'render_failed' }, { status: 503 })
  }
}
