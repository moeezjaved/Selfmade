/**
 * AI ad clone — clone a winning ad's structure onto the user's product via Nano Banana.
 * POST { adId, productImageB64, productMimeType?, tier?:'default'|'pro', newHeadline?, brandName?, colors? }
 *   → reserve credits → fetch the ad's creative + classified DNA → build the clone prompt →
 *     Gemini generateImage([reference ad, product]) → commit (or refund on failure) → return { image }.
 * The generated image is returned as a data URL for the user to preview/tweak/download.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, buildClonePrompt, geminiEnabled } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const { adId, productImageB64, productImages, productMimeType, tier, newHeadline, brandName, colors, brandId } = body || {}
  // Accept one legacy base64 photo OR an array of product photos (data: URLs and/or http URLs).
  // Multiple angles help Nano Banana hold the product's exact shape/label across the clone.
  const rawProducts: string[] = Array.isArray(productImages) && productImages.length
    ? productImages.filter((s: any) => typeof s === 'string' && s.trim())
    : (productImageB64 ? [String(productImageB64)] : [])
  if (!adId || rawProducts.length === 0) return NextResponse.json({ error: 'adId and at least one product image required' }, { status: 400 })
  const useTier: 'default' | 'pro' = tier === 'pro' ? 'pro' : 'default'
  const action = useTier === 'pro' ? 'image_clone_pro' : 'image_clone'

  const admin = createAdminClient()

  // Reserve credits (throws insufficient_credits inside the RPC → surfaced as an error).
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id
  const refund = async () => { if (txId) await admin.rpc('refund_credits', { p_tx: txId }).catch(() => {}) }

  try {
    // Reference ad: creative image + classified DNA.
    const { data: ad } = await admin
      .from('discovery_ads_index')
      .select('hook_type, format_style, angle, emotion, cta, page_name, discovery_creatives(asset_type, r2_url, poster_url, position)')
      .eq('ad_id', String(adId))
      .maybeSingle()
    if (!ad) { await refund(); return NextResponse.json({ error: 'ad not found' }, { status: 404 }) }

    const cres = ((ad as any).discovery_creatives || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
    const refUrl = cres.map((c: any) => c.asset_type === 'video' ? c.poster_url : c.r2_url).find(Boolean)
    if (!refUrl) { await refund(); return NextResponse.json({ error: 'reference ad has no image' }, { status: 422 }) }
    const refImg = await fetchImageB64(refUrl)
    if (!refImg) { await refund(); return NextResponse.json({ error: 'could not load reference image' }, { status: 502 }) }

    const prompt = buildClonePrompt({
      brandName, colors: Array.isArray(colors) ? colors.slice(0, 4) : undefined, newHeadline,
      dna: { hook_type: (ad as any).hook_type, format_style: (ad as any).format_style, angle: (ad as any).angle, emotion: (ad as any).emotion, cta: (ad as any).cta },
    })

    // Normalize each product photo to base64. data: URLs are decoded inline; http(s) URLs are fetched.
    // Cap at 4 so the payload stays within Gemini's part limit alongside the reference ad.
    const products = (await Promise.all(rawProducts.slice(0, 4).map(async (src) => {
      const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
      if (m) return { mimeType: m[1] || productMimeType || 'image/png', dataB64: m[2] }
      if (/^https?:\/\//i.test(src)) return await fetchImageB64(src)
      return { mimeType: productMimeType || 'image/png', dataB64: src.replace(/^data:[^;]+;base64,/, '') }
    }))).filter(Boolean) as { mimeType: string; dataB64: string }[]
    if (products.length === 0) { await refund(); return NextResponse.json({ error: 'could not load product image(s)' }, { status: 502 }) }

    const gen = await generateImage(prompt, [refImg, ...products], useTier)
    if (!gen.ok) { await refund(); return NextResponse.json({ error: gen.error }, { status: 502 }) }

    if (txId) await admin.rpc('commit_credits', { p_tx: txId }).catch(() => {})

    // Persist to "My Creatives" (best-effort — the user still gets the inline image if R2 is off).
    const saved = await saveGeneration({
      userId: user.id, dataB64: gen.dataB64, mimeType: gen.mimeType, type: 'clone', tier: useTier,
      brandId: brandId || null, sourceAdId: String(adId), prompt: newHeadline || null,
    })
    return NextResponse.json({ image: `data:${gen.mimeType};base64,${gen.dataB64}`, url: saved?.url || null, generationId: saved?.id || null, tier: useTier })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
