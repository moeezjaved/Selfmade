/**
 * Shared helpers for the Page Builder generation pipeline — brand-voice loading and image plumbing.
 * Kept separate so products/personas/generate all ground copy in the SAME real brand signals and reuse
 * one image-download path. Everything here is best-effort: a missing brand or a dead image URL degrades
 * gracefully (never throws), because a page must still generate for a brand-new store.
 */
import { generateImage, geminiImageMime, describeProduct, type ImageInput } from '@/lib/gemini/image'
import { uploadBufferToR2 } from '@/lib/r2'

/**
 * What the product ACTUALLY is, read from its own photo (vision) — e.g. "light pink graphic t-shirt".
 * This is the single most important grounding signal: it stops the copy from drifting to the brand's
 * category when the product is something else. Best-effort — null if there's no image or vision fails.
 */
export async function productVision(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null
  try {
    const ref = await fetchImageInput(imageUrl)
    if (!ref) return null
    return await describeProduct(ref)
  } catch { return null }
}

/** The real brand voice we ground copy in — tone/USPs from the brand row + the remembered category. */
export interface BrandVoice {
  name: string
  industry: string
  tone: string
  usps: string
  category: string
  description: string
}

const asText = (v: any): string => (Array.isArray(v) ? v.filter(Boolean).join(', ') : (v == null ? '' : String(v)))

/**
 * Load the active brand's voice: tone + USPs from `brands`, plus the remembered category/description
 * from the Company Brain (describeBrand). Never throws — returns empty strings if nothing is known.
 */
export async function loadBrandVoice(admin: any, userId: string, brandId?: string | null): Promise<BrandVoice> {
  const out: BrandVoice = { name: '', industry: '', tone: '', usps: '', category: '', description: '' }
  try {
    let q = admin.from('brands').select('name, industry, tone, usps').eq('user_id', userId)
    q = brandId ? q.eq('id', brandId) : q.order('created_at', { ascending: false })
    const { data } = await q.limit(1).maybeSingle()
    if (data) {
      out.name = asText(data.name)
      out.industry = asText(data.industry)
      out.tone = asText(data.tone)
      out.usps = asText(data.usps)
    }
  } catch { /* brand row optional */ }
  try {
    const { describeBrand } = await import('@/lib/geo/understand')
    const u = await describeBrand(admin, userId, brandId ?? null).catch(() => null)
    if (u) {
      out.category = u.category || out.category
      out.description = u.description || out.description
      if (!out.name && u.brandName) out.name = u.brandName
    }
  } catch { /* Company Brain optional */ }
  return out
}

/** A short brand-voice brief injected into every copy/persona prompt. Empty-safe. */
export function voiceBrief(v: BrandVoice): string {
  const lines = [
    v.name && `Brand: ${v.name}`,
    v.category && `Category: ${v.category}`,
    v.description && `What it is: ${v.description}`,
    v.industry && `Industry: ${v.industry}`,
    v.tone && `Brand voice / tone: ${v.tone}`,
    v.usps && `USPs / edge: ${v.usps}`,
  ].filter(Boolean)
  return lines.length ? lines.join('\n') : 'No brand voice on file — write in a warm, credible, first-person DTC voice.'
}

/** Download an image URL and return it as a Gemini ImageInput (base64). null on any failure. */
export async function fetchImageInput(url: string): Promise<ImageInput | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.byteLength < 500) return null
    const head = buf.subarray(0, 64)
    const mime = geminiImageMime(r.headers.get('content-type'), head)
    if (!mime) return null
    return { mimeType: mime, dataB64: buf.toString('base64') }
  } catch { return null }
}

/**
 * AI-generate ONE image from a constrained prompt + an optional product reference, and host it on R2.
 * Returns the public URL, or null if generation/upload fails (caller leaves the slot empty → placeholder).
 */
export async function generateAndHost(
  prompt: string,
  reference: ImageInput | null,
  keyPrefix: string,
  opts?: { aspectRatio?: string },
): Promise<string | null> {
  try {
    const res = await generateImage(prompt, reference ? [reference] : [], 'default', { aspectRatio: opts?.aspectRatio || '1:1' })
    if (!res.ok) return null
    const buf = Buffer.from(res.dataB64, 'base64')
    const ext = res.mimeType.includes('png') ? 'png' : 'jpg'
    const key = `builder/${keyPrefix}-${buf.length}.${ext}`
    return await uploadBufferToR2(buf, key, res.mimeType)
  } catch { return null }
}

/** Stable, URL-safe slug from arbitrary text. */
export function slugify(s: string, fallback = 'item'): string {
  const out = String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  return out || fallback
}

/** Robustly parse a JSON object from an LLM response (strips code fences + surrounding prose). */
export function parseJsonObject(text: string): any {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)) } catch { /* noop */ } }
  return null
}
