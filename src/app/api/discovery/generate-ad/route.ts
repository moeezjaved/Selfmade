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
import { generateImage, buildStudioPrompt, geminiEnabled } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'
import { resolveBrandNiche, getNicheInsights } from '@/lib/studio/insights'
import { pickInspirations } from '@/lib/studio/inspiration'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
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
  const { productImageB64, productImages, productMimeType, newHeadline, brandName, colors, brandId, aspectRatio } = body || {}
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
    if (brandId) {
      const { data: brand } = await admin.from('brands').select('brand_kit, industry, description').eq('id', String(brandId)).maybeSingle()
      const kit = (brand as any)?.brand_kit || {}
      if (!kitColors?.length && Array.isArray(kit.colors)) kitColors = kit.colors.slice(0, 4)
      if (kit.fonts) kitFonts = kit.fonts
      if (kit.palette) kitPalette = kit.palette
      if (kit.logo) logoUrl = kit.logo
      industries = (brand as any)?.industry || null
      productDesc = (brand as any)?.description || undefined
    }
    if (!kitPalette && body.palette && typeof body.palette === 'object') kitPalette = body.palette
    if (!kitFonts && body.fonts && typeof body.fonts === 'object') kitFonts = body.fonts
    if (!logoUrl && typeof body.logo === 'string' && body.logo.trim()) logoUrl = body.logo.trim()

    const niche = await resolveBrandNiche(admin, industries)
    const insights = await getNicheInsights(admin, niche)

    // Aspect: Studio has no source ad, so 'original'/none → let the prompt default (4:5).
    const resolvedAspect = (!aspectRatio || aspectRatio === 'original') ? undefined : aspectRatio

    // Retrieve inspiration references (aesthetic ground truth).
    const inspirations = await pickInspirations(admin, { niche, aspect: resolvedAspect, limit: 4 })
    const inspImgs = (await Promise.all(inspirations.map((i) => fetchImageB64(i.r2_url)))).filter(Boolean) as { mimeType: string; dataB64: string }[]
    const styleTags = Array.from(new Set(inspirations.flatMap((i) => i.style_tags || []))).slice(0, 6)

    // Product photos → base64 (cap 3 to leave room for up to 4 inspirations + logo).
    const products = (await Promise.all(rawProducts.slice(0, 3).map(async (src) => {
      const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
      if (m) return { mimeType: m[1] || productMimeType || 'image/png', dataB64: m[2] }
      if (/^https?:\/\//i.test(src)) return await fetchImageB64(src)
      return { mimeType: productMimeType || 'image/png', dataB64: src.replace(/^data:[^;]+;base64,/, '') }
    }))).filter(Boolean) as { mimeType: string; dataB64: string }[]
    if (products.length === 0) { await refund(); return NextResponse.json({ error: 'could not load product image(s)' }, { status: 502 }) }

    const logoImg = logoUrl ? await fetchImageB64(logoUrl) : null

    const prompt = buildStudioPrompt({
      brandName, newHeadline, aspectRatio: resolvedAspect, hasLogo: !!logoImg,
      numInspirations: inspImgs.length, numProducts: products.length,
      palette: kitPalette, colors: kitColors, fonts: kitFonts, styleTags, insights, productDesc,
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
    })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
