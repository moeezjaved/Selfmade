/**
 * AI Ad Studio — generate a brand-NEW original ad for the user's product (no source ad).
 * POST { brandId?, productImages|productImageB64, productMimeType?, brandName?, colors?, palette?,
 *        fonts?, logo?, newHeadline?, aspectRatio?, imageSize?:'2K'|'4K' }
 *   → reserve credits → resolve the brand's niche → aggregate industry insights → retrieve 3-4
 *     inspiration references → Nano Banana Pro generateImage([refs, product, logo]) →
 *     commit/refund → save to My Creatives (type 'inspired') → return { image, url }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, buildStudioPrompt, geminiEnabled, geminiImageMime } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'
import { resolveBrandNiche, getNicheInsights } from '@/lib/studio/insights'
import { pickInspirations } from '@/lib/studio/inspiration'
import { inferNiche } from '@/lib/gemini/vision'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function fetchImageB64(url: string): Promise<{ mimeType: string; dataB64: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    // Drop images Gemini can't ingest (e.g. an SVG logo) BEFORE they're counted, so the prompt's
    // image indices (inspirations/products/logo) stay aligned with what's actually sent.
    const mimeType = geminiImageMime(r.headers.get('content-type'), buf)
    if (!mimeType) return null
    return { mimeType, dataB64: buf.toString('base64') }
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try { return await handle(req) }
  catch (e: any) {
    console.error('generate-ad fatal:', e)
    return NextResponse.json({ error: `server error: ${String(e?.message || e)}` }, { status: 500 })
  }
}

async function handle(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const { productImageB64, productImages, productMimeType, newHeadline, brandName, colors, brandId, aspectRatio, angle } = body || {}
  const nicheOverride = typeof body.niche === 'string' && body.niche.trim() ? body.niche.trim() : null
  const rawProducts: string[] = Array.isArray(productImages) && productImages.length
    ? productImages.filter((s: any) => typeof s === 'string' && s.trim())
    : (productImageB64 ? [String(productImageB64)] : [])
  if (rawProducts.length === 0) return NextResponse.json({ error: 'at least one product image required' }, { status: 400 })

  const imageSize = body.imageSize === '4K' ? '4K' : '2K'
  const action = imageSize === '4K' ? 'image_studio_4k' : 'image_studio_pro'
  const admin = createAdminClient()

  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id
  const refund = async () => { if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {}) }

  try {
    // Brand kit + industry → niche.
    let kitColors: string[] | undefined = Array.isArray(colors) ? colors.slice(0, 4) : undefined
    let kitFonts: any, kitPalette: any, logoUrl: string | null = null, productDesc: string | undefined
    let industries: string[] | null = null
    let brandNm: string | undefined = brandName, website: string | undefined
    if (brandId) {
      const { data: brand } = await admin.from('brands').select('name, website, brand_kit, industry, description').eq('id', String(brandId)).maybeSingle()
      const kit = (brand as any)?.brand_kit || {}
      if (!kitColors?.length && Array.isArray(kit.colors)) kitColors = kit.colors.slice(0, 4)
      if (kit.fonts) kitFonts = kit.fonts
      if (kit.palette) kitPalette = kit.palette
      if (kit.logo) logoUrl = kit.logo
      industries = (brand as any)?.industry || null
      productDesc = (brand as any)?.description || undefined
      brandNm = brandNm || (brand as any)?.name
      website = (brand as any)?.website || undefined
    }
    if (!kitPalette && body.palette && typeof body.palette === 'object') kitPalette = body.palette
    if (!kitFonts && body.fonts && typeof body.fonts === 'object') kitFonts = body.fonts
    if (!logoUrl && typeof body.logo === 'string' && body.logo.trim()) logoUrl = body.logo.trim()

    // Product photos → base64 (cap 3 to leave room for up to 4 inspirations + logo). Done first so
    // we can auto-detect the niche from the product when the brand has no industry set.
    const products = (await Promise.all(rawProducts.slice(0, 3).map(async (src) => {
      const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
      if (m) { const mime = geminiImageMime(m[1] || productMimeType, Buffer.from(m[2], 'base64')); return mime ? { mimeType: mime, dataB64: m[2] } : null }
      if (/^https?:\/\//i.test(src)) return await fetchImageB64(src)
      const raw = src.replace(/^data:[^;]+;base64,/, ''); const mime = geminiImageMime(productMimeType, Buffer.from(raw, 'base64'))
      return mime ? { mimeType: mime, dataB64: raw } : null
    }))).filter(Boolean) as { mimeType: string; dataB64: string }[]
    if (products.length === 0) { await refund(); return NextResponse.json({ error: 'could not load product image(s)' }, { status: 502 }) }

    // Niche resolution: explicit user override → brand.industry → AI detect (brand name/desc lead,
    // product photo secondary). Persist a detected niche so it's instant next time.
    let niche = nicheOverride || await resolveBrandNiche(admin, industries)
    if (!niche) {
      const { data: nc } = await admin.from('niche_counts').select('niche').limit(100)
      const vocab = (nc || []).map((r: any) => r.niche).filter(Boolean)
      niche = await inferNiche(products[0], vocab, { brandName: brandNm, description: productDesc, website }).catch(() => null)
      if (niche && brandId) admin.from('brands').update({ industry: [niche] }).eq('id', String(brandId)).then(() => {}, () => {})
    }
    const insights = await getNicheInsights(admin, niche)

    // Aspect: Studio has no source ad, so 'original'/none → let the prompt default (4:5).
    const resolvedAspect = (!aspectRatio || aspectRatio === 'original') ? undefined : aspectRatio

    // Retrieve inspiration references (aesthetic ground truth). Keep each ref paired with its fetched
    // image so we can report exactly which designs (and why) were used.
    const inspirations = await pickInspirations(admin, { niche, aspect: resolvedAspect, limit: 4 })
    const fetched = (await Promise.all(inspirations.map(async (i) => ({ ref: i, img: await fetchImageB64(i.r2_url) }))))
      .filter((x) => x.img) as { ref: typeof inspirations[number]; img: { mimeType: string; dataB64: string } }[]
    const inspImgs = fetched.map((x) => x.img)
    const usedRefs = fetched.map((x) => x.ref)
    const styleTags = Array.from(new Set(usedRefs.flatMap((i) => i.style_tags || []))).slice(0, 6)

    const logoImg = logoUrl ? await fetchImageB64(logoUrl) : null

    const prompt = buildStudioPrompt({
      brandName: brandNm, newHeadline, aspectRatio: resolvedAspect, hasLogo: !!logoImg,
      numInspirations: inspImgs.length, numProducts: products.length,
      palette: kitPalette, colors: kitColors, fonts: kitFonts, styleTags, insights, productDesc,
      angle: typeof angle === 'string' && angle.trim() ? angle.trim() : undefined,
    })
    console.log(`generate-ad [niche:${niche || 'none'} refs:${inspImgs.length} sample:${insights.sampleSize}] prompt:`, prompt)

    // Order: [inspirations..., products..., logo?] — the prompt references indexes accordingly.
    const genImages = [...inspImgs, ...products, ...(logoImg ? [logoImg] : [])]
    const gen = await generateImage(prompt, genImages, 'pro', { aspectRatio: resolvedAspect, imageSize })
    if (!gen.ok) { await refund(); return NextResponse.json({ error: gen.error }, { status: 502 }) }

    if (txId) await admin.rpc('commit_credits', { p_tx: txId }).then(() => {}, () => {})

    const saved = await saveGeneration({
      userId: user.id, dataB64: gen.dataB64, mimeType: gen.mimeType, type: 'inspired', tier: 'pro',
      brandId: brandId || null, prompt: newHeadline || null,
    })

    return NextResponse.json({
      image: `data:${gen.mimeType};base64,${gen.dataB64}`, url: saved?.url || null, generationId: saved?.id || null,
      niche, inspirations: inspImgs.length, insightsUsed: { hooks: insights.topHooks, angles: insights.topAngles },
      // Which references were used + why (for the transparency panel).
      references: usedRefs.map((r) => ({
        url: r.r2_url, niche: r.niche, aspect: r.aspect, layout_type: r.layout_type, style_tags: r.style_tags || [],
        why: [r.niche && r.niche === niche ? `same niche (${r.niche})` : r.niche ? `niche ${r.niche}` : null,
              r.aspect && resolvedAspect && r.aspect === resolvedAspect ? `matches ${r.aspect}` : r.aspect ? `${r.aspect}` : null,
              r.layout_type].filter(Boolean).join(' · '),
      })),
    })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
