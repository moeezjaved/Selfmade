/**
 * POST /api/ads-studio/plan — Mello-lite creative planner for the chat generate flow.
 * Turns a free-text request + chosen format into a concrete brief the (unchanged) generate-ad engine can
 * render: an on-image HEADLINE, a creative ANGLE (carrying the platform vibe — LinkedIn ≠ WhatsApp), a
 * social CAPTION, and which synced product to feature. Grounded in the store's Brand Kit knowledge.
 * The client then calls /api/discovery/generate-ad with these + the Brand Kit colors/fonts/logo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { llm } from '@/lib/llm'
import { FORMAT_VIBE, isFormat, type AdFormat } from '@/lib/ads-studio/formats'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 40

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const message = String(body.message || '').trim()
  const format: AdFormat = isFormat(body.format) ? body.format : 'Instagram'
  const language = String(body.language || 'English').slice(0, 40)
  const siteName = String(body.siteName || '').slice(0, 80)
  const facts: string[] = Array.isArray(body.facts) ? body.facts.slice(0, 14).map((f: any) => String(f)) : []
  const voice = body.voice && typeof body.voice === 'object' ? body.voice : null
  const productTitles: string[] = Array.isArray(body.productTitles) ? body.productTitles.slice(0, 20).map((p: any) => String(p)) : []
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const vibe = FORMAT_VIBE[format].vibe
  const prompt = `You are Mello, an in-house creative director. Turn the founder's request into a concrete brief for our ad-image generator. Ground everything in the brand knowledge — never invent facts, offers, or prices the brand hasn't stated.

BRAND: ${siteName || '(the store)'}
BRAND VOICE: ${voice ? `${voice.tone}, ${voice.energy} energy, for ${voice.audience}` : '(unknown)'}
WHAT WE KNOW:
${facts.map((f) => `- ${f}`).join('\n') || '(none)'}
PRODUCTS (pick the most fitting; index is 0-based): ${productTitles.map((t, i) => `[${i}] ${t}`).join(' · ') || '(none)'}

FORMAT: ${format} — ${vibe}
OUTPUT LANGUAGE for headline & caption: ${language}
FOUNDER'S REQUEST: "${message}"

Return ONLY JSON:
{
 "headlines": ["3 DISTINCT punchy on-image headline options (each <= 8 words), in ${language}, matching the format's vibe — vary the angle across them (e.g. benefit-led, curiosity/hook, offer/urgency) so the founder can pick the direction they like"],
 "angle": "one sentence of creative direction for the image — composition, mood, and the platform vibe (${format}); this steers the visual, not the copy",
 "caption": "a short social caption to post with the ad, in ${language}",
 "productIndex": <the 0-based index of the product to feature, or -1 if none applies>
}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 500, temperature: 0.6, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    const idx = Number.isInteger(j?.productIndex) ? j.productIndex : -1
    const headlines = (Array.isArray(j?.headlines) ? j.headlines : [j?.headline]).map((h: any) => String(h || '').slice(0, 120)).filter(Boolean).slice(0, 3)
    return NextResponse.json({
      headline: headlines[0] || String(j?.headline || '').slice(0, 120),
      headlines,
      angle: `${String(j?.angle || '').slice(0, 240)} Style: ${vibe}`,
      caption: String(j?.caption || '').slice(0, 400),
      productIndex: idx >= 0 && idx < productTitles.length ? idx : -1,
      aspect: FORMAT_VIBE[format].aspect,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160), headline: message.slice(0, 80), angle: FORMAT_VIBE[format].vibe, caption: '', productIndex: 0, aspect: FORMAT_VIBE[format].aspect })
  }
}
