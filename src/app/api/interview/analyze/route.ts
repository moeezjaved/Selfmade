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
    // A real browser UA — "SelfmadeBot" got blocked/challenged by some hosts, returning an error page.
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000)
    const r = await fetch(full, { signal: ctrl.signal, headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml' } })
    clearTimeout(t)
    const html = (await r.text()).slice(0, 800_000)
    const grab = (re: RegExp) => re.exec(html)?.[1]?.trim() || ''
    const title = grab(/<title[^>]*>([^<]{0,200})/i)
    const desc = grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i)
    // OG + structured data — Shopify, Webflow, Framer, Next/React SPAs render little body text but
    // ALWAYS emit these. This is what makes non-DTC (service, web/app, SaaS) sites readable.
    const og = [
      grab(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{0,120})/i),
      grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,200})/i),
      grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})/i),
    ].filter(Boolean).join(' · ')
    const keywordsMeta = grab(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{0,300})/i)
    const h1 = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)).map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4).join(' | ')
    const ld = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
      .map(m => m[1]).join(' ').replace(/\s+/g, ' ').slice(0, 2500)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').slice(0, 5000)

    const or = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 320, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: `You are a sharp marketing strategist doing pre-interview homework on a company from its website. The company may sell PHYSICAL PRODUCTS, a SERVICE, or SOFTWARE / an APP — infer which and describe it accordingly (don't assume it's a product store). Prefer the structured signals (OG / JSON-LD / title / meta) over sparse body text — many sites (Shopify, SPAs, app landing pages) render little visible text but describe themselves fully in these tags. Form crisp, confident first-pass observations (shown as "I think… correct me if I'm wrong"). Only leave a field blank if there is genuinely no signal.

TITLE: ${title}
META: ${desc}
OG: ${og}
KEYWORDS: ${keywordsMeta}
HEADINGS: ${h1}
STRUCTURED (JSON-LD): ${ld}
TEXT: ${text}

Return ONLY JSON:
{"sells":"what they offer + positioning in ≤9 words — a product ('farm-fresh dairy, delivered — Lahore'), a service ('bookkeeping for US e-commerce brands'), or software ('scheduling app for barbershops')","buyer":"who it's for, ≤8 words","voice":"brand voice in 2-4 words (e.g. 'warm, honest, no hype')","differentiator":"their sharpest edge in ≤10 words","niche":"industry niche in 1-3 words","keywords":["2-4 short search terms to find their COMPETITORS' ads (category words a rival would also match, never this company's own name)"]}`,
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
