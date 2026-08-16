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
// Pro MUST default to the real Nano Banana Pro model — NOT flash. Defaulting to flash meant that when
// GEMINI_IMAGE_MODEL_PRO was unset, every "Pro" render (clone/remake — billed at Pro) silently ran on
// flash, which is exactly the "product/copy comes out wrong" regression (e.g. a wooden vape pen drawn
// as a 'duck call'). NEVER-FALL-BACK GUARD: even if the env var is mis-set to a flash id, we refuse it
// and force the real Pro model — a paid Pro render must never quietly become flash.
const PRO_FALLBACK = 'gemini-3-pro-image'
const _rawPro = process.env.GEMINI_IMAGE_MODEL_PRO || PRO_FALLBACK
const MODEL_PRO = /flash/i.test(_rawPro) ? PRO_FALLBACK : _rawPro
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const geminiEnabled = !!KEY
export function modelFor(tier: 'default' | 'pro') { return tier === 'pro' ? MODEL_PRO : MODEL_DEFAULT }

export type ImageInput = { mimeType: string; dataB64: string }
export type GenResult = { ok: true; mimeType: string; dataB64: string; model: string } | { ok: false; error: string }

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

  // MODEL CANDIDATES. Pro is Pro-ONLY — we do NOT silently downgrade to the standard model. The Pro
  // image model (gemini-3-pro-image) periodically 503s ("high demand") on Google's side; when it does
  // we retry HARD (this runs in a 300s background job), and if it still can't, we surface a clear
  // "Pro model is busy — try again in a minute" error and refund — a weaker image would erode trust
  // (all our reference results were made on Pro). imageSize (1K/2K/4K) is Pro-only.
  const candidates = [tier === 'pro' ? MODEL_PRO : modelFor(tier)]
  const RETRYABLE = new Set([429, 500, 502, 503, 504])
  const MAX_TRIES = tier === 'pro' ? 6 : 4   // ride out transient Pro-model 503s before giving up
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
        return { ok: true, mimeType: inline.mime_type || inline.mimeType || 'image/png', dataB64: inline.data, model }
      } catch (e: any) {
        lastErr = String(e?.message || e)
        if (attempt < MAX_TRIES) { await sleep(700 * 2 ** (attempt - 1)); continue }
        break
      }
    }
  }
  // Congestion on Google's Pro model (503/429/overloaded/unavailable) → a clear, retryable message
  // instead of a raw error, so the UI can say "Pro model is busy — try again in a minute."
  const busy = /\b(429|500|502|503|504)\b|overload|unavailable|high demand|resource_exhausted|rate/i.test(lastErr)
  return { ok: false, error: busy ? 'pro_model_busy' : lastErr }
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
  isService?: boolean     // service/app/website brand → no physical product to render as hero
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
    // SERVICE / APP brands have no physical product — the ad sells an outcome, not an object. Never
    // invent a fake product; build a concept-led ad (bold type, a real person mid-benefit, or clean UI).
    opts.isService
      ? `This is a SERVICE / APP / DIGITAL brand — there is NO physical product to show. Do NOT invent, render, or imply a physical product, box, bottle, or device. Build a concept-led ad that sells the OUTCOME/benefit: use bold editorial typography, negative space, and either an abstract brand-colored composition or a real person clearly experiencing the result (relief, delight, success). ${opts.numProducts > 0 ? `Image${opts.numProducts > 1 ? `s ${firstProductIdx}-${firstProductIdx + opts.numProducts - 1}` : ` ${firstProductIdx}`} ${opts.numProducts > 1 ? 'are' : 'is'} the brand's own imagery/app UI/screenshots — use ${opts.numProducts > 1 ? 'them' : 'it'} as an on-screen device mockup or supporting visual, NEVER as a physical object in a scene.` : `No product photos are attached — lead entirely with typography, brand color, and concept.`}`
      : `Image${opts.numProducts > 1 ? `s ${firstProductIdx}-${firstProductIdx + opts.numProducts - 1}` : ` ${firstProductIdx}`} ${opts.numProducts > 1 ? 'are' : 'is'} the USER'S PRODUCT and it is the HERO of the ad.`,
    opts.isService ? '' : `Render the product 1:1 from the photo(s): match its EXACT silhouette, proportions, materials, textures, and on-label branding/text. Do NOT reshape, restyle, or invent a different product.`,
    opts.isService ? '' : `SIZE THE PRODUCT REALISTICALLY — this is critical. Render it at its true real-world size RELATIVE TO the scene: a small handheld device must look small in a hand, in correct proportion to fingers, faces, furniture, and surroundings. Keep it to roughly a QUARTER of the frame; never enlarge it, never make it larger-than-life, never let it dominate the composition. If a person holds it, it must look natural in their grip, not oversized. Leave clear negative space around it. It is the only product shown.`,
    opts.productDesc ? `The ${opts.isService ? 'brand/service' : 'product'} is: ${opts.productDesc}.` : '',
    opts.angle ? `The ad's core message/angle is: ${opts.angle}. Build the concept, headline, and supporting copy around THIS.` : '',
    insightLine ? `Ground the concept in what wins in this industry — ${insightLine}.` : '',
    styleLine,
    paletteLine, fontLine,
    opts.newHeadline
      ? `Headline — render EXACTLY, letter for letter: "${opts.newHeadline}". Show this headline in ONE place only.`
      : `Write ONE short, punchy, original headline that fits the angle, and show it in ONE place only. Spell everything correctly in real English.`,
    cta ? `Include a clear call-to-action button ("${cta}").` : `Include a clear call-to-action button.`,
    logoLine,
    `CRITICAL — TEXT ACCURACY: spell EVERY word correctly (e.g. "Tomatoes" not "Tomotoees", "oregano" not "oreano"); if unsure of a word, use a simpler one. NEVER repeat a word inside a phrase (never "Italian Italian FLAVOR", "Flavor Flavor") and never render the same text block in two places. Proofread all text before finalizing.`,
    `KEEP TEXT MINIMAL — every extra word risks a misspelling. Show only: the headline, an optional ONE-line subhead, at most TWO very short feature labels (2–3 words each, e.g. "Herb Infused" — no long descriptions), and the CTA button. Use short, common, real English words. No gibberish, no watermarks, no other brands' logos, no duplicate products.`,
    `CRITICAL: fonts, colors, and hex codes are DESIGN DIRECTIONS, not ad copy — NEVER render a font name, font-family slug, style/class token, or hex color code as visible text anywhere in the image. The only text shown is the headline, supporting copy, and CTA.`,
    opts.aspectRatio && opts.aspectRatio !== 'original' ? `Compose at a ${opts.aspectRatio} aspect ratio.` : `Compose at a 4:5 aspect ratio.`,
    `Output ONE photorealistic, polished, ready-to-publish ad image.`,
  ].filter(Boolean).join(' ')
}

