import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product, description, competitorDomains, targetCustomer, country } = await request.json()

  const extractBrands = (input: string) => {
    if (!input) return []
    return input.split(',').map((s: string) => s.trim()
      .replace(/https?:\/\//g,'').replace(/www\./g,'')
      .replace(/facebook\.com\//g,'').replace(/instagram\.com\//g,'')
      .replace(/\.[a-z]{2,4}$/g,'').replace(/@/g,'').trim()
    ).filter(Boolean)
  }
  const allBrands = Array.from(new Set(extractBrands(competitorDomains || '')))

  let tok = ''
  let adAccountId = ''

  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { decryptToken } = await import('@/lib/meta/client')
    const admin = createAdminClient()
    const { data: ma } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('is_primary', true).single()
    if (ma) {
      tok = decryptToken(ma.access_token)
      adAccountId = 'act_' + ma.account_id
    }
  } catch {}

  // Search Meta and only return a result if the name genuinely matches the query
  const searchMeta = async (q: string): Promise<{id:string,name:string,topic?:string,audience_size_lower_bound?:number}|null> => {
    if (!tok) return null
    try {
      const r = await fetch('https://graph.facebook.com/v20.0/search?' + new URLSearchParams({ type: 'adinterest', q, limit: '10', access_token: tok }))
      const d = await r.json()
      if (!d.data?.length) return null
      const ql = q.toLowerCase().trim()
      // Require the interest name to actually contain or be contained by the query
      // Never fall back to d.data[0] blindly — that's what caused "Ball sports" and "Canada"
      const match = d.data.find((i: any) => {
        const nl = i.name.toLowerCase()
        return nl === ql ||
          nl.startsWith(ql) ||
          ql.startsWith(nl) ||
          (ql.length >= 4 && nl.includes(ql)) ||
          (nl.length >= 4 && ql.includes(nl))
      })
      return match || null
    } catch { return null }
  }

  // Geographic place interests are useless for audience targeting
  const isPlace = (topic?: string, name?: string) => {
    const t = (topic || '').toLowerCase()
    const n = (name || '').toLowerCase()
    return t === 'place' || t === 'geography' || t === 'location' ||
      /\(place\)|\(city\)|\(country\)|\(region\)/.test(n)
  }

  const confirmedBrandInterests: string[] = []
  for (const brand of allBrands.slice(0, 8)) {
    const match = await searchMeta(brand)
    if (match && !isPlace(match.topic, match.name)) confirmedBrandInterests.push(match.name)
  }

  const compCtx = [
    confirmedBrandInterests.length > 0 ? 'Confirmed Meta interests from competitor brands: ' + confirmedBrandInterests.join(', ') : '',
    allBrands.length > 0 ? 'Competitor brands entered: ' + allBrands.join(', ') : '',
  ].filter(Boolean).join('\n')

  const countryLine = country ? `Primary Market: ${country}` : ''

  const prompt = `You are an expert Facebook/Meta Ads media buyer.

Product: ${product}
Description: ${description}
Target Customer: ${targetCustomer || 'General'}
${countryLine}
${compCtx ? '\nCompetitor Intelligence:\n' + compCtx : ''}

Suggest 14 Meta Ads interests highly relevant to this specific product. These will be validated against Meta's real interest database.

Rules:
- Every interest MUST be directly related to the product niche — do NOT suggest generic fitness, sports, or lifestyle interests unless they are core to this product
${country ? `- Prioritize competitor brands and publications popular in ${country} first, then include well-known international ones to fill remaining slots` : '- Include well-known competitor brands in this niche'}
- Competitor brand names that are well-known enough to appear in Meta
- Niche-specific publications and magazines
- Product-category activities and behaviors
- Do NOT suggest geographic places, sports teams, or interests unrelated to the product
- Use the exact name format Meta uses (e.g. "Hair products (hair care)" not just "hair care")

Respond ONLY with valid JSON:
{"interests":[{"name":"exact interest name as it would appear in Meta","category":"Competitor|Publication|Influencer|Activity|Lifestyle","why":"one sentence why this audience buys this product","size":"Small|Medium|Large","confidence":85}]}`

  let claudeSuggestions: any[] = []
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    const text = (data.content?.[0]?.text || '').trim()
    console.log('Claude interests raw:', text.substring(0, 300))
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(text.slice(start, end + 1))
      claudeSuggestions = parsed.interests || []
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  // Validate every Claude suggestion against Meta's actual interest database
  const validated: any[] = []
  if (tok) {
    for (const suggestion of claudeSuggestions) {
      if (validated.length >= 10) break
      const match = await searchMeta(suggestion.name)
      if (match && !isPlace(match.topic, match.name)) {
        validated.push({
          ...suggestion,
          name: match.name, // use exact Meta name
          metaId: match.id,
          audienceSize: match.audience_size_lower_bound,
        })
      }
    }
  } else {
    // No Meta token — return Claude suggestions unvalidated
    validated.push(...claudeSuggestions.slice(0, 10))
  }

  console.log(`Interests: ${claudeSuggestions.length} suggested, ${validated.length} confirmed in Meta`)
  return NextResponse.json({ interests: validated })
}
