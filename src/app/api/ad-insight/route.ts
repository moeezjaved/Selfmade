/**
 * GET /api/ad-insight?adId= — UNDERSTAND: "why this ad wins," as a structured
 * report (Qoves-style breakdown, not paragraphs). Generated on first visit from the
 * ad's classified DNA via gpt-4o-mini, then CACHED forever in ad_insights — one ad,
 * one analysis, read by everyone. Confidence is computed from real performance
 * signals (never hallucinated). Public + fail-soft: if the LLM is unavailable, the
 * report is built directly from the DNA fields so Understand is never empty.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Report = {
  headline: string
  hook?: string
  emotion?: string
  audience?: string
  offer?: string
  visualStyle?: string
  story: string[]
  /** One editor's line per story beat (same order) — powers the played breakdown. Optional: old cached reports lack it. */
  storyLines?: string[]
  bullets: string[]
  confidence: number
}

// Confidence is EARNED, not guessed: longevity + performance tier = how sure the
// market is this works. A 300-day ad is near-certain; a 14-day one is promising.
const confidenceOf = (ad: any): number => {
  const days = Number(ad.days_running) || 0
  let c = 55
  if (days >= 365) c = 96; else if (days >= 180) c = 93; else if (days >= 90) c = 89
  else if (days >= 45) c = 84; else if (days >= 21) c = 78; else c = 70
  const tier = String(ad.performance_tier || '').toLowerCase()
  if (tier.includes('top') || tier.includes('elite') || tier.includes('high')) c = Math.min(97, c + 3)
  return c
}

const dnaReport = (ad: any): Report => {
  const story: string[] = []
  if (ad.problem) story.push('Problem')
  if (ad.hook_type) story.push(String(ad.hook_type))
  if (ad.mechanism) story.push('Mechanism')
  if (ad.offer) story.push('Offer')
  story.push('CTA')
  const bullets: string[] = []
  if (ad.hook_type) bullets.push(`Opens on a ${String(ad.hook_type).toLowerCase()} hook — attention before the pitch`)
  if (ad.days_running >= 21) bullets.push(`Running ${ad.days_running} days — the market keeps paying, so it keeps converting`)
  if (ad.usp) bullets.push(`Sharp USP: ${String(ad.usp).slice(0, 90)}`)
  if (ad.format_style) bullets.push(`${ad.format_style} — native to the feed, not an interruption`)
  return {
    headline: 'Why this ad works',
    hook: ad.hook_type || undefined,
    emotion: ad.emotion || undefined,
    audience: ad.persona || undefined,
    offer: ad.offer || ad.usp || undefined,
    visualStyle: ad.visual_style || ad.visual_scene || undefined,
    story: story.slice(0, 6),
    bullets: bullets.slice(0, 4),
    confidence: confidenceOf(ad),
  }
}

export async function GET(req: NextRequest) {
  const adId = (req.nextUrl.searchParams.get('adId') || '').trim()
  if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })
  const admin = createAdminClient() as any

  const { data: cached } = await admin.from('ad_insights').select('report').eq('ad_id', adId).maybeSingle()
  if (cached?.report?.story) return NextResponse.json({ ...cached.report, cached: true })

  const { data: ad } = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, title, body, hook_type, emotion, angle, tone, persona, desire, usp, problem, mechanism, offer, cta, cta_style, format_style, visual_style, visual_scene, on_screen_text, niche, days_running, performance_tier')
    .eq('ad_id', adId).maybeSingle()
  if (!ad) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let out = dnaReport(ad)
  try {
    if (process.env.OPENAI_API_KEY) {
      const facts = Object.fromEntries(Object.entries({
        brand: ad.page_name, headline: ad.title, copy: String(ad.body || '').slice(0, 900),
        hook: ad.hook_type, emotion: ad.emotion, angle: ad.angle, tone: ad.tone,
        persona: ad.persona, desire: ad.desire, usp: ad.usp, problem: ad.problem,
        mechanism: ad.mechanism, offer: ad.offer, cta: ad.cta, format: ad.format_style,
        visual: ad.visual_scene || ad.visual_style, on_screen_text: ad.on_screen_text, niche: ad.niche,
      }).filter(([, v]) => v != null && String(v).trim() !== ''))
      const or = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini', max_tokens: 560, temperature: 0.3, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are Mello, a sharp performance-marketing analyst. From the classified facts of a winning ad, produce a STRUCTURED breakdown a founder can act on. Only use provided facts — never invent metrics or results. Return JSON: {"headline": string (≤7 words), "hook": string (≤6 words, what the opening does), "emotion": string (one word), "audience": string (≤6 words, who it targets), "offer": string (≤7 words), "visualStyle": string (≤4 words), "story": string[] (4-6 SHORT beats of the narrative arc, e.g. ["Problem","Founder","Transformation","CTA"]), "storyLines": string[] (same length/order as story — for each beat, ONE editor\'s line ≤12 words explaining what that beat DOES to the viewer, e.g. "Names the pain before the product ever appears"), "bullets": string[] (3-4 punchy reasons it works, ≤14 words each)}. Be concrete and specific to THIS ad.' },
            { role: 'user', content: JSON.stringify(facts) },
          ],
        }),
      })
      if (or.ok) {
        const j = await or.json()
        const p = JSON.parse(j.choices?.[0]?.message?.content || '{}')
        if (Array.isArray(p.story) && p.story.length >= 3 && Array.isArray(p.bullets)) {
          out = {
            headline: String(p.headline || 'Why this ad works').slice(0, 80),
            hook: p.hook ? String(p.hook).slice(0, 60) : (ad.hook_type || undefined),
            emotion: p.emotion ? String(p.emotion).slice(0, 40) : (ad.emotion || undefined),
            audience: p.audience ? String(p.audience).slice(0, 60) : (ad.persona || undefined),
            offer: p.offer ? String(p.offer).slice(0, 60) : undefined,
            visualStyle: p.visualStyle ? String(p.visualStyle).slice(0, 40) : (ad.visual_style || undefined),
            story: p.story.map((s: any) => String(s).slice(0, 24)).slice(0, 6),
            // One editor's line per beat — drives the played breakdown in Understand. Trimmed to the
            // story's length so label/line always pair; absent (old cache) → the arc renders static.
            storyLines: Array.isArray(p.storyLines) ? p.storyLines.map((s: any) => String(s).slice(0, 110)).slice(0, p.story.length) : undefined,
            bullets: p.bullets.map((s: any) => String(s).slice(0, 140)).slice(0, 4),
            confidence: confidenceOf(ad),   // always our computed, honest number
          }
        }
      }
    }
  } catch { /* grounded DNA report stands */ }

  await admin.from('ad_insights').upsert(
    { ad_id: adId, headline: out.headline, bullets: out.bullets, report: out, model: process.env.OPENAI_API_KEY ? 'gpt-4o-mini' : 'dna' },
    { onConflict: 'ad_id' },
  ).then(() => {}, () => {})
  return NextResponse.json({ ...out, cached: false })
}