export function buildClonePrompt(opts: {
  brandName?: string; colors?: string[]; newHeadline?: string; aspectRatio?: string; hasLogo?: boolean
  productDesc?: string   // short "what the product is" (e.g. "pesto sauce jar") — grounds scene/copy adaptation
  productPrice?: string | null   // the user's real price, if they set one — used to replace the original's price
  look?: string          // recast the on-camera person: 'match' (default, keep original) or an ethnicity/look
  palette?: BrandPalette
  fonts?: { heading?: string | null; body?: string | null; headingWeight?: string | null; bodyWeight?: string | null }
  dna?: { hook_type?: string | null; format_style?: string | null; angle?: string | null; emotion?: string[] | null; cta?: string | null }
  isService?: boolean    // SERVICE/app brand → clone the layout but NEVER render a physical product
}): string {
  // ── SERVICE branch — separate return so the physical-product prompt below is byte-identical to
  // before. A service/app/website ad has NO physical product: never invent a bottle/box/jar. ──
  if (opts.isService) {
    const b = opts.brandName ? `"${opts.brandName}"` : "the user's brand"
    const dS = opts.dna || {}
    const keepS = [dS.hook_type && `hook style (${dS.hook_type})`, dS.format_style && `visual format (${dS.format_style})`, dS.angle && `angle (${dS.angle})`].filter(Boolean).join(', ')
    const recastS = opts.look && opts.look.toLowerCase() !== 'match'
      ? `• RECAST the person shown: fully replace them with a ${opts.look} model — do NOT keep the original person's face or features. Keep the EXACT same pose, framing, expression, hand position and lighting; only the person changes. It must look like the same ad reshot with a new ${opts.look} model.` : ''
    const brandStyleS = [
      opts.palette?.accent || opts.palette?.background ? `brand colors: ${[opts.palette?.background && `bg ${opts.palette.background}`, opts.palette?.accent && `accent ${opts.palette.accent}`].filter(Boolean).join(', ')}` : (opts.colors?.length ? `brand colors ${opts.colors.join(', ')}` : ''),
    ].filter(Boolean).join(' ')
    return [
      `Clone the winning ad in image 1 into an ad for a SERVICE / app / website${opts.brandName ? ` by ${b}` : ''}. Keep image 1's layout, composition, structure${keepS ? `, and ${keepS}` : ''}, and premium quality — with these changes:`,
      opts.productDesc
        ? `• WHAT ${b} ACTUALLY IS: ${opts.productDesc}. EVERY word of copy on the ad (headline, bullets, benefits, comparisons, CTA) must be about THIS — never guess the business from the brand name, and never write about a different kind of product or service.`
        : `• You are NOT told what ${b} does — so keep all copy generic to the brand name and image 1's structure; do NOT invent a business category, features or benefits.`,
      `• CRITICAL: this brand has NO physical product. NEVER invent, add or render any bottle, jar, box, package, device or physical item. If image 1 shows a physical product, REPLACE it — with the app/website shown on a phone or laptop screen, the brand logo, an abstract/graphic treatment, or a relevant person/lifestyle scene — never a made-up object.`,
      opts.hasLogo ? `• The attached image is the brand's logo or an app/site screenshot: feature it naturally (logo placed cleanly; a screenshot shown on a device screen).` : `• If no logo/screenshot is provided, represent the service through typography, the brand name, and a relevant lifestyle scene — not an object.`,
      recastS,
      `• Branding: every visible logo, name and label belongs to ${b} only.`,
      `• Price: do NOT invent a price, discount or claim. If image 1 shows a price badge and none is given, omit it.`,
      opts.newHeadline ? `Headline, rendered exactly: "${opts.newHeadline}".` : `Write one short, punchy headline about what the service does.`,
      dS.cta ? `Include a clear CTA button ("${dS.cta}").` : '',
      brandStyleS ? `Use on-brand styling where it fits: ${brandStyleS}.` : '',
      `Spell every word correctly, never repeat a word, invent NO numbers or claims, keep on-image text minimal. No gibberish, no watermarks.`,
      opts.aspectRatio && opts.aspectRatio !== 'original' ? `Compose at a ${opts.aspectRatio} aspect ratio.` : `Keep the same aspect ratio as image 1.`,
      `Output one photorealistic, ready-to-publish ad image.`,
    ].filter(Boolean).join(' ')
  }
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
  // Keep this SHORT and POSITIVELY PHRASED. Two lessons learned the hard way:
  // (1) a bloated prompt (dozens of CRITICAL rules) confuses the model into copying the reference —
  //     a concise brief, like a person's one-line ask, reproduces the layout AND does the swaps;
  // (2) image models weight every concept the prompt MENTIONS and handle negation poorly — each
  //     "remove the competitor's logo/product" line conditions the output ON those things. So state
  //     only the desired end state (whose product/brand appears), never what must be absent.
  const brand = opts.brandName ? `"${opts.brandName}"` : "the user's brand"
  // Recast the person (optional). Default 'match' keeps image 1's model — same pose/framing/lighting.
  const recast = opts.look && opts.look.toLowerCase() !== 'match'
    ? `• Person: RECAST the model as ${opts.look} — fully replace the person, do NOT keep the original face or features. Keep the EXACT same pose, framing, hand position, expression, lighting and composition; only the person changes. It must read as the same ad reshot with a new ${opts.look} model, photorealistic and natural.`
    : ''
  // Price/number rule — NEVER invent. Use the user's real price if given; otherwise drop the price.
  const priceRule = opts.productPrice
    ? `• Price: wherever image 1 shows a price, show "${opts.productPrice}" instead — never any other number.`
    : `• Price: do NOT invent a price. If image 1 shows a price tag/badge and none is given for the user's product, OMIT the price entirely (remove the badge) — never make up a number, discount, or claim.`
  return [
    `Clone the winning ad in image 1 into an ad for the USER'S product${opts.productDesc ? ` (${opts.productDesc})` : ''}${opts.brandName ? ` by brand ${brand}` : ''}, shown in the image(s) after it. Keep image 1's layout, composition, structure${keep ? `, and ${keep}` : ''}, and premium quality — with these swaps:`,
    `• Product: exactly ONE product appears — the user's, rendered precisely from its photo: its own real shape, proportions, label text and colors, even when that shape differs completely from image 1's product (e.g. a jar in place of a dropper bottle).`,
    `• Product state: preserve the product's PHYSICAL STATE from image 1 — if the reference shows it open / cap off / dropper out / lid removed / mid-use, show the user's product in that SAME open, in-use state (don't seal or cap a product the original showed open).`,
    recast,
    `• Branding: every visible logo, brand name, tagline and label in the final ad belongs to ${brand} only.`,
    `• Scene & copy: the background, props and all supporting text fit the user's product and what it is.`,
    priceRule,
    opts.newHeadline ? `Headline, rendered exactly: "${opts.newHeadline}".` : `Write one short, punchy headline that fits the user's product.`,
    d.cta ? `Include a clear CTA button ("${d.cta}").` : '',
    brandStyle ? `Use on-brand styling where it fits: ${brandStyle}.` : '',
    logoLine,
    `Spell every word correctly, never repeat a word, invent NO numbers or claims, keep on-image text minimal. No gibberish, no watermarks.`,
    opts.aspectRatio && opts.aspectRatio !== 'original' ? `Compose at a ${opts.aspectRatio} aspect ratio.` : `Keep the same aspect ratio as image 1.`,
    `Output one photorealistic, ready-to-publish ad image.`,
  ].filter(Boolean).join(' ')
}

