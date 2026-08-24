/**
 * Free studio render — the SAME Nano Banana Pro engine as /api/discovery/generate-ad, but with NO credit
 * charge. Used to auto-generate the Personalized Template images as a wow-factor on landing (the brand
 * shouldn't pay for the demo). Feeds buildStudioPrompt the FULL brand context (colors, fonts, logo, a
 * rich fact-grounded angle, a real product photo, plus niche inspirations) so the output matches the
 * quality of a paid generation.
 */
import { generateImage, buildStudioPrompt, geminiEnabled, geminiImageMime } from '@/lib/gemini/image'
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
  const gen = await generateImage(prompt, genImages, 'pro', { aspectRatio: aspect, imageSize: '2K' })
  if (!gen.ok) return null

  const saved = await saveGeneration({ userId, dataB64: gen.dataB64, mimeType: gen.mimeType, type: 'inspired', tier: 'pro', brandId, prompt: opts.headline || null }).catch(() => null)
  return { url: saved?.url || null, image: `data:${gen.mimeType};base64,${gen.dataB64}` }
}
