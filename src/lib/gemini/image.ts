/**
 * Gemini image generation (Nano Banana) — ad cloning + inspired generation.
 *
 * Uses the generateContent REST API with responseModalities:['IMAGE']. Nano Banana composites a
 * product into a reference ad while preserving product identity — the core of clone. Model id is
 * env-configurable so we can offer Nano Banana 2 (default) and Pro (premium) without a code change.
 *
 * Env: GEMINI_API_KEY (starts with AIza…). Optional model overrides:
 *   GEMINI_IMAGE_MODEL      (default) — e.g. 'gemini-2.5-flash-image'
 *   GEMINI_IMAGE_MODEL_PRO  (premium) — the Nano Banana Pro id
 */
const KEY = process.env.GEMINI_API_KEY
const MODEL_DEFAULT = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
const MODEL_PRO = process.env.GEMINI_IMAGE_MODEL_PRO || 'gemini-2.5-flash-image'
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const geminiEnabled = !!KEY
export function modelFor(tier: 'default' | 'pro') { return tier === 'pro' ? MODEL_PRO : MODEL_DEFAULT }

export type ImageInput = { mimeType: string; dataB64: string }
export type GenResult = { ok: true; mimeType: string; dataB64: string } | { ok: false; error: string }

/**
 * Generate/edit an image from a text prompt + N reference images (e.g. [winning ad, product photo]).
 * Returns the first image part (base64). The caller uploads it to R2.
 */
