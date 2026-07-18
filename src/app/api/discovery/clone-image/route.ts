/**
 * AI ad clone — clone a winning ad's structure onto the user's product via Nano Banana Pro.
 *
 * ASYNC (2026-07-14): this POST is now an ENQUEUE, not a synchronous generate. It reserves credits,
 * inserts a creative_generations job row (status='processing'), kicks the actual generation off via
 * waitUntil() — which keeps running in the background AFTER the response is sent — and returns
 * { jobId } in ~1s. The client polls /api/discovery/clone-image/status. This is why the old flow
 * 504'd: a 2K Pro gen + QA retries held the user's request open past Vercel's limit, the function
 * got killed mid-flight, and the reserved credits were stranded (neither committed nor refunded).
 * Decoupling the generation from the request means the user NEVER sees a 504, and — because nothing
 * is racing a request timeout — the quality loop goes back to 3 tries (see MAX_GENS below).
 *
 * Backstops: reserve/commit/refund is per-job; a generation that still dies mid-flight (e.g. Google
 * outage > maxDuration) leaves the reservation 'reserved', which /api/cron/reconcile-reservations
 * refunds after 10 min.
 */
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, buildClonePrompt, geminiEnabled, nearestAspect, describeProduct, verifyClonedAd } from '@/lib/gemini/image'
import { uploadBufferToR2 } from '@/lib/r2'
import { sendFirstAdEmail } from '@/lib/email'
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // waitUntil generation runs up to this after the response is sent
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
    return await enqueue(req)
  } catch (e: any) {
    console.error('clone-image enqueue fatal:', e)
    return NextResponse.json({ error: `server error: ${String(e?.message || e)}` }, { status: 500 })
  }
}

async function enqueue(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })
  // Burst guard — images are free for subscribers, so cap scripted floods (fail-open).
  if (await isRateLimited(user.id)) return NextResponse.json({ error: 'rate_limited', message: 'Too many generations in a short time — please wait a moment and try again.' }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const { adId, refImageUrl, productImageB64, productImages } = body || {}
  const rawProducts: string[] = Array.isArray(productImages) && productImages.length
    ? productImages.filter((s: any) => typeof s === 'string' && s.trim())
    : (productImageB64 ? [String(productImageB64)] : [])
  if ((!adId && !refImageUrl) || rawProducts.length === 0) return NextResponse.json({ error: 'adId (or refImageUrl) and at least one product image required' }, { status: 400 })

  // Clone is Pro-only; resolution picks the price: 2K → image_clone_pro (15), 4K → image_clone_4k (25).
  const imageSize = body.imageSize === '4K' ? '4K' : '2K'
  const action = imageSize === '4K' ? 'image_clone_4k' : 'image_clone_pro'

  const admin = createAdminClient()

  // Reserve up front so insufficient-credits surfaces immediately (before we say "generating").
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id

  // Job row — status='processing', no image yet. The client polls this id; it also becomes the
  // final My Creatives row once done (same as the video clone's creative_generations lifecycle).
  const { data: job, error: jErr } = await admin.from('creative_generations').insert({
    user_id: user.id, brand_id: body.brandId || null, source_ad_id: adId ? String(adId) : null,
    type: 'clone', media_type: 'image', tier: 'pro', status: 'processing',
    clone_meta: { tx_id: txId, image_size: imageSize },
  }).select('id').single()
  if (jErr || !job) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not start the remake' }, { status: 500 })
  }
  const jobId = (job as any).id

  // Run the generation in the background of this invocation — returns to the user NOW.
  waitUntil(runGeneration({ jobId, userId: user.id, userEmail: user.email || null, body, txId, imageSize }))
  return NextResponse.json({ jobId, status: 'processing' })
}

