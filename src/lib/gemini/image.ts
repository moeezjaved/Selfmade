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
export async function generateImage(prompt: string, images: ImageInput[], tier: 'default' | 'pro' = 'default', opts?: { aspectRatio?: string }): Promise<GenResult> {
  if (!KEY) return { ok: false, error: 'GEMINI_API_KEY not set' }
  const parts: any[] = [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.dataB64 } }))]
  const generationConfig: any = { responseModalities: ['IMAGE'] }
  // gemini image models accept imageConfig.aspectRatio (e.g. "1:1", "4:5", "9:16"). Omit for "original".
  if (opts?.aspectRatio && opts.aspectRatio !== 'original') generationConfig.imageConfig = { aspectRatio: opts.aspectRatio }
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
export function buildClonePrompt(opts: {
  brandName?: string; colors?: string[]; newHeadline?: string; aspectRatio?: string
  dna?: { hook_type?: string | null; format_style?: string | null; angle?: string | null; emotion?: string[] | null; cta?: string | null }
}): string {
  const d = opts.dna || {}
  const keep = [
    d.hook_type && `hook style (${d.hook_type})`,
    d.format_style && `visual format (${d.format_style})`,
    d.angle && `angle (${d.angle})`,
    d.emotion?.length && `emotional tone (${d.emotion.slice(0, 2).join(', ')})`,
  ].filter(Boolean).join(', ')
  return [
    `Recreate the winning Facebook ad (image 1) as a template, but featuring the user's real product shown in the OTHER attached image(s).`,
    `KEEP the ad's layout, composition, camera angle, lighting, color palette, and text placement${keep ? `, plus the ${keep}` : ''}.`,
    `PRODUCT — this is critical: the product in the attached product photo(s) is the user's ACTUAL product. Place THAT exact product into the ad, reproduced faithfully — same shape, proportions, packaging, label text, and colors. It must be clearly visible and be the ONLY product shown. Do NOT invent, redraw, simplify, or substitute a different-looking product; copy the real one from the photo.`,
    opts.brandName ? `The brand is "${opts.brandName}".` : '',
    opts.colors?.length ? `Brand colors to favor where the design allows: ${opts.colors.join(', ')}.` : '',
    opts.newHeadline ? `On-screen headline — render this text EXACTLY, letter for letter: "${opts.newHeadline}".` : `Keep the headline layout; write short ad copy relevant to this product.`,
    d.cta ? `Include a clear call-to-action button ("${d.cta}").` : '',
    `TEXT: spell every word correctly using real English — never output invented, garbled, or misspelled words. Keep all text crisp and legible.`,
    `Do NOT include: watermarks, timestamps, logos of other brands, extra or duplicate products, or any placeholder/gibberish text.`,
    opts.aspectRatio && opts.aspectRatio !== 'original'
      ? `Compose the final image at a ${opts.aspectRatio} aspect ratio.`
      : `Keep the same aspect ratio as image 1.`,
    `Output ONE photorealistic, ad-ready image.`,
  ].filter(Boolean).join(' ')
}
