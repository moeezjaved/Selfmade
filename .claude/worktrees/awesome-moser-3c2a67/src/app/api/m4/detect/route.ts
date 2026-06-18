import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const V = process.env.META_API_VERSION || 'v20.0'
const claude = new Anthropic()

async function fetchWebsiteContext(url: string): Promise<string> {
  if (!url) return ''
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(normalized, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Selfmade/1.0)' },
    })
    clearTimeout(timer)
    const html = await res.text()
    const title = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim() || ''
    const metaDesc = (
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i)
    )?.[1]?.trim() || ''
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,300})["']/i)?.[1]?.trim() || ''
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 600)
    return [
      title && `Title: ${title}`,
      metaDesc && `Meta description: ${metaDesc}`,
      ogDesc && `OG description: ${ogDesc}`,
      bodyText && `Page content: ${bodyText}`,
    ].filter(Boolean).join('\n')
  } catch {
    return ''
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: ma } = await admin
    .from('meta_accounts').select('*')
    .eq('user_id', user.id).eq('is_primary', true).single()
  if (!ma) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(ma.access_token)
  const adAccountId = 'act_' + ma.account_id

  // Parallel: fetch Facebook page + ad account creative data
  const [pageRes, campRes] = await Promise.all([
    fetch(
      `https://graph.facebook.com/${V}/me/accounts?` +
      new URLSearchParams({ fields: 'name,category,about,products,description,website', access_token: token, limit: '3' })
    ).then(r => r.json()).catch(() => ({})),
    fetch(
      `https://graph.facebook.com/${V}/${adAccountId}/campaigns?` +
      new URLSearchParams({
        fields: 'name,adsets{name,ads{name,creative{body,title,object_story_spec}}}',
        limit: '5',
        access_token: token,
      })
    ).then(r => r.json()).catch(() => ({})),
  ])

  const page = pageRes.data?.[0] || {}
  const websiteUrl = page.website || ''

  // Fetch website content (parallel timing doesn't matter — run after we have the URL)
  const websiteContext = await fetchWebsiteContext(websiteUrl)

  // Build ad creative text
  const adLines: string[] = []
  for (const camp of (campRes.data || []).slice(0, 5)) {
    if (camp.name) adLines.push(`Campaign: "${camp.name}"`)
    for (const adset of (camp.adsets?.data || []).slice(0, 2)) {
      for (const ad of (adset.ads?.data || []).slice(0, 2)) {
        const c = ad.creative || {}
        const spec = c.object_story_spec?.link_data || c.object_story_spec?.video_data || {}
        const parts = [spec.message || c.body, spec.name || c.title, spec.link].filter(Boolean)
        if (parts.length) adLines.push(`Ad: ${parts.join(' | ')}`)
      }
    }
  }

  const pageAbout = page.about || page.products || page.description || ''
  const pageContext = [
    page.name && `Page name: ${page.name}`,
    page.category && `Page category: ${page.category}`,
    pageAbout && `About: ${pageAbout}`,
    websiteUrl && `Website: ${websiteUrl}`,
  ].filter(Boolean).join('\n')

  const prompt = `Analyze this Facebook advertiser's connected data and detect their business. Use the data in order of reliability.

## WEBSITE (strongest signal)
${websiteContext || '(no website found)'}

## AD ACCOUNT DATA (strong signal)
${adLines.length ? adLines.join('\n') : '(no campaigns yet)'}

## FACEBOOK PAGE (context)
${pageContext || '(no page data)'}

Account currency: ${ma.currency || 'USD'} — use this to help detect the country/market.

TASK 1 — Detect business context:
- product: the brand or product name (use page name or website brand name)
- category: what they actually sell — be specific (e.g. "Hair loss treatment for men", not just "Health")
- description: 2–3 sentence benefit-focused product summary written like an ad brief
- targetCustomer: who buys this — include age, gender, situation (e.g. "Men 25–45 experiencing hair thinning who want to regrow hair at home")
- country: where they primarily operate — use currency code, website domain TLD (.pk = Pakistan), page language, ad text language
- confidence: 0–1 how confident you are in the detection

TASK 2 — Suggest REAL competitors (only include brands that genuinely exist):
Group by geography:
- local: competitors operating in the detected country — THIS IS MOST IMPORTANT, minimum 3 if country is identified
- regional: competitors in neighboring/similar markets
- global: major international category leaders (always include 3–5 well-known brands)

For each competitor:
- name: brand name
- domain: website domain (no https://, no www.)
- instagram: @handle (or "" if unknown)
- type: "direct" (same product), "alternative" (different product, same need), or "substitute"

Only suggest brands that have a Meta/Instagram presence and actually sell similar products. Do NOT invent brands.

Respond ONLY with valid JSON:
{
  "context": {
    "product": "...",
    "category": "...",
    "description": "...",
    "targetCustomer": "...",
    "country": "...",
    "confidence": 0.85
  },
  "competitors": {
    "local": [{"name": "...", "domain": "...", "instagram": "@...", "type": "direct"}],
    "regional": [...],
    "global": [...]
  }
}`

  try {
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const s = text.indexOf('{'), e = text.lastIndexOf('}')
    if (s === -1 || e === -1) return NextResponse.json({ error: 'Parse error' }, { status: 500 })
    return NextResponse.json(JSON.parse(text.slice(s, e + 1)))
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
