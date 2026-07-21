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
    // Protocol-relative URLs (//host/path, common in Shopify image fields) have no scheme — fetch
    // needs one, so add https: before requesting.
    if (/^\/\/[^/]/.test(url)) url = `https:${url}`
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
  const body = await req.json().catch(() => ({}))
  // Actor resolution: normal callers use their session. The Daily Ad Autopilot worker calls this
  // server-to-server with a shared secret + the user it's generating for, so it reuses the EXACT
  // clone generation + billing path (nothing about the generation changes). Auth boundary only.
  const autopilotSecret = req.headers.get('x-autopilot-secret')
  const isAutopilot = !!autopilotSecret && !!process.env.AUTOPILOT_SECRET && autopilotSecret === process.env.AUTOPILOT_SECRET
  let actorId: string, actorEmail: string | null = null
  if (isAutopilot) {
    if (typeof body.asUserId !== 'string' || !body.asUserId) return NextResponse.json({ error: 'asUserId required' }, { status: 400 })
    actorId = body.asUserId
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    actorId = user.id; actorEmail = user.email || null
  }
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })
  // Burst guard — cap scripted floods (fail-open). Autopilot is server-paced, so it's exempt.
  if (!isAutopilot && await isRateLimited(actorId)) return NextResponse.json({ error: 'rate_limited', message: 'Too many generations in a short time — please wait a moment and try again.' }, { status: 429 })

  const { adId, refImageUrl, productImageB64, productImages } = body || {}
  const isService = body?.productType === 'service'   // service/app brand → no physical product; photos optional
  const rawProducts: string[] = Array.isArray(productImages) && productImages.length
    ? productImages.filter((s: any) => typeof s === 'string' && s.trim())
    : (productImageB64 ? [String(productImageB64)] : [])
  // Physical clones need a product photo; service clones don't (they show logo/screenshots/people).
  if ((!adId && !refImageUrl) || (rawProducts.length === 0 && !isService)) return NextResponse.json({ error: 'adId (or refImageUrl) and at least one product image required' }, { status: 400 })

  // Clone is Pro-only; resolution picks the price: 2K → image_clone_pro (15), 4K → image_clone_4k (25).
  const imageSize = body.imageSize === '4K' ? '4K' : '2K'
  const action = imageSize === '4K' ? 'image_clone_4k' : 'image_clone_pro'

  const admin = createAdminClient()

  // Reserve up front so insufficient-credits surfaces immediately (before we say "generating").
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: actorId, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id

  // Job row — status='processing', no image yet. The client polls this id; it also becomes the
  // final My Creatives row once done (same as the video clone's creative_generations lifecycle).
  const { data: job, error: jErr } = await admin.from('creative_generations').insert({
    user_id: actorId, brand_id: body.brandId || null, source_ad_id: adId ? String(adId) : null,
    type: 'clone', media_type: 'image', tier: 'pro', status: 'processing',
    clone_meta: { tx_id: txId, image_size: imageSize, ...(isAutopilot ? { autopilot: true } : {}) },
  }).select('id').single()
  if (jErr || !job) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not start the remake' }, { status: 500 })
  }
  const jobId = (job as any).id

  // Run the generation in the background of this invocation — returns to the user NOW.
  waitUntil(runGeneration({ jobId, userId: actorId, userEmail: actorEmail, body, txId, imageSize }))
  return NextResponse.json({ jobId, status: 'processing' })
}

