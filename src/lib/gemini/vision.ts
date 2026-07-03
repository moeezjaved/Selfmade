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
  if (!KEY) return null
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
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
    if (!txt) return null
    const parsed = JSON.parse(txt)
    const asArr = (v: any) => Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []
    const fmt = ['image', 'story', 'carousel'].includes(parsed.format) ? parsed.format : 'image'
    return {
      niche: typeof parsed.niche === 'string' && parsed.niche.trim() ? parsed.niche.trim() : null,
      format: fmt,
      aspect: typeof parsed.aspect === 'string' ? parsed.aspect : null,
      palette: asArr(parsed.palette),
      style_tags: asArr(parsed.style_tags),
      layout_type: typeof parsed.layout_type === 'string' ? parsed.layout_type : null,
    }
  } catch { return null }
}

/**
 * Infer the coarse niche of a product from its photo — so the Ad Studio can pull the right industry
 * insights + inspiration references WITHOUT the user ever setting an industry. Constrained to the
 * niche vocabulary we actually filter on (falls back to null → global insights).
 */
export async function inferNiche(
  image: { mimeType: string; dataB64: string },
  nicheVocab: string[]
): Promise<string | null> {
  if (!KEY || !nicheVocab.length) return null
  const prompt = [
    'Look at this product photo and pick the SINGLE best-matching industry/niche for it.',
    `Choose the exact string from this list, or "none" if truly nothing fits: ${JSON.stringify(nicheVocab)}.`,
    'Return ONLY JSON: {"niche": "<exact list value or none>"}.',
  ].join('\n')
  try {
    const r = await fetch(`${BASE}/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.dataB64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
    const niche = JSON.parse(txt || '{}')?.niche
    if (typeof niche !== 'string' || !niche.trim() || niche.toLowerCase() === 'none') return null
    // Only accept an exact vocab match (case-insensitive) so retrieval keys line up.
    return nicheVocab.find((n) => n.toLowerCase() === niche.trim().toLowerCase()) || null
  } catch { return null }
}
