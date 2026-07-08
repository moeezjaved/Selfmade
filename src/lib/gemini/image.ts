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

// Gemini's image models only accept these raster input types. SVG (image/svg+xml) — common for
// brand logos — and other vector/exotic types 400 the whole generateContent call, so callers must
// filter/normalize to this set. Returns the normalized mime, or null if unusable (→ drop the image).
const GEMINI_IMG_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
export function geminiImageMime(raw?: string | null, head?: Buffer): string | null {
  let m = (raw || '').split(';')[0].trim().toLowerCase()
  if (m === 'image/jpg') m = 'image/jpeg'
  if (GEMINI_IMG_MIME.has(m)) return m
  if (m.startsWith('image/')) return null                 // explicit unsupported (svg/gif/bmp/tiff/avif…)
  if (head && head.length > 8) {                          // generic/unknown (octet-stream, missing) → sniff
    const s = head.subarray(0, 64).toString('utf8').toLowerCase()
    if (head[0] === 0x3c /* '<' */ || s.includes('<svg') || s.includes('<?xml')) return null  // SVG/XML text
    return 'image/jpeg'                                   // assume a mislabeled raster
  }
  return null
}

/**
 * Generate/edit an image from a text prompt + N reference images (e.g. [winning ad, product photo]).
 * Returns the first image part (base64). The caller uploads it to R2.
 */
