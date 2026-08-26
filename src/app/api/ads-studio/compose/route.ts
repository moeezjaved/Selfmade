/**
 * POST /api/ads-studio/compose — element ad generation done right. When the user tags a PERSON (element)
 * to appear in the ad, the product-centric studio engine (generate-ad) ignores them and invents its own
 * model. This path is purpose-built: person = subject (identity preserved), product = featured accurately,
 * NO inspiration images (those were injecting fake people), with an explicit subject+product prompt.
 * Same Pro engine + credits as generate-ad.
 *
 * Body: { personImages: [url|dataUrl], productImages: [url|dataUrl], headline, angle, aspectRatio,
 *         colors?, fonts?, logo?, brandName? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, geminiEnabled, geminiImageMime, verifyClonedAd } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

type Img = { mimeType: string; dataB64: string }
async function toImg(src: string): Promise<Img | null> {
  try {
    const m = /^data:([^;]+);base64,([\s\S]+)$/i.exec(src)
    if (m) { const mime = geminiImageMime(m[1], Buffer.from(m[2], 'base64')); return mime ? { mimeType: mime, dataB64: m[2] } : null }
    const url = /^\/\/[^/]/.test(src) ? `https:${src}` : src
    if (!/^https?:\/\//i.test(url)) return null
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const buf = Buffer.from(await r.arrayBuffer())
    const mime = geminiImageMime(r.headers.get('content-type'), buf)
    return mime ? { mimeType: mime, dataB64: buf.toString('base64') } : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const personSrcs: string[] = (Array.isArray(body.personImages) ? body.personImages : []).filter((s: any) => typeof s === 'string' && s.trim())
  const productSrcs: string[] = (Array.isArray(body.productImages) ? body.productImages : []).filter((s: any) => typeof s === 'string' && s.trim())
  if (!personSrcs.length) return NextResponse.json({ error: 'personImages required' }, { status: 400 })
  const headline = String(body.headline || '').slice(0, 120)
  const angle = String(body.angle || '').slice(0, 400)
  const brandName = String(body.brandName || 'the brand').slice(0, 60)
  const aspectRatio = typeof body.aspectRatio === 'string' && body.aspectRatio !== 'Auto' ? body.aspectRatio : '4:5'
  const colors: string[] = Array.isArray(body.colors) ? body.colors.slice(0, 4) : []
  const fonts = body.fonts && typeof body.fonts === 'object' ? body.fonts : null
  const logoSrc = typeof body.logo === 'string' ? body.logo : ''

  const admin = createAdminClient() as any
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: 'image_studio_pro' })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id
  const refund = async () => { if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {}) }

  try {
    const person = (await Promise.all(personSrcs.slice(0, 1).map(toImg))).filter(Boolean) as Img[]
    const product = (await Promise.all(productSrcs.slice(0, 1).map(toImg))).filter(Boolean) as Img[]
    const logo = logoSrc ? await toImg(logoSrc) : null
    if (!person.length) { await refund(); return NextResponse.json({ error: 'could not load person image' }, { status: 502 }) }

    // Image order the prompt references: [person, product?, logo?]
    const images: Img[] = [...person, ...product, ...(logo ? [logo] : [])]
    const hasProduct = product.length > 0
    const prompt = [
      `Create ONE polished, photorealistic advertisement image${aspectRatio ? ` (aspect ratio ${aspectRatio})` : ''}.`,
      `SUBJECT — reference image 1 is a specific real PERSON. Use THAT exact person as the human subject: preserve their face, likeness, skin tone, hair, and clothing faithfully. Do NOT replace them with a different person, do NOT add other people, do NOT beautify or change their identity.`,
      hasProduct ? `PRODUCT — reference image 2 is the ${brandName} product. Render it EXACTLY as in the photo: same shape, materials, colours, proportions and on-label text — never a different product. Size it at a natural, believable real-world scale (a small handheld device stays small). It does NOT have to be held or in use: place it wherever looks most natural — the subject MAY hold it, OR it can rest on a surface, sit beside them, or appear as a clean product inset. Never force it awkwardly into their hand or mouth.` : '',
      logo ? `Include the brand logo once, small and tasteful (from the last reference image) — reproduce it exactly; do not redraw or restyle it.`
           : `Do NOT invent a logo, emblem, icon or symbol (no leaves, lotus, drops, monograms, etc.). If a wordmark is shown, render ONLY the brand name "${brandName}" as clean plain text — nothing more.`,
      colors.length ? `Brand colours to use: ${colors.join(', ')}.` : '',
      fonts?.heading ? `Prefer the "${fonts.heading}" typeface for the headline.` : '',
      headline ? `Add the headline text "${headline}" ONCE — clean, legible, well-placed, never duplicated.` : '',
      `Include exactly ONE clear call-to-action button.`,
      angle ? `Art direction: ${angle}` : '',
      `Natural light, on-brand, uncluttered, leave room for the headline and CTA. No duplicated text, logos or people. Correctly spelled text.`,
    ].filter(Boolean).join('\n')

    // Generate → VISION-VERIFY the product/text/size against the real product photo → regenerate once
    // with a correction if it's wrong. Fixes "the product didn't come right" on element ads.
    const MAX_GENS = hasProduct ? 2 : 1
    let best: Img | null = null
    let fix = ''
    for (let i = 0; i < MAX_GENS; i++) {
      const attemptPrompt = i === 0 ? prompt : `${prompt}\nIMPORTANT CORRECTION: ${fix}`
      const gen = await generateImage(attemptPrompt, images, 'pro', { aspectRatio, imageSize: '2K' })
      if (!gen.ok) { if (best) break; await refund(); return NextResponse.json({ error: gen.error || 'generation-failed' }, { status: 502 }) }
      best = { mimeType: gen.mimeType, dataB64: gen.dataB64 }
      if (!hasProduct) break
      const v = await verifyClonedAd(best, product[0], brandName)
      if (v.pass) break
      fix = v.fix || [
        !v.productMatches && 'Render the product EXACTLY as its photo — same shape, container type, label and colours.',
        !v.textClean && 'Fix all text: correct spelling, no repeated words.',
        !v.productProportional && 'Size the product at a natural real-world scale — smaller, not larger-than-life.',
      ].filter(Boolean).join(' ')
    }
    if (!best) { await refund(); return NextResponse.json({ error: 'generation-failed' }, { status: 502 }) }
    if (txId) await admin.rpc('commit_credits', { p_tx: txId }).then(() => {}, () => {})

    const saved = await saveGeneration({ userId: user.id, dataB64: best.dataB64, mimeType: best.mimeType, type: 'inspired', tier: 'pro', brandId: body.brandId || null, prompt: headline || null }).catch(() => null)
    return NextResponse.json({ image: `data:${best.mimeType};base64,${best.dataB64}`, url: saved?.url || null })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
