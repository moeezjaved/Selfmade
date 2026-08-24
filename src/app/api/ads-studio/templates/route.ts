/**
 * Personalized Templates for the workspace Home — the wow-factor landing.
 * GET  ?domain=…       → template BRIEFS (title + concept + on-image headline + a rich, fact-grounded
 *                         scene/angle) from the store's Brand Kit, cached on the brand. Includes any
 *                         already-generated images.
 * POST { domain, index, ... } → generate ONE template's image with the Pro engine, FREE (no credit
 *                         charge — it's a gift), and cache it. The client fires these a few at a time so
 *                         the cards fill in progressively.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { getSavedKit } from '@/lib/ads-studio/brandkit-store'
import { buildBrandKit } from '@/lib/ads-studio/brandkit'
import { renderAdFree } from '@/lib/ads-studio/render'
import { llm } from '@/lib/llm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const cleanDomain = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()

type Tpl = { title: string; concept: string; headline: string; angle: string; image?: string | null }

/**
 * The 10 template types, each with a LOCKED visual STYLE (so Social Story is always a vibrant
 * illustration, Sale is always a loud comic poster, Product Showcase is always a clean product photo,
 * etc.) — the LLM only adapts the COPY/subject to the brand; the style never drifts to "photo of a
 * person" for every type. `style` is the fixed art-direction; the LLM fills `content` per brand.
 */
const CATALOG: { title: string; concept: string; style: string }[] = [
  { title: 'Free Trial CTA', concept: 'A clean CTA card offering a risk-free trial with a benefit checklist.', style: 'STYLE: a clean, minimal GRAPHIC CTA card (not a photo of a person). The product sits as a hero on a soft brand-colored background, a short benefit checklist with tick icons, and a large prominent primary "Start Free Trial" button with a small "cancel anytime" line. Premium, uncluttered, lots of whitespace.' },
  { title: 'Event Promotion', concept: 'A polished event flyer with date, time and a register CTA.', style: 'STYLE: a polished EVENT FLYER layout. A clear event headline, a "DATE" and "TIME" row, an elegant structured composition with the product featured, and a "Register Now" button. Professional, organized, brand colors — graphic-design feel, not a candid photo.' },
  { title: 'Testimonial Ad', concept: 'A happy-customer quote over a warm lifestyle photo.', style: 'STYLE: a warm PHOTOGRAPHIC lifestyle shot of ONE happy real customer using the product, with a short customer QUOTE overlaid and a subtle 5-star rating. Natural light, authentic, trustworthy.' },
  { title: 'LinkedIn B2B Ad', concept: 'A corporate, credibility-led ad for a professional audience.', style: 'STYLE: a professional CORPORATE photo (a modern office / meeting-room setting with people in business attire) with the product present, plus a tidy checklist of benefits and an "Explore B2B solutions" button. Restrained, premium, credibility-led — NOT flashy or discounty.' },
  { title: 'Feature Highlight', concept: 'The product with clean callouts pointing to its key features.', style: 'STYLE: a crisp PRODUCT photograph (no human) with clean annotation lines and small labels pointing to 2-3 key features of the product. Minimal, technical-premium, generous whitespace, one short header.' },
  { title: 'Brand Awareness', concept: 'A calm, premium brand moment with the logo and one promise.', style: 'STYLE: a calm, premium BRAND-MOMENT image — editorial and elegant, the logo prominent, a serene minimal composition (the product or an abstract on-brand scene), soft palette, and ONE short promise line. Quiet and aspirational.' },
  { title: 'Lifestyle Scene', concept: 'A cinematic, aspirational moment of someone using the product.', style: 'STYLE: a cinematic PHOTOGRAPHIC lifestyle moment — a person naturally using the product in a real, aspirational setting, beautiful natural light, shallow depth of field, minimal text.' },
  { title: 'Social Media Story', concept: 'A vibrant illustrated vertical story with a bold hook.', style: 'STYLE: a BOLD FLAT VECTOR ILLUSTRATION (explicitly NOT a photograph and NOT photorealistic) — a vibrant, brand-colored illustrated design with playful organic shapes/blobs, an illustrated hand holding the product, a big confident headline and a "Swipe up" CTA. Modern, graphic, energetic — like a designed Instagram story.' },
  { title: 'Sale Campaign', concept: 'A loud, high-energy limited-time sale poster.', style: 'STYLE: a LOUD high-energy COMIC/POP sale poster — bold red & yellow, starbursts and speech-bubble shapes, a big discount %, a crossed-out price, "ENDS IN 24 HRS" urgency, and a "Shop the Sale" button. Playful and punchy.' },
  { title: 'Product Showcase', concept: 'A clean premium studio shot of the hero product.', style: 'STYLE: a clean premium STUDIO PRODUCT photograph (no human) — the hero product on a minimal brand-colored surface, soft directional light, elegant shadows, one short benefit line and a "Shop now" button.' },
]

