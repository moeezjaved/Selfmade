/**
 * AI ad clone — clone a winning ad's structure onto the user's product via Nano Banana.
 * POST { adId, productImageB64, productMimeType?, tier?:'default'|'pro', newHeadline?, brandName?, colors? }
 *   → reserve credits → fetch the ad's creative + classified DNA → build the clone prompt →
 *     Gemini generateImage([reference ad, product]) → commit (or refund on failure) → return { image }.
 * The generated image is returned as a data URL for the user to preview/tweak/download.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, buildClonePrompt, geminiEnabled, nearestAspect, describeProduct, verifyClonedAd } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'
import { sendFirstAdEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // gemini-3-pro-image at 2K can exceed 60s → 504; Pro plan allows up to 300s
export const runtime = 'nodejs'

async function fetchImageB64(url: string): Promise<{ mimeType: string; dataB64: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return { mimeType: r.headers.get('content-type') || 'image/jpeg', dataB64: buf.toString('base64') }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req)
  } catch (e: any) {
    // Last-resort guard so an uncaught throw returns a readable message (not an empty 500).
    console.error('clone-image fatal:', e)
    return NextResponse.json({ error: `server error: ${String(e?.message || e)}` }, { status: 500 })
  }
}

async function handle(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const { adId, refImageUrl, productImageB64, productImages, productMimeType, tier, newHeadline, brandName, colors, brandId, aspectRatio } = body || {}
  // Accept one legacy base64 photo OR an array of product photos (data: URLs and/or http URLs).
  // Multiple angles help Nano Banana hold the product's exact shape/label across the clone.
  const rawProducts: string[] = Array.isArray(productImages) && productImages.length
    ? productImages.filter((s: any) => typeof s === 'string' && s.trim())
    : (productImageB64 ? [String(productImageB64)] : [])
  if ((!adId && !refImageUrl) || rawProducts.length === 0) return NextResponse.json({ error: 'adId (or refImageUrl) and at least one product image required' }, { status: 400 })
  // Clone is Pro-only now; resolution picks the price: 2K → image_clone_pro (15), 4K → image_clone_4k (25).
  const useTier: 'default' | 'pro' = 'pro'
  const imageSize = body.imageSize === '4K' ? '4K' : '2K'
  const action = imageSize === '4K' ? 'image_clone_4k' : 'image_clone_pro'

  const admin = createAdminClient()

  // Reserve credits (throws insufficient_credits inside the RPC → surfaced as an error).
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id
  const refund = async () => { if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {}) }

  try {
    // Reference = a discovery ad (creative + classified DNA by adId) OR an uploaded ASSET image URL.
    let ad: any = { hook_type: null, format_style: null, angle: null, emotion: null, cta: null, page_name: brandName || 'your creative' }
    let refCre: any = null
    let refUrl: string | null = null
    if (refImageUrl && !adId) {
      refUrl = String(refImageUrl)   // clone from an uploaded asset — no DNA; the image itself is the layout
    } else {
      const { data } = await admin
        .from('discovery_ads_index')
        .select('hook_type, format_style, angle, emotion, cta, page_name, discovery_creatives(asset_type, r2_url, poster_url, position, width, height)')
        .eq('ad_id', String(adId))
        .maybeSingle()
      if (!data) { await refund(); return NextResponse.json({ error: 'ad not found' }, { status: 404 }) }
      ad = data
      const cres = ((data as any).discovery_creatives || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
      refCre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url))
      refUrl = refCre ? (refCre.asset_type === 'video' ? refCre.poster_url : refCre.r2_url) : null
      if (!refUrl) { await refund(); return NextResponse.json({ error: 'reference ad has no image' }, { status: 422 }) }
    }
    const refImg = await fetchImageB64(refUrl)
    if (!refImg) { await refund(); return NextResponse.json({ error: 'could not load reference image' }, { status: 502 }) }
    // "Original" → match the reference ad's real shape (nearest supported ratio); else use the picked ratio.
    // Video creatives have null width/height (dims aren't captured), so nearestAspect returns nothing —
    // fall back to 9:16 (reels/stories are vertical, the common video-clone case) so "Original" isn't a
    // wrong default square. A concrete ratio is required: Gemini ignores "keep aspect of image 1".
    const isVideoSrc = refCre?.asset_type === 'video'
    const resolvedAspect = (!aspectRatio || aspectRatio === 'original')
      ? (nearestAspect(refCre?.width, refCre?.height) || (isVideoSrc ? '9:16' : 'original'))
      : aspectRatio

    // Pull the saved brand's kit (colors + fonts) so every ad stays on-brand, even if the caller
    // didn't pass colors explicitly.
    let kitColors: string[] | undefined = Array.isArray(colors) ? colors.slice(0, 4) : undefined
    let kitFonts: any
    let kitPalette: any
    let logoUrl: string | null = null
    if (brandId) {
      const { data: brand } = await admin.from('brands').select('brand_kit').eq('id', String(brandId)).maybeSingle()
      const kit = (brand as any)?.brand_kit || {}
      if (!kitColors?.length && Array.isArray(kit.colors)) kitColors = kit.colors.slice(0, 4)
      if (kit.fonts) kitFonts = kit.fonts
      if (kit.palette) kitPalette = kit.palette
      if (kit.logo) logoUrl = kit.logo
    }
    // Allow a palette/logo passed directly (new-brand flow before it's saved).
    if (!kitPalette && body.palette && typeof body.palette === 'object') kitPalette = body.palette
    if (!logoUrl && typeof body.logo === 'string' && body.logo.trim()) logoUrl = body.logo.trim()
    const logoImg = logoUrl ? await fetchImageB64(logoUrl) : null

    // Normalize each product photo to base64. data: URLs are decoded inline; http(s) URLs are fetched.
    // Cap at 4 so the payload stays within Gemini's part limit alongside the reference ad.
    const products = (await Promise.all(rawProducts.slice(0, 4).map(async (src) => {
      const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
      if (m) return { mimeType: m[1] || productMimeType || 'image/png', dataB64: m[2] }
      if (/^https?:\/\//i.test(src)) return await fetchImageB64(src)
      return { mimeType: productMimeType || 'image/png', dataB64: src.replace(/^data:[^;]+;base64,/, '') }
    }))).filter(Boolean) as { mimeType: string; dataB64: string }[]
    if (products.length === 0) { await refund(); return NextResponse.json({ error: 'could not load product image(s)' }, { status: 502 }) }

    // Ground the prompt in WHAT the product is ("pesto sauce in a glass jar") — a cheap Flash
    // vision call. This is the detail the proven-good human prompt had; it drives correct scene,
    // copy, and shape adaptation. Best-effort: null just means the prompt omits it.
    const productDesc = await describeProduct(products[0]).catch(() => null)

    const prompt = buildClonePrompt({
      brandName, colors: kitColors, newHeadline, aspectRatio: resolvedAspect, fonts: kitFonts, palette: kitPalette, hasLogo: !!logoImg,
      productDesc: productDesc || undefined,
      dna: { hook_type: (ad as any).hook_type, format_style: (ad as any).format_style, angle: (ad as any).angle, emotion: (ad as any).emotion, cta: (ad as any).cta },
    })
    console.log(`clone-image [${useTier}] prompt:`, prompt)   // proof the prompt is sent each generation

    // Order matters: [reference ad, ...product photos, logo?] — the prompt references the FINAL image as the logo.
    const genImages = logoImg ? [refImg, ...products, logoImg] : [refImg, ...products]

    // Generate → verify → retry. The verifier (cheap Flash text call) checks product identity,
    // branding, and text; a failed check regenerates with ONE targeted correction appended (never
    // a new standing prompt rule). Up to 2 retries, then the best attempt ships — QA never turns
    // a paid generation into an error. Verifier fails OPEN on API errors.
    const MAX_GENS = 3
    let gen: Awaited<ReturnType<typeof generateImage>> | null = null
    let best: { mimeType: string; dataB64: string } | null = null
    let verdictLog: string[] = []
    for (let i = 0; i < MAX_GENS; i++) {
      const attemptPrompt = i === 0 ? prompt : `${prompt} IMPORTANT CORRECTION: ${verdictLog[verdictLog.length - 1]}`
      gen = await generateImage(attemptPrompt, genImages, useTier, { aspectRatio: resolvedAspect, imageSize })
      if (!gen.ok) break                       // API failure → surfaced below (refund if no earlier good attempt)
      best = { mimeType: gen.mimeType, dataB64: gen.dataB64 }
      const v = await verifyClonedAd(best, products[0], brandName)
      if (v.pass) { verdictLog.push('pass'); break }
      const fix = v.fix || [
        !v.productMatches && 'Render the product exactly as shown in its photo — same shape, container type, label and colors.',
        !v.brandingClean && `Every logo and brand name shown must belong to ${brandName ? `"${brandName}"` : "the user's brand"} only.`,
        !v.textClean && 'Fix all text: correct spelling, no repeated words or duplicated text blocks.',
      ].filter(Boolean).join(' ')
      verdictLog.push(fix)
      console.log(`clone-image verify attempt ${i + 1} failed:`, JSON.stringify(v))
    }
    if (!best) { await refund(); return NextResponse.json({ error: (gen && !gen.ok && gen.error) || 'generation failed' }, { status: 502 }) }
    gen = { ok: true, ...best }

    if (txId) await admin.rpc('commit_credits', { p_tx: txId }).then(() => {}, () => {})

    // Persist to "My Creatives" (best-effort — the user still gets the inline image if R2 is off).
    const saved = await saveGeneration({
      userId: user.id, dataB64: gen.dataB64, mimeType: gen.mimeType, type: 'clone', tier: useTier,
      brandId: brandId || null, sourceAdId: adId ? String(adId) : null, prompt: newHeadline || null,
    })

    // First-ad lifecycle email (once; claim-once guard inside). Best-effort — never fail the clone.
    if (user.email) await sendFirstAdEmail(user.id, user.email, saved?.url || undefined).catch(() => {})

    return NextResponse.json({ image: `data:${gen.mimeType};base64,${gen.dataB64}`, url: saved?.url || null, generationId: saved?.id || null, tier: useTier })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
