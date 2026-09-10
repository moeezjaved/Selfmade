/**
 * POST /api/ads-studio/ask — the ads chat's STRATEGIST brain. Answers/ideates conversationally,
 * grounded in the Brand Kit (products, voice, facts) and the running conversation, and — when the chat
 * lands on a concrete ad concept — proposes BUILDING it (returns { build }) so the client can offer a
 * one-tap "Build this ad". Ad briefs still go straight to /api/ads-studio/plan → generate.
 */
import { NextRequest, NextResponse } from 'next/server'
import { llm } from '@/lib/llm'
import { isFormat, type AdFormat } from '@/lib/ads-studio/formats'

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
  const history: Turn[] = Array.isArray(body.history)
    ? body.history.slice(-8).map((h: any) => ({ role: h?.role === 'assistant' ? 'assistant' : 'user', text: String(h?.text || '').slice(0, 600) })).filter((h: Turn) => h.text)
    : []
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const convo = history.map((h) => `${h.role === 'user' ? 'Founder' : 'Mello'}: ${h.text}`).join('\n')
  const prompt = `You are Mello, an in-house brand-aware ads STRATEGIST for this brand. You discuss and ideate — personas, angles, offers, "is this right?" — grounded ONLY in the brand knowledge below. Never invent facts, prices, or offers the brand hasn't stated. Be specific and actionable; if asked about audiences, name 2-3 concrete segments each with a one-line "why" and the ad angle that lands. Keep it tight (~120 words), plain text, in ${language}.

When the conversation has landed on a CONCRETE ad concept — or the founder says to make/build it — propose building it.

BRAND: ${siteName || '(the store)'}
BRAND VOICE: ${voice ? `${voice.tone}, ${voice.energy} energy, for ${voice.audience}` : '(unknown)'}
WHAT WE KNOW:
${facts.map((f) => `- ${f}`).join('\n') || '(none)'}
PRODUCTS: ${productTitles.join(' · ') || '(none)'}
AD FORMAT IN USE: ${format}

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
