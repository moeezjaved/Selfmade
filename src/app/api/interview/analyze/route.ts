/**
 * The interview's "homework" brain. POST { url } → Mello's first-pass read of the business:
 *   { sells, buyer, voice, differentiator, niche, keywords[] }
 * detect-product (reused separately) handles the visual kit (logo/colors/product shots); this route
 * reads the site's TEXT and forms the observations the Smart-Guess beat presents as "correct me if
 * I'm wrong". gpt-4o-mini on ~6k chars — cheap, ~3-5s. Fail-soft: any error returns {} and the
 * interview degrades to asking instead of guessing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await isRateLimited(user.id)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const { url } = await req.json().catch(() => ({}))
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target) && !/^[\w-]+(\.[\w-]+)+/.test(target)) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const full = /^https?:\/\//i.test(target) ? target : `https://${target}`

  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000)
    const r = await fetch(full, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; SelfmadeBot/1.0)' } })
    clearTimeout(t)
    const html = (await r.text()).slice(0, 500_000)
    const title = /<title[^>]*>([^<]{0,200})/i.exec(html)?.[1]?.trim() || ''
    const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i.exec(html)?.[1] || ''
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').slice(0, 6000)

    const or = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 320, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: `You are a sharp marketing strategist doing pre-interview homework on a company from its website text. Form crisp, confident first-pass observations (they will be shown as "I think… correct me if I'm wrong").

TITLE: ${title}\nMETA: ${desc}\nTEXT: ${text}

Return ONLY JSON:
{"sells":"what they sell + positioning in ≤9 words (e.g. 'farm-fresh dairy, delivered — Lahore')","buyer":"who buys it, ≤8 words","voice":"brand voice in 2-4 words (e.g. 'warm, honest, no hype')","differentiator":"their sharpest edge in ≤10 words","niche":"industry niche in 1-3 words","keywords":["2-4 short search terms to find their COMPETITORS' ads (category words a rival brand would also match, never this brand's own name)"]}`,
        }],
      }),
    })
    if (!or.ok) throw new Error(`openai ${or.status}`)
    const j = await or.json()
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    return NextResponse.json({
      sells: String(out.sells || '').slice(0, 120) || null,
      buyer: String(out.buyer || '').slice(0, 100) || null,
      voice: String(out.voice || '').slice(0, 60) || null,
      differentiator: String(out.differentiator || '').slice(0, 120) || null,
      niche: String(out.niche || '').slice(0, 40) || null,
      keywords: Array.isArray(out.keywords) ? out.keywords.map((k: any) => String(k).slice(0, 40)).slice(0, 4) : [],
    })
  } catch (e: any) {
    return NextResponse.json({ sells: null, buyer: null, voice: null, differentiator: null, niche: null, keywords: [], degraded: true })
  }
}
