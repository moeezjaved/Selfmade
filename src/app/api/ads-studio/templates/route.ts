/**
 * GET /api/ads-studio/templates?domain=… — Personalized Templates for the workspace Home.
 * A set of ad CONCEPTS (title + one-line idea) generated from the store's Brand Kit knowledge — the
 * "wow factor" the user lands on after onboarding. Concepts are cheap (one LLM call) and cached on the
 * brand; tapping one has Mello build the actual ad in the chat (free image generation happens there).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { getSavedKit } from '@/lib/ads-studio/brandkit-store'
import { buildBrandKit } from '@/lib/ads-studio/brandkit'
import { llm } from '@/lib/llm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const cleanDomain = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()

const FALLBACK = [
  { title: 'Product Showcase', concept: 'Your hero product, clean studio look, one benefit line and a Shop Now.' },
  { title: 'Social Media Story', concept: 'Vertical story with a bold hook and a swipe-up to find your bestseller.' },
  { title: 'Sale Campaign', concept: 'High-energy limited-time offer with your discount and urgency.' },
  { title: 'Testimonial Ad', concept: 'A happy-customer quote over a lifestyle shot to build trust.' },
  { title: 'Feature Highlight', concept: 'Call out your top differentiator with a crisp visual and label.' },
  { title: 'Brand Awareness', concept: 'A calm, premium brand moment — your logo, mood and one promise.' },
]

async function concepts(siteName: string, facts: string[], voice: any): Promise<{ title: string; concept: string }[]> {
  if (!facts.length) return FALLBACK
  const prompt = `You are Mello, a creative director. From this brand's real knowledge, propose 6-9 personalized AD TEMPLATE concepts they'd love to run. Each = a short title + one concrete sentence grounded in what the brand actually is/sells. Cover a range: product showcase, social story, sale/offer, testimonial/social-proof, feature highlight, use-case/lifestyle, a platform-specific one (e.g. LinkedIn/WhatsApp), brand awareness.

BRAND: ${siteName}
VOICE: ${voice ? `${voice.tone}, ${voice.energy}, ${voice.audience}` : '(unknown)'}
KNOWLEDGE:
${facts.slice(0, 16).map((f) => `- ${f}`).join('\n')}

Return ONLY JSON: {"templates":[{"title":"2-4 words","concept":"one concrete sentence, grounded, no invented offers"}]}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 800, temperature: 0.6, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    const out = (Array.isArray(j?.templates) ? j.templates : []).map((x: any) => ({ title: String(x.title || '').slice(0, 40), concept: String(x.concept || '').slice(0, 160) })).filter((x: any) => x.title).slice(0, 9)
    return out.length ? out : FALLBACK
  } catch { return FALLBACK }
}

export async function GET(req: NextRequest) {
  const domain = cleanDomain(req.nextUrl.searchParams.get('domain') || '')
  if (!domain || !domain.includes('.')) return NextResponse.json({ templates: [] })
  try {
    const admin = createAdminClient() as any
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    const brandId = user ? await resolveActiveBrandId(admin, user.id).catch(() => null) : null

    // Cache concepts on the brand kit so we generate them once.
    if (brandId) {
      const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
      const cached = data?.brand_kit?.adsStudio?.templates
      if (Array.isArray(cached) && cached.length) return NextResponse.json({ templates: cached })
    }

    const kit = brandId ? await getSavedKit(admin, brandId, domain) : null
    const facts = kit?.facts?.length ? kit.facts : (await buildBrandKit(domain).catch(() => null))?.facts || []
    const siteName = kit?.siteName || domain
    const tpls = await concepts(siteName, facts, kit?.voice)

    if (brandId) {
      try {
        const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
        const existing = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
        const ads = existing.adsStudio || {}
        await admin.from('brands').update({ brand_kit: { ...existing, adsStudio: { ...ads, templates: tpls } } }).eq('id', brandId)
      } catch { /* best-effort cache */ }
    }
    return NextResponse.json({ templates: tpls })
  } catch (e: any) {
    return NextResponse.json({ templates: FALLBACK, error: String(e?.message || e).slice(0, 160) })
  }
}
