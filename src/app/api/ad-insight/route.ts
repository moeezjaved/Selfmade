/**
 * GET /api/ad-insight?adId= — UNDERSTAND: "why this ad wins."
 * Generated on first visit from the ad's classified DNA (hook, emotion, angle,
 * persona, desire, USP, problem→mechanism→offer, tone, visual scene, on-screen
 * text, longevity) via gpt-4o-mini, then CACHED in ad_insights forever — one ad,
 * one analysis, generated once, read by everyone. Public (the playbook funnel is
 * logged-out) and fail-soft: if the LLM is unavailable, grounded bullets are built
 * directly from the DNA fields so the page never shows an empty Understand.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const dnaBullets = (ad: any): { headline: string; bullets: string[] } => {
  const b: string[] = []
  if (ad.hook_type) b.push(`Opens on a ${String(ad.hook_type).toLowerCase()} hook — attention before the pitch`)
  if (ad.emotion) b.push(`Built to trigger ${ad.emotion}`)
  if (ad.problem && ad.mechanism) b.push(`Classic problem → mechanism structure: "${String(ad.problem).slice(0, 70)}" answered by "${String(ad.mechanism).slice(0, 70)}"`)
  if (ad.usp) b.push(`Clear USP: ${String(ad.usp).slice(0, 90)}`)
  if (ad.format_style) b.push(`${ad.format_style} format — native to the feed, not an interruption`)
  if (ad.days_running >= 21) b.push(`Running ${ad.days_running} days — the market keeps paying for it, which means it keeps converting`)
  if (ad.cta) b.push(`Closes with a direct CTA: "${String(ad.cta).slice(0, 60)}"`)
  return { headline: 'Why this ad works', bullets: b.slice(0, 6) }
}

export async function GET(req: NextRequest) {
  const adId = (req.nextUrl.searchParams.get('adId') || '').trim()
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })
  const admin = createAdminClient() as any

  // cache first — one analysis per ad, forever
  const { data: cached } = await admin.from('ad_insights').select('headline, bullets').eq('ad_id', adId).maybeSingle()
  if (cached?.bullets?.length) return NextResponse.json({ headline: cached.headline, bullets: cached.bullets, cached: true })

  const { data: ad } = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, title, body, hook_type, emotion, angle, tone, persona, desire, usp, problem, mechanism, offer, cta, cta_style, format_style, visual_style, visual_scene, on_screen_text, niche, days_running, performance_tier')
    .eq('ad_id', adId).maybeSingle()
  if (!ad) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let out = dnaBullets(ad)
  try {
    if (process.env.OPENAI_API_KEY) {
      const facts = Object.fromEntries(Object.entries({
        brand: ad.page_name, headline: ad.title, copy: String(ad.body || '').slice(0, 900),
        hook: ad.hook_type, emotion: ad.emotion, angle: ad.angle, tone: ad.tone,
        persona: ad.persona, desire: ad.desire, usp: ad.usp, problem: ad.problem,
        mechanism: ad.mechanism, offer: ad.offer, cta: ad.cta, format: ad.format_style,
        visual: ad.visual_scene || ad.visual_style, on_screen_text: ad.on_screen_text,
        niche: ad.niche, days_running: ad.days_running, performance_tier: ad.performance_tier,
      }).filter(([, v]) => v != null && String(v).trim() !== ''))
      const or = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini', max_tokens: 380, temperature: 0.3, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are Mello, a sharp performance-marketing analyst. Given the classified facts of a winning ad, explain WHY it works in 4-6 short punchy bullets a founder can act on. Only use the provided facts — never invent metrics, never speculate about results. Each bullet ≤ 14 words, concrete, specific to THIS ad. Return JSON: {"headline": string (≤7 words, e.g. "Why this ad keeps winning"), "bullets": string[]}' },
            { role: 'user', content: JSON.stringify(facts) },
          ],
        }),
      })
      if (or.ok) {
        const j = await or.json()
        const parsed = JSON.parse(j.choices?.[0]?.message?.content || '{}')
        if (Array.isArray(parsed.bullets) && parsed.bullets.length >= 3) {
          out = { headline: String(parsed.headline || 'Why this ad works').slice(0, 80), bullets: parsed.bullets.map((s: any) => String(s).slice(0, 140)).slice(0, 6) }
        }
      }
    }
  } catch { /* grounded DNA bullets stand */ }

  if (out.bullets.length) {
    await admin.from('ad_insights').upsert({ ad_id: adId, headline: out.headline, bullets: out.bullets, model: process.env.OPENAI_API_KEY ? 'gpt-4o-mini' : 'dna' }, { onConflict: 'ad_id' }).then(() => {}, () => {})
  }
  return NextResponse.json({ ...out, cached: false })
}
