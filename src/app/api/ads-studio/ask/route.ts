/**
 * POST /api/ads-studio/ask — the ads chat's STRATEGIST brain. Answers/ideates conversationally,
 * grounded in the Brand Kit (products, voice, facts) and the running conversation, and — when the chat
 * lands on a concrete ad concept — proposes BUILDING it (returns { build }) so the client can offer a
 * one-tap "Build this ad". Ad briefs still go straight to /api/ads-studio/plan → generate.
 */
import { NextRequest, NextResponse } from 'next/server'
import { llm } from '@/lib/llm'
import { isFormat, type AdFormat } from '@/lib/ads-studio/formats'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { readAdsStudio, readSection } from '@/lib/ads-studio/cache'

const YEAR = 1000 * 60 * 60 * 24 * 365

/** A grounded summary of the brand's competitors — their REAL current ad copy + ad-DNA from the cached
 * competitor pull — so "what is X doing?" is answered from their actual creatives, not the model's guess. */
async function competitorContext(domain: string): Promise<string> {
  try {
    const admin = createAdminClient() as any
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    const brandId = user ? await resolveActiveBrandId(admin, user.id).catch(() => null) : null
    if (!brandId) return ''
    const cache = await readAdsStudio(admin, brandId)
    const spied = readSection<{ byPage: Record<string, any> }>(cache, 'spiedAds', domain || 'spied', YEAR)?.byPage || {}
    const disc = readSection<{ discovered: any[] }>(cache, 'competitors', domain, YEAR)?.discovered || []
    const comps: { name: string; ads: any[]; dna: any }[] = [
      ...Object.values(spied).map((v: any) => ({ name: v?.name || 'Competitor', ads: v?.ads || [], dna: v?.dna })),
      ...disc.map((d: any) => ({ name: d?.name || 'Competitor', ads: d?.ads || [], dna: d?.dna })),
    ].filter((c) => c.name)
    const lines = comps.slice(0, 6).map((c) => {
      const copies = Array.from(new Set((c.ads || []).map((a: any) => String(a?.copy || '').trim()).filter(Boolean))).slice(0, 5)
      const dnaBits = c.dna ? [
        c.dna.hooks?.length ? `hooks: ${c.dna.hooks.slice(0, 3).join(', ')}` : '',
        c.dna.angles?.length ? `angles: ${c.dna.angles.slice(0, 3).join(', ')}` : '',
      ].filter(Boolean).join('; ') : ''
      const copyStr = copies.length ? copies.map((x: string) => `"${x.slice(0, 90)}"`).join(' · ') : '(ad copy not captured — describe from what you know, don\'t invent)'
      return `- ${c.name}${dnaBits ? ` [${dnaBits}]` : ''}: ${copyStr}`
    })
    return lines.join('\n')
  } catch { return '' }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 40

type Turn = { role: 'user' | 'assistant'; text: string }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const message = String(body.message || '').trim()
  const format: AdFormat = isFormat(body.format) ? body.format : 'Instagram'
  const language = String(body.language || 'English').slice(0, 40)
  const siteName = String(body.siteName || '').slice(0, 80)
  const facts: string[] = Array.isArray(body.facts) ? body.facts.slice(0, 14).map((f: any) => String(f)) : []
  const voice = body.voice && typeof body.voice === 'object' ? body.voice : null
  const productTitles: string[] = Array.isArray(body.productTitles) ? body.productTitles.slice(0, 20).map((p: any) => String(p)) : []
  const domain = String(body.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  const history: Turn[] = Array.isArray(body.history)
    ? body.history.slice(-8).map((h: any) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', text: String(h?.text || '').slice(0, 600) })).filter((h: Turn) => h.text)
    : []
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const competitors = await competitorContext(domain)
  const convo = history.map((h) => `${h.role === 'user' ? 'Founder' : 'Mello'}: ${h.text}`).join('\n')
  const prompt = `You are Mello, an in-house brand-aware ads STRATEGIST for this brand. You discuss and ideate — personas, angles, offers, "is this right?" — grounded ONLY in the brand knowledge below. Never invent facts, prices, or offers the brand hasn't stated. When asked about a COMPETITOR, base your answer on their REAL ads listed under COMPETITORS below (quote/paraphrase their actual copy, hooks and angles) — do NOT make up what they run; if a competitor isn't listed or has no captured ads, say so plainly. Be specific and actionable; if asked about audiences, name 2-3 concrete segments each with a one-line "why" and the ad angle that lands. Keep it tight (~120 words), plain text, in ${language}.

When the conversation has landed on a CONCRETE ad concept — or the founder says to make/build it — propose building it.

BRAND: ${siteName || '(the store)'}
BRAND VOICE: ${voice ? `${voice.tone}, ${voice.energy} energy, for ${voice.audience}` : '(unknown)'}
WHAT WE KNOW:
${facts.map((f) => `- ${f}`).join('\n') || '(none)'}
PRODUCTS: ${productTitles.join(' · ') || '(none)'}
AD FORMAT IN USE: ${format}
COMPETITORS (their REAL current ads — copy, and hooks/angles when we've classified them; use ONLY these for competitor questions):
${competitors || '(no competitor ads pulled yet — say we haven\'t captured their ads rather than guessing)'}

CONVERSATION SO FAR:
${convo || '(none yet)'}

FOUNDER'S LATEST MESSAGE: "${message}"

Return ONLY JSON (no markdown, no code fence):
{"answer": "<your reply in ${language}>", "build": {"headline": "<on-image headline>", "angle": "<one-line creative direction>"} | null}
Set "build" to an object ONLY when there is a concrete, ready-to-generate ad concept the founder would want made now; otherwise set "build" to null. If you set build, end your answer with a short line offering to make it.`

  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 600, temperature: 0.5, messages: [{ role: 'user', content: prompt }] })
    const raw = String(res?.content?.[0]?.text ?? res?.choices?.[0]?.message?.content ?? '').trim()
    let answer = raw, build: { headline: string; angle: string } | null = null
    try {
      const j = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim())
      if (j && typeof j.answer === 'string') answer = j.answer.trim()
      if (j?.build && typeof j.build.headline === 'string' && j.build.headline.trim()) {
        build = { headline: String(j.build.headline).slice(0, 120), angle: String(j.build.angle || '').slice(0, 200) }
      }
    } catch { /* not JSON — treat the whole thing as the answer */ }
    return NextResponse.json({ answer: answer || "I couldn't answer that just now — tell me the ad you want and I'll build it.", build })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160), answer: '', build: null })
  }
}