/** The full clone generation — updates the job row to done/failed and commits/refunds credits. */
async function runGeneration(input: {
  jobId: string; userId: string; userEmail: string | null; body: any; txId: string | null; imageSize: string
}) {
  const { jobId, userId, userEmail, body, txId, imageSize } = input
  const admin = createAdminClient()
  const fail = async (msg: string, reason?: string) => {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    await admin.from('creative_generations').update({ status: 'failed', clone_meta: { tx_id: txId, error: msg, ...(reason ? { fail_reason: reason } : {}) } }).eq('id', jobId)
  }
  try {
    const { adId, refImageUrl, productImageB64, productImages, productMimeType, newHeadline, brandName, colors, brandId, aspectRatio, look } = body || {}
    // Recast (change the person's ethnicity/look) is the ONE case where the STANDARD model beats Pro:
    // gemini-3-pro-image locks the reference face and refuses the recast — a regression introduced when
    // clone became Pro-only + never-downgrade (23477b8). Before that, Pro 503s silently downgraded to
    // the standard Nano Banana, which reshoots the person reliably (that's why recasts worked on 16 Jul
    // and stopped after). So route recast jobs to the standard model; keep Pro for everything else. The
    // user is still billed at Pro (the row is stamped 'pro') — only the render model differs.
    const wantsRecast = typeof look === 'string' && !!look.trim() && look.toLowerCase() !== 'match'
    // TEST (2026-07-21): recasts run on Pro WITH the strengthened 'fully replace the person' prompt to
    // see if Pro will now comply. If it still refuses, flip this back to `wantsRecast ? 'default' : 'pro'`.
    void wantsRecast
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
      ? admin.from('brands').select('brand_kit, description, usps, industry, target_audience, website').eq('id', String(brandId)).maybeSingle().then((r: any) => r.data || {})
      : Promise.resolve<any>(null)
    // The user's REAL price (if they set one on the product) — used to replace the original ad's price
    // instead of letting the model invent one.
    const priceLookupP = brandId
      ? admin.from('brand_products').select('price').eq('brand_id', String(brandId)).not('price', 'is', null).limit(1).maybeSingle().then((r: any) => (r.data as any)?.price || null)
      : Promise.resolve<string | null>(null)
    const [adData, brandRow, productPrice] = await Promise.all([adLookupP, brandLookupP, priceLookupP])
    const kit = (brandRow as any)?.brand_kit || (brandRow ? {} : null)

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
        // Protocol-relative URLs (Shopify stores photos as //host/path with no scheme) must be
        // fetched, not treated as base64 — prepend https: so they pass the http check below.
        const url = /^\/\/[^/]/.test(src) ? `https:${src}` : src
        if (/^https?:\/\//i.test(url)) return await fetchImageB64(url)
        // A bare token that's neither a data-URL nor http(s): only accept it if it actually looks
        // like base64 — never forward a raw URL/path string as inline_data (Gemini 400s on decode).
        return /^[A-Za-z0-9+/=\s]+$/.test(src) && src.length > 100
          ? { mimeType: productMimeType || 'image/png', dataB64: src.replace(/\s/g, '') }
          : null
      })).then((xs) => xs.filter(Boolean) as { mimeType: string; dataB64: string }[]),
    ])
    if (!refImg) return await fail('could not load reference image')
    const isService = body?.productType === 'service'   // no physical product to render
    if (products.length === 0 && !isService) return await fail('could not load product image(s)')

    // Service brands have no product to describe; physical brands ground the scene/copy on it.
    let productDesc = (!isService && products[0]) ? await describeProduct(products[0]).catch(() => null) : null
    // SERVICE grounding — without this the model guesses what the brand does from its NAME alone
    // (e.g. "Selfmade" → invented self-improvement copy for an AI-ads platform). Source of truth:
    // the user-written brand description/USPs first, the website's own meta description as fallback.
    if (isService) {
      const parts = [
        (brandRow as any)?.description && String((brandRow as any).description).trim(),
        Array.isArray((brandRow as any)?.usps) && (brandRow as any).usps.length ? `Key selling points: ${(brandRow as any).usps.slice(0, 4).join(', ')}` : null,
        Array.isArray((brandRow as any)?.industry) && (brandRow as any).industry.length ? `Industry: ${(brandRow as any).industry.slice(0, 3).join(', ')}` : null,
        (brandRow as any)?.target_audience ? `Audience: ${String((brandRow as any).target_audience).trim()}` : null,
      ].filter(Boolean) as string[]
      if (!parts.length && (brandRow as any)?.website) {
        // Best-effort: the site's own og/meta description says what the service actually is.
        try {
          let site = String((brandRow as any).website).trim()
          if (!/^https?:\/\//i.test(site)) site = `https://${site}`
          const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000)
          const html = (await (await fetch(site, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SelfmadeBot/1.0)' } })).text()).slice(0, 300_000)
          clearTimeout(t)
          const metaDesc = html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i)?.[1]
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:description["']|name=["']description["'])/i)?.[1]
            || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
          if (metaDesc) parts.push(metaDesc.trim().slice(0, 300))
        } catch { /* best-effort — prompt still forbids invented claims */ }
      }
      if (parts.length) productDesc = parts.join('. ').slice(0, 600)
    }
    const priceStr = productPrice ? (/^\s*[\$£€₨₹]|rs\.?/i.test(String(productPrice)) ? String(productPrice).trim() : `$${String(productPrice).trim()}`) : null
    const prompt = buildClonePrompt({
      brandName, colors: kitColors, newHeadline, aspectRatio: resolvedAspect, fonts: kitFonts, palette: kitPalette, hasLogo: !!logoImg,
      productDesc: productDesc || undefined, productPrice: priceStr, look: typeof look === 'string' ? look : undefined,
      dna: { hook_type: ad.hook_type, format_style: ad.format_style, angle: ad.angle, emotion: ad.emotion, cta: ad.cta },
      isService,
    })
    const genImages = logoImg ? [refImg, ...products, logoImg] : [refImg, ...products]

    // Generate → verify → retry. MAX_GENS back to 3 (was cut to 2 only to survive the sync request
    // timeout): now the generation runs off the request path, so we can be uncompromising on quality
    // — three QA rounds, best attempt ships. Verifier fails OPEN on API errors.
    const MAX_GENS = 3
    let gen: Awaited<ReturnType<typeof generateImage>> | null = null
    let best: { mimeType: string; dataB64: string } | null = null
    let usedModel: string | null = null   // which Gemini model actually produced the winning image (admin telemetry)
    const verdictLog: string[] = []
    for (let i = 0; i < MAX_GENS; i++) {
      const attemptPrompt = i === 0 ? prompt : `${prompt} IMPORTANT CORRECTION: ${verdictLog[verdictLog.length - 1]}`
      gen = await generateImage(attemptPrompt, genImages, useTier, { aspectRatio: resolvedAspect, imageSize })
      if (!gen.ok) break
      best = { mimeType: gen.mimeType, dataB64: gen.dataB64 }; usedModel = gen.model
      // Service ads have no product to verify against — accept the first good render (the prompt forbids
      // inventing a physical product). Physical ads run the product/branding/text QA loop as before.
      if (isService || !products[0]) { verdictLog.push('service'); break }
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
      if (raw === 'pro_model_busy') {
        return await fail('The Pro image model is busy right now — please try again in a minute. You weren’t charged.', 'pro_model_busy')
      }
      // Never surface raw Gemini/technical errors (400, base64, INVALID_ARGUMENT…) to the user — they
      // look alarming and mean nothing to them. Show one friendly line; keep the raw in fail_reason for admin.
      return await fail("We couldn't finish this remake — please try again. If it keeps happening, tell us. You weren’t charged.", `gen_error: ${String(raw).slice(0, 300)}`)
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
      // ref_url = the exact image we cloned from (discovery poster OR uploaded/asset reference), so the
      // "cloned from" thumbnail shows for EVERY clone — including Brand-Spy/asset/upload ones with no source_ad_id.
      clone_meta: { tx_id: txId, image_size: imageSize, model: usedModel, ref_url: refUrl },
    }).eq('id', jobId)

    if (userEmail) await sendFirstAdEmail(userId, userEmail, url).catch(() => {})
  } catch (e: any) {
    await fail(String(e?.message || e))
  }
}