export async function generateImage(prompt: string, images: ImageInput[], tier: 'default' | 'pro' = 'default', opts?: { aspectRatio?: string; imageSize?: string }): Promise<GenResult> {
  if (!KEY) return { ok: false, error: 'GEMINI_API_KEY not set' }
  // Safety net: strip any image whose MIME Gemini can't ingest (e.g. an SVG logo) so one bad
  // input never 400s the whole request. Callers should filter earlier to keep prompt indices aligned.
  const safeImages = images.filter((i) => geminiImageMime(i.mimeType) !== null)
  const parts: any[] = [{ text: prompt }, ...safeImages.map((i) => ({ inline_data: { mime_type: geminiImageMime(i.mimeType) || i.mimeType, data: i.dataB64 } }))]
  // Lower temperature → more faithful to the reference/product (less "creative" drift). Env-tunable.
  const temp = parseFloat(process.env.GEMINI_IMAGE_TEMP || '0.35')
  const wantAspect = opts?.aspectRatio && opts.aspectRatio !== 'original' ? opts.aspectRatio : null
  const proImageSize = opts?.imageSize || process.env.GEMINI_IMAGE_SIZE || '2K'

  // MODEL CANDIDATES. The Pro image model (gemini-3-pro-image) frequently 503s ("high demand") on
  // Google's side — a capacity outage, NOT our quota (the standard model works with the same key).
  // So when Pro is requested, fall back to the standard model after retries: the user still gets an
  // image instead of an error. imageSize (1K/2K/4K) is Pro-only — the standard model rejects it.
  const candidates = (tier === 'pro' && MODEL_PRO !== MODEL_DEFAULT) ? [MODEL_PRO, MODEL_DEFAULT] : [modelFor(tier)]
  const RETRYABLE = new Set([429, 500, 502, 503, 504])
  const MAX_TRIES = 4
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
  let lastErr = 'gemini failed'

  for (const model of candidates) {
    const isPro = model === MODEL_PRO
    const cfg: any = { responseModalities: ['IMAGE'] }
    if (!Number.isNaN(temp)) cfg.temperature = temp
    const ic: any = {}
    if (wantAspect) ic.aspectRatio = wantAspect
    if (isPro) ic.imageSize = proImageSize
    if (Object.keys(ic).length) cfg.imageConfig = ic

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        const r = await fetch(`${BASE}/${model}:generateContent?key=${KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: cfg }),
        })
        if (!r.ok) {
          lastErr = `gemini ${r.status} [${model}]: ${(await r.text().catch(() => '')).slice(0, 240)}`
          if (RETRYABLE.has(r.status) && attempt < MAX_TRIES) { await sleep(700 * 2 ** (attempt - 1)); continue }
          break   // exhausted this model → fall through to the next candidate (standard)
        }
        const j = await r.json()
        const out = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inline_data || p.inlineData)
        const inline = out?.inline_data || out?.inlineData
        if (!inline?.data) {
          lastErr = 'no image in response'
          if (attempt < MAX_TRIES) { await sleep(700 * 2 ** (attempt - 1)); continue }
          break
        }
        return { ok: true, mimeType: inline.mime_type || inline.mimeType || 'image/png', dataB64: inline.data }
      } catch (e: any) {
        lastErr = String(e?.message || e)
        if (attempt < MAX_TRIES) { await sleep(700 * 2 ** (attempt - 1)); continue }
        break
      }
    }
  }
  return { ok: false, error: lastErr }
}

/**
 * Build the ad-clone prompt from the winning ad's classified DNA. Two images are attached by the
 * caller: [reference ad, product photo]. The DNA makes the clone copy the WINNING STRUCTURE, and the
 * fidelity guardrail keeps the product exact — the two levers that make a clone usable, not just pretty.
 */
export type BrandPalette = { background?: string; accent?: string; heading?: string; body?: string; icon?: string; cta?: string; ctaText?: string }

/**
 * Humanize an auto-extracted font-family slug so it's usable in a prompt — and drop it entirely
 * if it's just a machine slug. Brand-kit font detection yields names like "foldgrotesqueregularpro"
 * or "bc_sklonarmedium"; passed raw, Gemini prints the NAME as text on the ad. Strip separators +
 * weight/style suffixes; if the result is still a run-on gibberish token, return null so the caller
 * falls back to "derive typography from the references" instead of stamping a slug on the image.
 */
export function cleanFontName(raw?: string | null): string | null {
  if (!raw) return null
  const junk = ['thin','extralight','ultralight','light','regular','normal','book','medium','semibold','demibold','bold','extrabold','ultrabold','black','heavy','italic','oblique','pro','std','mt','ot','web','var','variable','display','text']
  let s = raw.trim().toLowerCase().replace(/\.(ttf|otf|woff2?|eot)$/i, '').replace(/[_\-]+/g, ' ')
  s = s.split(/\s+/).filter((w) => !junk.includes(w)).join(' ')
  let changed = true
  while (changed) { changed = false; for (const j of junk) { if (s.endsWith(j) && s.length > j.length + 2) { s = s.slice(0, -j.length).trim(); changed = true } } }
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return null
  const oneToken = !s.includes(' ')
  // still a single run-on slug, has digits, or an obvious 2-letter code prefix → not a real name, drop it
  if (oneToken && (s.length > 11 || /\d/.test(s))) return null
  if (/^[a-z]{2,3}\s/.test(s) && (s.split(' ')[1]?.length ?? 0) > 5) return null   // "bc sklonar…" slug style
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Map real pixel dimensions to the nearest Gemini-supported aspect ratio (so "Original" matches the ad). */
export function nearestAspect(w?: number | null, h?: number | null): string | undefined {
  if (!w || !h) return undefined
  const r = w / h
  const RATIOS: [string, number][] = [['1:1', 1], ['4:5', 0.8], ['5:4', 1.25], ['3:4', 0.75], ['4:3', 1.3333], ['9:16', 0.5625], ['16:9', 1.7778], ['2:3', 0.6667], ['3:2', 1.5]]
  let best = '1:1', bd = Infinity
  for (const [name, val] of RATIOS) { const d = Math.abs(val - r); if (d < bd) { bd = d; best = name } }
  return best
}

/**
 * Build the AI Ad Studio prompt — an ORIGINAL ad design (not a copy of any reference). The attached
 * images are: [inspiration ref designs..., user product photos..., logo?]. Inspirations set the
 * AESTHETIC bar; the industry insights set the WINNING STRUCTURE; the brand kit sets identity; the
 * product stays pixel-faithful. This is the inverse of clone: here creativity/brand lead, but the
 * product is still rendered exactly.
 */
export function buildStudioPrompt(opts: {
  brandName?: string; newHeadline?: string; aspectRatio?: string; hasLogo?: boolean
  numInspirations: number; numProducts: number
  palette?: BrandPalette; colors?: string[]
  fonts?: { heading?: string | null; body?: string | null; headingWeight?: string | null; bodyWeight?: string | null }
  styleTags?: string[]
  insights?: { topHooks?: string[]; topAngles?: string[]; topFormats?: string[]; topEmotions?: string[]; topCtas?: string[] }
  productDesc?: string
  angle?: string          // user-supplied concept/positioning ("quit nicotine naturally — 92% success")
}): string {
  const n = opts.numInspirations
  const firstProductIdx = n + 1
  const pal = opts.palette
  const paletteLine = pal && (pal.accent || pal.background || pal.heading || pal.cta)
    ? `Brand palette (use consistently): ${[
        pal.background && `background ${pal.background}`, pal.accent && `accent ${pal.accent}`,
        pal.heading && `headline ${pal.heading}`, pal.body && `body ${pal.body}`,
        pal.cta && `CTA button ${pal.cta}${pal.ctaText ? ` / ${pal.ctaText} label` : ''}`, pal.icon && `icons ${pal.icon}`,
      ].filter(Boolean).join(', ')}.`
    : (opts.colors?.length ? `Brand colors: ${opts.colors.join(', ')}.` : '')
  const hFont = cleanFontName(opts.fonts?.heading)
  const bFont = cleanFontName(opts.fonts?.body)
  const brandFontHint = [
    hFont && `headings toward "${hFont}"${opts.fonts?.headingWeight ? ` (weight ${opts.fonts.headingWeight})` : ''}`,
    bFont && `body toward "${bFont}"${opts.fonts?.bodyWeight ? ` (weight ${opts.fonts.bodyWeight})` : ''}`,
  ].filter(Boolean).join(', ')
  // When reference designs are attached, typography is DERIVED FROM THEM first (a real brand font
  // is only a nudge). This is the "inspired ad" behavior — a generic default sans is a failure.
  const fontLine = opts.numInspirations > 0
    ? `Typography — DERIVE it from the reference designs (images 1-${opts.numInspirations}): study their headlines and closely echo the typeface CHARACTER (display / high-contrast serif / geometric or grotesque sans), the weight contrast, letter-spacing, case, and the headline-to-body size hierarchy. Pick a characterful typeface that matches that energy.${brandFontHint ? ` Nudge ${brandFontHint} only where it fits that character.` : ''} Do NOT default to plain Arial/Helvetica/system fonts. Use the font as STYLE only — never write a font name on the ad.`
    : (brandFontHint
        ? `Typography: ${brandFontHint} (as style only — never write the font name). Make it distinctive and premium; never plain Arial/Helvetica/system fonts.`
        : `Typography must be DISTINCTIVE and premium — a characterful display/editorial or bold grotesque with strong weight and size hierarchy. Do NOT default to plain Arial/Helvetica/system fonts.`)
  const ins = opts.insights || {}
  const insightLine = [
    ins.topHooks?.length && `proven hook styles: ${ins.topHooks.slice(0, 3).join(', ')}`,
    ins.topAngles?.length && `winning angles: ${ins.topAngles.slice(0, 3).join(', ')}`,
    ins.topFormats?.length && `formats that perform: ${ins.topFormats.slice(0, 2).join(', ')}`,
    ins.topEmotions?.length && `emotional tone: ${ins.topEmotions.slice(0, 2).join(', ')}`,
  ].filter(Boolean).join('; ')
  const styleLine = opts.styleTags?.length ? `Aesthetic direction: ${opts.styleTags.slice(0, 5).join(', ')}.` : ''
  const cta = ins.topCtas?.[0]
  const logoLine = opts.hasLogo
    ? `The FINAL attached image is the brand logo — place it small and tasteful in a corner. If it isn't a clean logo, ignore it (never add a person/scene from it).`
    : ''
  return [
    `TASK: Design ONE brand-new, breathtaking, scroll-stopping advertisement for the user's product${opts.brandName ? ` (brand "${opts.brandName}")` : ''}.`,
    n > 0
      ? `Images 1-${n} are REFERENCE DESIGNS for inspiration ONLY — study their design sophistication: composition, typography energy, color grading, use of negative space, and premium finish. Match that CALIBER of design, but create an ORIGINAL layout. Do NOT copy any single reference or reuse its product, text, or people.`
      : `Aim for a premium, agency-quality, scroll-stopping design.`,
    `Image${opts.numProducts > 1 ? `s ${firstProductIdx}-${firstProductIdx + opts.numProducts - 1}` : ` ${firstProductIdx}`} ${opts.numProducts > 1 ? 'are' : 'is'} the USER'S PRODUCT and it is the HERO of the ad.`,
    `Render the product 1:1 from the photo(s): match its EXACT silhouette, proportions, materials, textures, and on-label branding/text. Do NOT reshape, restyle, or invent a different product.`,
    `SIZE THE PRODUCT REALISTICALLY — this is critical. Render it at its true real-world size RELATIVE TO the scene: a small handheld device must look small in a hand, in correct proportion to fingers, faces, furniture, and surroundings. Keep it to roughly a QUARTER of the frame; never enlarge it, never make it larger-than-life, never let it dominate the composition. If a person holds it, it must look natural in their grip, not oversized. Leave clear negative space around it. It is the only product shown.`,
    opts.productDesc ? `The product is: ${opts.productDesc}.` : '',
    opts.angle ? `The ad's core message/angle is: ${opts.angle}. Build the concept, headline, and supporting copy around THIS.` : '',
    insightLine ? `Ground the concept in what wins in this industry — ${insightLine}.` : '',
    styleLine,
    paletteLine, fontLine,
    opts.newHeadline
      ? `Headline — render EXACTLY, letter for letter: "${opts.newHeadline}". Show this headline in ONE place only.`
      : `Write ONE short, punchy, original headline that fits the angle, and show it in ONE place only. Spell everything correctly in real English.`,
    cta ? `Include a clear call-to-action button ("${cta}").` : `Include a clear call-to-action button.`,
    logoLine,
    `CRITICAL: render every piece of text ONCE — never repeat the headline, subhead, or any text block in two places. No gibberish text, no watermarks, no other brands' logos, no duplicate products.`,
    `CRITICAL: fonts, colors, and hex codes are DESIGN DIRECTIONS, not ad copy — NEVER render a font name, font-family slug, style/class token, or hex color code as visible text anywhere in the image. The only text shown is the headline, supporting copy, and CTA.`,
    opts.aspectRatio && opts.aspectRatio !== 'original' ? `Compose at a ${opts.aspectRatio} aspect ratio.` : `Compose at a 4:5 aspect ratio.`,
    `Output ONE photorealistic, polished, ready-to-publish ad image.`,
  ].filter(Boolean).join(' ')
}

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
  const hFontC = cleanFontName(opts.fonts?.heading)
  const bFontC = cleanFontName(opts.fonts?.body)
  const fontLine = (hFontC || bFontC)
    ? `Use on-brand typography (as the typeface STYLE only — never write the font name on the ad): ${[
        hFontC && `headings in "${hFontC}"${opts.fonts?.headingWeight ? ` weight ${opts.fonts.headingWeight}` : ''}`,
        bFontC && `body text in "${bFontC}"${opts.fonts?.bodyWeight ? ` weight ${opts.fonts.bodyWeight}` : ''}`,
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
    `CRITICAL — STRIP ALL REFERENCE BRANDING: image 1 belongs to a DIFFERENT, competing brand. You MUST completely REMOVE every trace of it — its logo, wordmark, brand name, tagline, and any on-pack/on-screen brand text${opts.brandName ? `, and replace them with "${opts.brandName}" only` : ''}. The finished ad must show ZERO branding from the reference ad (no logos, no brand names, nowhere) — only ${opts.brandName || "the user's"} brand.`,
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