export async function generateImage(prompt: string, images: ImageInput[], tier: 'default' | 'pro' = 'default', opts?: { aspectRatio?: string; imageSize?: string }): Promise<GenResult> {
  if (!KEY) return { ok: false, error: 'GEMINI_API_KEY not set' }
  const parts: any[] = [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.dataB64 } }))]
  const generationConfig: any = { responseModalities: ['IMAGE'] }
  // Lower temperature → more faithful to the reference/product (less "creative" drift). Env-tunable.
  const temp = parseFloat(process.env.GEMINI_IMAGE_TEMP || '0.35')
  if (!Number.isNaN(temp)) generationConfig.temperature = temp
  // gemini-3-pro-image accepts imageConfig { aspectRatio, imageSize }. imageSize (1K/2K/4K) controls
  // resolution → cost; default 2K. Only sent for the Pro model (standard model rejects it).
  const imageConfig: any = {}
  if (opts?.aspectRatio && opts.aspectRatio !== 'original') imageConfig.aspectRatio = opts.aspectRatio
  if (tier === 'pro') imageConfig.imageSize = opts?.imageSize || process.env.GEMINI_IMAGE_SIZE || '2K'
  if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig
  try {
    const r = await fetch(`${BASE}/${modelFor(tier)}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    })
    if (!r.ok) return { ok: false, error: `gemini ${r.status} [${modelFor(tier)}]: ${(await r.text().catch(() => '')).slice(0, 240)}` }
    const j = await r.json()
    const out = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inline_data || p.inlineData)
    const inline = out?.inline_data || out?.inlineData
    if (!inline?.data) return { ok: false, error: 'no image in response' }
    return { ok: true, mimeType: inline.mime_type || inline.mimeType || 'image/png', dataB64: inline.data }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/**
 * Build the ad-clone prompt from the winning ad's classified DNA. Two images are attached by the
 * caller: [reference ad, product photo]. The DNA makes the clone copy the WINNING STRUCTURE, and the
 * fidelity guardrail keeps the product exact — the two levers that make a clone usable, not just pretty.
 */
export type BrandPalette = { background?: string; accent?: string; heading?: string; body?: string; icon?: string; cta?: string; ctaText?: string }

export function buildClonePrompt(opts: {
  brandName?: string; colors?: string[]; newHeadline?: string; aspectRatio?: string; hasLogo?: boolean
  palette?: BrandPalette
  fonts?: { heading?: string | null; body?: string | null; headingWeight?: string | null; bodyWeight?: string | null }
  dna?: { hook_type?: string | null; format_style?: string | null; angle?: string | null; emotion?: string[] | null; cta?: string | null }
}): string {
  const pal = opts.palette
  const paletteLine = pal && (pal.accent || pal.background || pal.heading || pal.cta)
    ? `Use this exact brand palette: ${[
        pal.background && `background ${pal.background}`, pal.accent && `accent ${pal.accent}`,
        pal.heading && `headline text ${pal.heading}`, pal.body && `body text ${pal.body}`,
        pal.cta && `CTA button ${pal.cta}${pal.ctaText ? ` with ${pal.ctaText} label` : ''}`, pal.icon && `icons ${pal.icon}`,
      ].filter(Boolean).join(', ')}. Apply them consistently and on-brand.`
    : ''
  const fontLine = (opts.fonts?.heading || opts.fonts?.body)
    ? `Use on-brand typography: ${[
        opts.fonts?.heading && `headings in "${opts.fonts.heading}"${opts.fonts?.headingWeight ? ` weight ${opts.fonts.headingWeight}` : ''}`,
        opts.fonts?.body && `body text in "${opts.fonts.body}"${opts.fonts?.bodyWeight ? ` weight ${opts.fonts.bodyWeight}` : ''}`,
      ].filter(Boolean).join(', ')} (or the closest available match).`
    : ''
  const logoLine = opts.hasLogo
    ? `If the FINAL attached image is a simple brand logo/wordmark, place it small in a top corner. If it is NOT a clean logo (e.g. a photo or a person), ignore it completely — never add a person or scene from it.`
    : ''
  // Brand styling is SECONDARY — one demoted line so it never overrides the product swap.
  const brandStyle = [
    paletteLine ? paletteLine.replace('Use this exact brand palette:', 'brand colors:') : (opts.colors?.length ? `brand colors ${opts.colors.join(', ')}` : ''),
    fontLine ? fontLine.replace('Use on-brand typography:', 'fonts:') : '',
  ].filter(Boolean).join(' ')
  const d = opts.dna || {}
  const keep = [
    d.hook_type && `hook style (${d.hook_type})`,
    d.format_style && `visual format (${d.format_style})`,
    d.angle && `angle (${d.angle})`,
    d.emotion?.length && `emotional tone (${d.emotion.slice(0, 2).join(', ')})`,
  ].filter(Boolean).join(', ')
  return [
    `TASK: PRODUCT SWAP — not a redesign. Image 1 is a proven winning ad. The image(s) AFTER it are the USER'S PRODUCT${opts.hasLogo ? ' (and the very last image is the brand logo)' : ''}. Recreate image 1 almost exactly — same layout, composition, background scene, props, camera angle, lighting, subjects, mood${keep ? `, ${keep}` : ''}, and text placement — but REPLACE ONLY the featured product with the user's product.`,
    `THE USER'S PRODUCT IS MANDATORY AND IS THE HERO: copy it 1:1 from the product photo — match its EXACT silhouette, dimensions/proportions, cap and mouthpiece shape, materials, textures, on-label branding/text, and colors. Do NOT resize, reshape, restyle, re-proportion, beautify, or "improve" it — treat the photo as the ground truth. Place it in the SAME position and at the SAME relative size/footprint as the product it replaces — do NOT enlarge, shrink, or recenter it; if the original product was small in the frame, keep the new one small. It is the ONLY product in the ad.`,
    `CRITICAL — do NOT omit or shrink away the product, do NOT replace it with a person, model, hand, face, fruit, or any different object, and do NOT invent a new lifestyle scene. Keep the SAME subjects and setting as image 1; only the product changes.`,
    opts.brandName ? `Wherever the original ad shows its own brand name or wordmark, use "${opts.brandName}" instead.` : '',
    opts.newHeadline ? `On-screen headline — render EXACTLY, letter for letter: "${opts.newHeadline}".` : `Keep the headline layout; write short copy relevant to this product.`,
    d.cta ? `Keep a clear call-to-action button ("${d.cta}").` : '',
    brandStyle ? `Secondary styling, only where it does not fight the layout above — ${brandStyle}.` : '',
    logoLine,
    `Spell all text correctly in real English (no gibberish). No watermarks, no other brands' logos, no extra or duplicate products.`,
    opts.aspectRatio && opts.aspectRatio !== 'original'
      ? `Compose at a ${opts.aspectRatio} aspect ratio.`
      : `Keep the same aspect ratio as image 1.`,
    `Output ONE photorealistic, ad-ready image.`,
  ].filter(Boolean).join(' ')
}
