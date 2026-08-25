/**
 * Free studio render — the SAME Nano Banana Pro engine as /api/discovery/generate-ad, but with NO credit
 * charge. Used to auto-generate the Personalized Template images as a wow-factor on landing (the brand
 * shouldn't pay for the demo). Feeds buildStudioPrompt the FULL brand context (colors, fonts, logo, a
 * rich fact-grounded angle, a real product photo, plus niche inspirations) so the output matches the
 * quality of a paid generation.
 */
import { generateImage, buildStudioPrompt, geminiEnabled, geminiImageMime, verifyClonedAd } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'
import { pickInspirations } from '@/lib/studio/inspiration'
import { getNicheInsights, resolveBrandNiche } from '@/lib/studio/insights'

type Img = { mimeType: string; dataB64: string }

async function fetchImageB64(url: string): Promise<Img | null> {
  try {
    const u = /^\/\/[^/]/.test(url) ? `https:${url}` : url
    if (!/^https?:\/\//i.test(u)) {
      const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(url)
      if (m) { const mime = geminiImageMime(m[1], Buffer.from(m[2], 'base64')); return mime ? { mimeType: mime, dataB64: m[2] } : null }
      return null
    }
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) })
    const buf = Buffer.from(await r.arrayBuffer())
    const mimeType = geminiImageMime(r.headers.get('content-type'), buf)
    return mimeType ? { mimeType, dataB64: buf.toString('base64') } : null
  } catch { return null }
}

export type FreeRenderOpts = {
  productImages: string[]        // urls or data URLs
  headline: string
  angle: string                  // rich, fact-grounded creative direction / scene
  aspectRatio?: string
  colors?: string[]
  fonts?: { heading?: string | null; body?: string | null }
  logo?: string | null
  brandName?: string
  productDesc?: string
  niche?: string | null          // resolve once in the caller and pass in (avoids N lookups for N templates)
}

/** Generate one ad with the Pro engine and NO credit charge. Returns the permanent R2 url (+ data image). */
export async function renderAdFree(admin: any, userId: string, brandId: string | null, opts: FreeRenderOpts): Promise<{ url: string | null; image: string } | null> {
  if (!geminiEnabled) return null
  const products = (await Promise.all(opts.productImages.slice(0, 2).map(fetchImageB64))).filter(Boolean) as Img[]
  if (!products.length) return null

  const niche = opts.niche ?? (await resolveBrandNiche(admin, null).catch(() => null))
  const insights = await getNicheInsights(admin, niche)
  const aspect = opts.aspectRatio && opts.aspectRatio !== 'Auto' ? opts.aspectRatio : '4:5'

  const inspirations = await pickInspirations(admin, { niche, aspect, limit: 4 }).catch(() => [])
  const fetched = (await Promise.all(inspirations.map((i) => fetchImageB64(i.r2_url)))).filter(Boolean) as Img[]
  const styleTags = Array.from(new Set(inspirations.flatMap((i: any) => i.style_tags || []))).slice(0, 6)
  const logoImg = opts.logo ? await fetchImageB64(opts.logo) : null

  const prompt = buildStudioPrompt({
    brandName: opts.brandName, newHeadline: opts.headline, aspectRatio: aspect, hasLogo: !!logoImg,
    numInspirations: fetched.length, numProducts: products.length,
    colors: opts.colors?.slice(0, 4), fonts: opts.fonts, styleTags, insights, productDesc: opts.productDesc,
    angle: opts.angle,
  })
  const genImages = [...fetched, ...products, ...(logoImg ? [logoImg] : [])]

  // Generate → VISION-VERIFY → regenerate once with a correction if the product/branding/text came out
  // wrong. Free templates weren't QA'd before, so garbled text or a wrong product slipped through; now
  // they self-heal like the paid clone path. verifyClonedAd fails OPEN on any API error (never blocks).
  const MAX_GENS = 2
  let best: { mimeType: string; dataB64: string } | null = null
  let fix = ''
  for (let i = 0; i < MAX_GENS; i++) {
    const attemptPrompt = i === 0 ? prompt : `${prompt} IMPORTANT CORRECTION: ${fix}`
    const gen = await generateImage(attemptPrompt, genImages, 'pro', { aspectRatio: aspect, imageSize: '2K' })
    if (!gen.ok) break                                   // busy → keep best-so-far (or null on 1st attempt)
    best = { mimeType: gen.mimeType, dataB64: gen.dataB64 }
    if (!products[0]) break                              // no product to verify against → accept
    const v = await verifyClonedAd(best, products[0], opts.brandName)
    if (v.pass) break
    fix = v.fix || [
      !v.productMatches && 'Render the product exactly as shown in its photo — same shape, container type, label and colors.',
      !v.brandingClean && `Every logo and brand name shown must belong to ${opts.brandName ? `"${opts.brandName}"` : "the brand"} only.`,
      !v.textClean && 'Fix all text: correct spelling, no repeated words or duplicated text blocks.',
    ].filter(Boolean).join(' ')
  }
  if (!best) return null

  const saved = await saveGeneration({ userId, dataB64: best.dataB64, mimeType: best.mimeType, type: 'inspired', tier: 'pro', brandId, prompt: opts.headline || null }).catch(() => null)
  return { url: saved?.url || null, image: `data:${best.mimeType};base64,${best.dataB64}` }
}