/** The full clone generation — updates the job row to done/failed and commits/refunds credits. */
async function runGeneration(input: {
  jobId: string; userId: string; userEmail: string | null; body: any; txId: string | null; imageSize: string
}) {
  const { jobId, userId, userEmail, body, txId, imageSize } = input
  const admin = createAdminClient()
  const fail = async (msg: string) => {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    await admin.from('creative_generations').update({ status: 'failed', clone_meta: { tx_id: txId, error: msg } }).eq('id', jobId)
  }
  try {
    const { adId, refImageUrl, productImageB64, productImages, productMimeType, newHeadline, brandName, colors, brandId, aspectRatio, look } = body || {}
    const useTier: 'default' | 'pro' = 'pro'
    const rawProducts: string[] = Array.isArray(productImages) && productImages.length
      ? productImages.filter((s: any) => typeof s === 'string' && s.trim())
      : (productImageB64 ? [String(productImageB64)] : [])

    // ── Prep, fully parallelized ── the DB lookups (ad DNA + brand kit) run together, then every
    // image fetch (reference + logo + products) fires at once. Nothing here waits on anything it
    // doesn't need. This trims ~5-10s of dead time off the front of every clone — pure latency, the
    // generation quality is untouched. (Before: each of these awaited the previous one in sequence.)
    const adLookupP = (refImageUrl && !adId)
      ? Promise.resolve(null)
      : admin.from('discovery_ads_index')
          .select('hook_type, format_style, angle, emotion, cta, page_name, discovery_creatives(asset_type, r2_url, poster_url, position, width, height)')
          .eq('ad_id', String(adId)).maybeSingle().then((r: any) => r.data)
    const brandLookupP = brandId
      ? admin.from('brands').select('brand_kit').eq('id', String(brandId)).maybeSingle().then((r: any) => (r.data as any)?.brand_kit || {})
      : Promise.resolve<any>(null)
    // The user's REAL price (if they set one on the product) — used to replace the original ad's price
    // instead of letting the model invent one.
    const priceLookupP = brandId
      ? admin.from('brand_products').select('price').eq('brand_id', String(brandId)).not('price', 'is', null).limit(1).maybeSingle().then((r: any) => (r.data as any)?.price || null)
      : Promise.resolve<string | null>(null)
    const [adData, kit, productPrice] = await Promise.all([adLookupP, brandLookupP, priceLookupP])

    // Reference = a discovery ad (creative + classified DNA) OR an uploaded ASSET image URL.
    let ad: any = { hook_type: null, format_style: null, angle: null, emotion: null, cta: null, page_name: brandName || 'your creative' }
    let refCre: any = null
    let refUrl: string | null = null
    if (refImageUrl && !adId) {
      refUrl = String(refImageUrl)
    } else {
      if (!adData) return await fail('ad not found')
      ad = adData
      const cres = ((adData as any).discovery_creatives || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
      refCre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url))
      refUrl = refCre ? (refCre.asset_type === 'video' ? refCre.poster_url : refCre.r2_url) : null
      if (!refUrl) return await fail('reference ad has no image')
    }

    const isVideoSrc = refCre?.asset_type === 'video'
    const resolvedAspect = (!aspectRatio || aspectRatio === 'original')
      ? (nearestAspect(refCre?.width, refCre?.height) || (isVideoSrc ? '9:16' : 'original'))
      : aspectRatio

    let kitColors: string[] | undefined = Array.isArray(colors) ? colors.slice(0, 4) : undefined
    let kitFonts: any, kitPalette: any, logoUrl: string | null = null
    if (kit) {
      if (!kitColors?.length && Array.isArray(kit.colors)) kitColors = kit.colors.slice(0, 4)
      if (kit.fonts) kitFonts = kit.fonts
      if (kit.palette) kitPalette = kit.palette
      if (kit.logo) logoUrl = kit.logo
    }
    if (!kitPalette && body.palette && typeof body.palette === 'object') kitPalette = body.palette
    if (!logoUrl && typeof body.logo === 'string' && body.logo.trim()) logoUrl = body.logo.trim()

    // Fetch reference + logo + every product image concurrently (was sequential).
    const [refImg, logoImg, products] = await Promise.all([
      fetchImageB64(refUrl),
      logoUrl ? fetchImageB64(logoUrl) : Promise.resolve(null),
      Promise.all(rawProducts.slice(0, 4).map(async (src) => {
        const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
        if (m) return { mimeType: m[1] || productMimeType || 'image/png', dataB64: m[2] }
        if (/^https?:\/\//i.test(src)) return await fetchImageB64(src)
        return { mimeType: productMimeType || 'image/png', dataB64: src.replace(/^data:[^;]+;base64,/, '') }
      })).then((xs) => xs.filter(Boolean) as { mimeType: string; dataB64: string }[]),
    ])
    if (!refImg) return await fail('could not load reference image')
    if (products.length === 0) return await fail('could not load product image(s)')

    const productDesc = await describeProduct(products[0]).catch(() => null)
    const priceStr = productPrice ? (/^\s*[\$£€₨₹]|rs\.?/i.test(String(productPrice)) ? String(productPrice).trim() : `$${String(productPrice).trim()}`) : null
    const prompt = buildClonePrompt({
      brandName, colors: kitColors, newHeadline, aspectRatio: resolvedAspect, fonts: kitFonts, palette: kitPalette, hasLogo: !!logoImg,
      productDesc: productDesc || undefined, productPrice: priceStr, look: typeof look === 'string' ? look : undefined,
      dna: { hook_type: ad.hook_type, format_style: ad.format_style, angle: ad.angle, emotion: ad.emotion, cta: ad.cta },
    })
    const genImages = logoImg ? [refImg, ...products, logoImg] : [refImg, ...products]

    // Generate → verify → retry. MAX_GENS back to 3 (was cut to 2 only to survive the sync request
    // timeout): now the generation runs off the request path, so we can be uncompromising on quality
    // — three QA rounds, best attempt ships. Verifier fails OPEN on API errors.
    const MAX_GENS = 3
    let gen: Awaited<ReturnType<typeof generateImage>> | null = null
    let best: { mimeType: string; dataB64: string } | null = null
    const verdictLog: string[] = []
    for (let i = 0; i < MAX_GENS; i++) {
      const attemptPrompt = i === 0 ? prompt : `${prompt} IMPORTANT CORRECTION: ${verdictLog[verdictLog.length - 1]}`
      gen = await generateImage(attemptPrompt, genImages, useTier, { aspectRatio: resolvedAspect, imageSize })
      if (!gen.ok) break
      best = { mimeType: gen.mimeType, dataB64: gen.dataB64 }
      const v = await verifyClonedAd(best, products[0], brandName)
      if (v.pass) { verdictLog.push('pass'); break }
      const fix = v.fix || [
        !v.productMatches && 'Render the product exactly as shown in its photo — same shape, container type, label and colors.',
        !v.brandingClean && `Every logo and brand name shown must belong to ${brandName ? `"${brandName}"` : "the user's brand"} only.`,
        !v.textClean && 'Fix all text: correct spelling, no repeated words or duplicated text blocks.',
      ].filter(Boolean).join(' ')
      verdictLog.push(fix)
    }
    // Pro model congested (never downgraded) → a clear, retryable message; credits refund in fail().
    if (!best) {
      const raw = (gen && !gen.ok && gen.error) || 'generation failed'
      return await fail(raw === 'pro_model_busy' ? 'The Pro image model is busy right now — please try again in a minute. You weren’t charged.' : raw)
    }

    // Upload to R2 and finalize the SAME job row (no second insert).
    const buf = Buffer.from(best.dataB64, 'base64')
    const ext = best.mimeType.includes('png') ? 'png' : best.mimeType.includes('webp') ? 'webp' : 'jpg'
    const url = await uploadBufferToR2(buf, `creatives/${userId}/${jobId}.${ext}`, best.mimeType || 'image/png')
    if (!url) return await fail('could not save the generated image (storage)')

    if (txId) await admin.rpc('commit_credits', { p_tx: txId }).then(() => {}, () => {})
    await admin.from('creative_generations').update({
      status: 'done', image_url: url,
      prompt: newHeadline || null,
      clone_meta: { tx_id: txId, image_size: imageSize },
    }).eq('id', jobId)

    if (userEmail) await sendFirstAdEmail(userId, userEmail, url).catch(() => {})
  } catch (e: any) {
    await fail(String(e?.message || e))
  }
}
