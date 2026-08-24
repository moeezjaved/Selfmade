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

const FALLBACK: Tpl[] = [
  { title: 'Product Showcase', concept: 'Your hero product, clean studio look, one benefit line and a Shop Now.', headline: 'Your healthy alternative.', angle: 'A premium studio product shot of the hero product on a clean brand-colored surface, soft light, one short benefit line and a clear Shop Now button.' },
  { title: 'Social Media Story', concept: 'Vertical story with a bold hook and a swipe-up to find your bestseller.', headline: 'Break up with your bad habit', angle: 'A bold vertical social story, big confident headline, the product held in-hand, energetic but on-brand, swipe-up CTA.' },
  { title: 'Sale Campaign', concept: 'High-energy limited-time offer with your discount and urgency.', headline: 'Biggest ever sale', angle: 'A high-energy sale creative with a limited-time offer, urgency, brand colors, the product as hero and a Shop the Sale button.' },
  { title: 'Testimonial Ad', concept: 'A happy-customer quote over a lifestyle shot to build trust.', headline: 'A real change.', angle: 'A warm lifestyle photo of a happy customer using the product, a short quote overlay and a subtle rating to build trust.' },
  { title: 'Feature Highlight', concept: 'Call out your top differentiator with a crisp visual and label.', headline: 'What makes us different', angle: 'A crisp feature-callout layout pointing to the product’s key differentiators with small labels, clean and premium.' },
  { title: 'Brand Awareness', concept: 'A calm, premium brand moment — your logo, mood and one promise.', headline: 'Find your calm.', angle: 'A calm, premium brand-moment image, the logo, a serene mood and one short promise line.' },
]

async function briefs(siteName: string, facts: string[], voice: any): Promise<Tpl[]> {
  if (!facts.length) return FALLBACK
  const prompt = `You are Mello, a world-class creative director. From this brand's REAL knowledge, design 6-9 personalized ad TEMPLATES the founder will love — grounded entirely in what the brand is and sells (never invent offers, prices or claims). Vary them: product showcase, social story, sale/offer, testimonial/social-proof, feature highlight, lifestyle/use-case, a platform-specific one, brand awareness.

BRAND: ${siteName}
VOICE: ${voice ? `${voice.tone}, ${voice.energy} energy, for ${voice.audience}` : '(unknown)'}
KNOWLEDGE (use specifics — materials, mechanism, audience, positioning):
${facts.slice(0, 18).map((f) => `- ${f}`).join('\n')}

For EACH template return:
- "title": 2-4 words
- "concept": one sentence describing the template idea
- "headline": the punchy on-image headline (<= 7 words), on-brand
- "angle": a RICH art-direction paragraph (2-4 sentences) describing the exact scene, subject, composition, mood, who is in it and what they're doing, and the on-brand feel — specific enough for an image model to render a beautiful, on-message ad. Ground it in the real product and audience.

Return ONLY JSON: {"templates":[{"title":"...","concept":"...","headline":"...","angle":"..."}]}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 2200, temperature: 0.6, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    const out: Tpl[] = (Array.isArray(j?.templates) ? j.templates : []).map((x: any) => ({
      title: String(x.title || '').slice(0, 40), concept: String(x.concept || '').slice(0, 160),
      headline: String(x.headline || '').slice(0, 100), angle: String(x.angle || '').slice(0, 600),
    })).filter((x: Tpl) => x.title && x.angle).slice(0, 9)
    return out.length ? out : FALLBACK
  } catch { return FALLBACK }
}

async function readCached(admin: any, brandId: string): Promise<Tpl[] | null> {
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const c = data?.brand_kit?.adsStudio?.templates
  return Array.isArray(c) && c.length ? c : null
}
async function writeCached(admin: any, brandId: string, templates: Tpl[]): Promise<void> {
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const existing = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
  const ads = existing.adsStudio || {}
  await admin.from('brands').update({ brand_kit: { ...existing, adsStudio: { ...ads, templates } } }).eq('id', brandId)
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
    return NextResponse.json({ templates: FALLBACK, canGenerate: false, error: String(e?.message || e).slice(0, 160) })
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