async function briefs(siteName: string, facts: string[], voice: any): Promise<Tpl[]> {
  const fixed = (contents: Record<string, { headline: string; content: string }>): Tpl[] =>
    CATALOG.map((c) => {
      const cc = contents[c.title] || { headline: '', content: '' }
      return { title: c.title, concept: c.concept, headline: cc.headline || '', angle: `${c.style}\nBRAND CONTENT (adapt to this brand, keep the STYLE above): ${cc.content || c.concept}` }
    })
  if (!facts.length) return fixed({})
  const prompt = `You are Mello, a world-class creative director. For EACH of these fixed ad-template TYPES, write the brand-specific COPY and SUBJECT — grounded entirely in the brand's real knowledge (never invent offers, prices or claims). Do NOT change the template's visual style; only adapt what it says and what it shows for THIS brand.

BRAND: ${siteName}
VOICE: ${voice ? `${voice.tone}, ${voice.energy} energy, for ${voice.audience}` : '(unknown)'}
KNOWLEDGE (use specifics — materials, mechanism, audience, positioning, benefits):
${facts.slice(0, 18).map((f) => `- ${f}`).join('\n')}

TEMPLATE TYPES: ${CATALOG.map((c) => c.title).join(', ')}

For each type return: a short on-image "headline" (<= 7 words, on-brand) and a "content" line (1-2 sentences naming the concrete brand subject, benefit, feature or offer this template should feature — e.g. which product, which differentiator, which use-case — grounded in the knowledge).

Return ONLY JSON: {"templates":{"Free Trial CTA":{"headline":"...","content":"..."},"Event Promotion":{"headline":"...","content":"..."}, ...one key per type...}}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 2000, temperature: 0.5, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    const raw = j?.templates && typeof j.templates === 'object' ? j.templates : {}
    const contents: Record<string, { headline: string; content: string }> = {}
    for (const c of CATALOG) { const v = raw[c.title]; if (v) contents[c.title] = { headline: String(v.headline || '').slice(0, 100), content: String(v.content || '').slice(0, 240) } }
    return fixed(contents)
  } catch { return fixed({}) }
}

const TEMPLATES_VERSION = 'v2-catalog-10'   // bump to invalidate cached templates when the catalog/styles change
async function readCached(admin: any, brandId: string): Promise<Tpl[] | null> {
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const ads = data?.brand_kit?.adsStudio
  if (ads?.templatesVersion !== TEMPLATES_VERSION) return null   // stale catalog → regenerate
  const c = ads?.templates
  return Array.isArray(c) && c.length ? c : null
}
async function writeCached(admin: any, brandId: string, templates: Tpl[]): Promise<void> {
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const existing = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
  const ads = existing.adsStudio || {}
  await admin.from('brands').update({ brand_kit: { ...existing, adsStudio: { ...ads, templates, templatesVersion: TEMPLATES_VERSION } } }).eq('id', brandId)
}

export async function GET(req: NextRequest) {
  const domain = cleanDomain(req.nextUrl.searchParams.get('domain') || '')
  if (!domain || !domain.includes('.')) return NextResponse.json({ templates: [] })
  try {
    const admin = createAdminClient() as any
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    const brandId = user ? await resolveActiveBrandId(admin, user.id).catch(() => null) : null

    if (brandId) { const cached = await readCached(admin, brandId); if (cached) return NextResponse.json({ templates: cached, canGenerate: !!user }) }

    const kit = brandId ? await getSavedKit(admin, brandId, domain) : null
    const facts = kit?.facts?.length ? kit.facts : (await buildBrandKit(domain).catch(() => null))?.facts || []
    const tpls = await briefs(kit?.siteName || domain, facts, kit?.voice)
    if (brandId) await writeCached(admin, brandId, tpls).catch(() => {})
    return NextResponse.json({ templates: tpls, canGenerate: !!user })
  } catch (e: any) {
    const fallback = CATALOG.map((c) => ({ title: c.title, concept: c.concept, headline: '', angle: c.style }))
    return NextResponse.json({ templates: fallback, canGenerate: false, error: String(e?.message || e).slice(0, 160) })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const domain = cleanDomain(String(body.domain || ''))
  const index = Number(body.index)
  if (!domain || !Number.isInteger(index)) return NextResponse.json({ error: 'domain + index required' }, { status: 400 })
  try {
    const admin = createAdminClient() as any
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return NextResponse.json({ error: 'sign-in-required' }, { status: 401 })
    const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
    if (!brandId) return NextResponse.json({ error: 'no-brand' }, { status: 400 })

    const tpls = await readCached(admin, brandId)
    if (!tpls || !tpls[index]) return NextResponse.json({ error: 'no-template' }, { status: 404 })
    if (tpls[index].image) return NextResponse.json({ image: tpls[index].image })   // already generated

    const t = tpls[index]
    // FREE generation — same Pro engine, no credit reserve.
    const out = await renderAdFree(admin, user.id, brandId, {
      productImages: (body.productImages || []).filter(Boolean),
      headline: t.headline, angle: t.angle, aspectRatio: '4:5',
      colors: body.colors, fonts: body.fonts, logo: body.logo, brandName: body.brandName, productDesc: body.productDesc,
    })
    if (!out?.url && !out?.image) return NextResponse.json({ error: 'generation-failed' }, { status: 502 })
    const img = out.url || out.image
    tpls[index] = { ...t, image: img }
    await writeCached(admin, brandId, tpls).catch(() => {})
    return NextResponse.json({ image: img })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
