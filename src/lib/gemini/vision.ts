/**
 * Gemini vision — classify an inspiration ad image into structured tags so the Ad Studio can
 * retrieve the right references per user industry/format. Runs ONCE per image at import time.
 * Uses a text-out multimodal model (gemini-2.5-flash) and asks for strict JSON.
 */
const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash'
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export type InspirationTags = {
  niche: string | null
  format: 'image' | 'story' | 'carousel'
  aspect: string | null
  palette: string[]
  style_tags: string[]
  layout_type: string | null
}

/**
 * @param nicheVocab optional list of coarse niches to constrain the `niche` field to (keeps it
 *   aligned with discovery_ads_index.niche so retrieval matches). Free-text if omitted.
 */
export async function classifyInspiration(
  image: { mimeType: string; dataB64: string },
  nicheVocab?: string[]
): Promise<InspirationTags | null> {
  return (await classifyInspirationDebug(image, nicheVocab)).tags
}

/** Same as classifyInspiration but returns the failure reason (for admin diagnostics). */
export async function classifyInspirationDebug(
  image: { mimeType: string; dataB64: string },
  nicheVocab?: string[]
): Promise<{ tags: InspirationTags | null; error?: string }> {
  if (!KEY) return { tags: null, error: 'GEMINI_API_KEY not set' }
  const nicheLine = nicheVocab?.length
    ? `"niche": pick the SINGLE best match from this list (exact string), or null if none fit: ${JSON.stringify(nicheVocab)}.`
    : `"niche": a short lowercase industry/niche label (e.g. "skincare", "supplements", "apparel"), or null.`
  const prompt = [
    'You are tagging a high-performing advertisement image for a design-inspiration library.',
    'Return ONLY a JSON object (no markdown, no prose) with exactly these keys:',
    nicheLine,
    '"format": one of "image", "story" (tall 9:16), "carousel".',
    '"aspect": the closest of "1:1","4:5","9:16","16:9","3:4","2:3" to the image\'s shape.',
    '"palette": array of 2-5 dominant colors as hex strings (e.g. "#0A0A0A").',
    '"style_tags": array of 2-5 short lowercase design descriptors (e.g. "minimal","bold-type","editorial","gradient","luxury","playful","high-contrast").',
    '"layout_type": one short label for the composition (e.g. "hero-product","before-after","testimonial","stat-callout","lifestyle","packshot").',
  ].join('\n')

  try {
    const r = await fetch(`${BASE}/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.dataB64 } }] }],
        generationConfig: { temperature: 0.1 },
      }),
    })
    if (!r.ok) return { tags: null, error: `gemini ${r.status} [${MODEL}]: ${(await r.text().catch(() => '')).slice(0, 200)}` }
    const j = await r.json()
    let txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim()
    if (!txt) return { tags: null, error: `no text in response (finishReason: ${j?.candidates?.[0]?.finishReason || '?'})` }
    // Strip ```json fences the model sometimes adds.
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const jsonSlice = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)
    const parsed = JSON.parse(jsonSlice || txt)
    const asArr = (v: any) => Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []
    const fmt = ['image', 'story', 'carousel'].includes(parsed.format) ? parsed.format : 'image'
    return { tags: {
      niche: typeof parsed.niche === 'string' && parsed.niche.trim() && parsed.niche.toLowerCase() !== 'null' ? parsed.niche.trim() : null,
      format: fmt,
      aspect: typeof parsed.aspect === 'string' ? parsed.aspect : null,
      palette: asArr(parsed.palette),
      style_tags: asArr(parsed.style_tags),
      layout_type: typeof parsed.layout_type === 'string' ? parsed.layout_type : null,
    } }
  } catch (e: any) { return { tags: null, error: `parse/throw: ${String(e?.message || e).slice(0, 200)}` } }
}

/**
 * Infer the coarse niche of a product from its photo — so the Ad Studio can pull the right industry
 * insights + inspiration references WITHOUT the user ever setting an industry. Constrained to the
 * niche vocabulary we actually filter on (falls back to null → global insights).
 */
export async function inferNiche(
  image: { mimeType: string; dataB64: string } | null,
  nicheVocab: string[],
  context?: { brandName?: string; description?: string; website?: string }
): Promise<string | null> {
  if (!KEY || !nicheVocab.length) return null
  // Brand NAME/DESCRIPTION are far more reliable than the product photo alone (a sleek nicotine
  // device can look like skincare). Lead with the text context; the photo is a secondary signal.
  const ctx = [
    context?.brandName && `Brand name: ${context.brandName}`,
    context?.description && `Brand description: ${String(context.description).slice(0, 400)}`,
    context?.website && `Website: ${context.website}`,
  ].filter(Boolean).join('\n')
  const prompt = [
    'Pick the SINGLE best-matching industry/niche for this brand/product.',
    ctx ? `Use the brand context as the PRIMARY signal (the product photo can be misleading):\n${ctx}` : 'Judge from the product photo.',
    `Choose the exact string from this list, or "none" if truly nothing fits: ${JSON.stringify(nicheVocab)}.`,
    'Return ONLY JSON: {"niche": "<exact list value or none>"}.',
  ].join('\n')
  const parts: any[] = [{ text: prompt }]
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.dataB64 } })
  try {
    const r = await fetch(`${BASE}/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0 } }),
    })
    if (!r.ok) return null
    const j = await r.json()
    let txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim()
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const slice = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)
    const niche = JSON.parse(slice || '{}')?.niche
    if (typeof niche !== 'string' || !niche.trim() || niche.toLowerCase() === 'none') return null
    // Only accept an exact vocab match (case-insensitive) so retrieval keys line up.
    return nicheVocab.find((n) => n.toLowerCase() === niche.trim().toLowerCase()) || null
  } catch { return null }
}

/**
 * CRO vision critique — given rendered screenshots (desktop + mobile, above-the-fold) and a rubric
 * prompt, return the model's raw JSON text. The caller owns the prompt + parsing (see lib/cro/audit).
 * Multi-image: pass any of { desktop, mobile } as base64 JPEG. Returns '' on any failure (fail-open).
 */
export async function critiqueScreens(
  images: { desktop?: string | null; mobile?: string | null },
  prompt: string,
): Promise<string> {
  if (!KEY) return ''
  const parts: any[] = [{ text: prompt }]
  if (images.desktop) parts.push({ text: 'DESKTOP (above the fold):' }, { inline_data: { mime_type: 'image/jpeg', data: images.desktop } })
  if (images.mobile) parts.push({ text: 'MOBILE (above the fold):' }, { inline_data: { mime_type: 'image/jpeg', data: images.mobile } })
  if (parts.length === 1) return ''   // no images
  try {
    const r = await fetch(`${BASE}/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 1600 } }),
    })
    if (!r.ok) return ''
    const j = await r.json()
    return (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim()
  } catch { return '' }
}