// ── Verify-and-retry QA (post-generation) ─────────────────────────────────────
// A cheap Gemini Flash TEXT call that inspects the generated ad against the user's product photo.
// This is the durable reliability lever: instead of hardening the generation prompt every time a
// failure mode appears (which bloats it and CAUSES the next failure), the checker catches bad
// outputs before the user sees them and the route regenerates. New failure mode → new CHECK here,
// never a new paragraph in buildClonePrompt.
const MODEL_VERIFY = process.env.GEMINI_VERIFY_MODEL || 'gemini-2.5-flash'

export type CloneVerdict = {
  pass: boolean
  productMatches: boolean      // generated ad shows the user's product (shape/label from its photo)
  brandingClean: boolean       // no branding other than the user's brand
  textClean: boolean           // no misspelled/duplicated/gibberish text
  fix?: string                 // ONE short corrective sentence for the retry prompt
}

/**
 * Inspect a generated clone. images = [generated ad, user's product photo].
 * Fails OPEN (pass:true) on any API error — QA must never block a paying user's result.
 */
export async function verifyClonedAd(generated: ImageInput, product: ImageInput, brandName?: string): Promise<CloneVerdict> {
  const OPEN: CloneVerdict = { pass: true, productMatches: true, brandingClean: true, textClean: true }
  if (!KEY) return OPEN
  const prompt = [
    `Image 1 is an AI-generated ad. Image 2 is the real product it must feature${brandName ? ` (brand "${brandName}")` : ''}. Inspect image 1 strictly and answer with ONLY this JSON:`,
    `{"productMatches":bool,  // image 1's product has the same shape, packaging type, label and colors as image 2 (not a different product or the wrong container type)`,
    ` "brandingClean":bool,   // every logo/brand name/label in image 1 belongs to ${brandName ? `"${brandName}"` : "the product's own brand as seen in image 2"} — no other company's branding anywhere`,
    ` "textClean":bool,       // all visible text is correctly spelled real English with no duplicated words or repeated text blocks`,
    ` "fix":string}           // if anything is false: ONE short imperative sentence telling an image model what to correct; else ""`,
  ].join('\n')
  try {
    const r = await fetch(`${BASE}/${MODEL_VERIFY}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: geminiImageMime(generated.mimeType) || 'image/png', data: generated.dataB64 } },
          { inline_data: { mime_type: geminiImageMime(product.mimeType) || 'image/jpeg', data: product.dataB64 } },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    })
    if (!r.ok) return OPEN
    const j = await r.json()
    const raw = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
    const v = JSON.parse(raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim())
    const productMatches = v.productMatches !== false
    const brandingClean = v.brandingClean !== false
    const textClean = v.textClean !== false
    return {
      pass: productMatches && brandingClean && textClean,
      productMatches, brandingClean, textClean,
      fix: typeof v.fix === 'string' && v.fix.trim() ? v.fix.trim().slice(0, 200) : undefined,
    }
  } catch { return OPEN }
}

/**
 * Describe the user's product in a few words ("pesto sauce jar") for prompt grounding — the detail
 * the proven-good human prompt ("clone first ad into my pesto sauce ad") had and ours lacked.
 * Best-effort: returns null on any failure and the clone proceeds without it.
 */
export async function describeProduct(product: ImageInput): Promise<string | null> {
  if (!KEY) return null
  try {
    const r = await fetch(`${BASE}/${MODEL_VERIFY}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Describe this product in 3-6 plain words (what it is + container type, e.g. "pesto sauce in a glass jar"). Reply with ONLY the phrase — no punctuation, no brand commentary.' },
          { inline_data: { mime_type: geminiImageMime(product.mimeType) || 'image/jpeg', data: product.dataB64 } },
        ] }],
        generationConfig: { temperature: 0 },
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    const t = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim()
    return t && t.length <= 80 ? t.replace(/^["']|["'.]$/g, '') : null
  } catch { return null }
}
