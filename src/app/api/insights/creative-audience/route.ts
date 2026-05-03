import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const V = process.env.META_API_VERSION || 'v20.0'
const claude = new Anthropic()

export async function GET(request: NextRequest) {
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
  const currency = ma.currency || 'USD'

  const dateRange = request.nextUrl.searchParams.get('dateRange') || 'last_7d'
  const days = parseInt(dateRange.replace('last_', '').replace('d', '')) || 7
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
  const until = new Date().toISOString().split('T')[0]
  const timeRange = JSON.stringify({ since, until })

  // 1. Fetch active/paused campaigns → adsets → ads with creative info
  const campRes = await fetch(
    `https://graph.facebook.com/${V}/${adAccountId}/campaigns?` +
    new URLSearchParams({
      fields: 'id,name,objective,effective_status,adsets{id,name,status,ads{id,name,status,creative{id,body,title,thumbnail_url,effective_object_story_id,object_story_spec}}}',
      effective_status: '["ACTIVE","PAUSED"]',
      limit: '20',
      access_token: token,
    })
  ).then(r => r.json()).catch(() => ({}))

  const campaigns = campRes.data || []

  // Collect all ads with their creative + campaign/adset context
  const allAds: any[] = []
  for (const camp of campaigns) {
    for (const adset of (camp.adsets?.data || [])) {
      for (const ad of (adset.ads?.data || [])) {
        if (ad.status === 'DELETED') continue
        const creative = ad.creative || {}
        const spec = creative.object_story_spec?.link_data || creative.object_story_spec?.video_data || {}
        allAds.push({
          ad_id: ad.id,
          ad_name: ad.name,
          ad_status: ad.status,
          campaign_id: camp.id,
          campaign_name: camp.name,
          campaign_objective: camp.objective?.replace('OUTCOME_', '') || '',
          adset_id: adset.id,
          adset_name: adset.name,
          creative_id: creative.id,
          thumbnail_url: creative.thumbnail_url || null,
          preview_url: creative.effective_object_story_id
            ? `https://www.facebook.com/${creative.effective_object_story_id}` : null,
          primary_text: spec.message || creative.body || '',
          headline: spec.name || creative.title || '',
          link_url: spec.link || '',
        })
      }
    }
  }

  if (!allAds.length) return NextResponse.json({ creatives: [], currency })

  // 2. Fetch ad-level insights broken down by age+gender and by publisher+placement in parallel
  const adIds = Array.from(new Set(allAds.map(a => a.ad_id))).slice(0, 50)

  // Batch insights: age+gender breakdown and placement breakdown per ad
  const insightBase = {
    fields: 'ad_id,spend,impressions,clicks,ctr,actions',
    time_range: timeRange,
    level: 'ad',
    limit: '500',
    access_token: token,
    filtering: JSON.stringify([{ field: 'ad.id', operator: 'IN', value: adIds }]),
  }

  const [ageGenderRes, placementRes] = await Promise.all([
    fetch(`https://graph.facebook.com/${V}/${adAccountId}/insights?` +
      new URLSearchParams({ ...insightBase, breakdowns: 'age,gender' })
    ).then(r => r.json()).catch(() => ({})),
    fetch(`https://graph.facebook.com/${V}/${adAccountId}/insights?` +
      new URLSearchParams({ ...insightBase, breakdowns: 'publisher_platform,platform_position' })
    ).then(r => r.json()).catch(() => ({})),
  ])

  // Index by ad_id
  const ageGenderByAd: Record<string, any[]> = {}
  for (const row of (ageGenderRes.data || [])) {
    if (!ageGenderByAd[row.ad_id]) ageGenderByAd[row.ad_id] = []
    ageGenderByAd[row.ad_id].push(row)
  }
  const placementByAd: Record<string, any[]> = {}
  for (const row of (placementRes.data || [])) {
    if (!placementByAd[row.ad_id]) placementByAd[row.ad_id] = []
    placementByAd[row.ad_id].push(row)
  }

  // 3. Build per-creative summary (group by creative_id)
  const creativeMap: Record<string, any> = {}

  for (const ad of allAds) {
    const cid = ad.creative_id || ad.ad_id
    if (!creativeMap[cid]) {
      creativeMap[cid] = {
        creative_id: cid,
        thumbnail_url: ad.thumbnail_url,
        preview_url: ad.preview_url,
        primary_text: ad.primary_text,
        headline: ad.headline,
        link_url: ad.link_url,
        campaigns: new Set(),
        adsets: [],
        ad_ids: [],
        total_spend: 0,
        total_impressions: 0,
        total_clicks: 0,
        conversions: 0,
        ageGender: {} as Record<string, number>,  // "25-34|male" → spend
        placements: {} as Record<string, number>, // "facebook|feed" → spend
      }
    }
    const c = creativeMap[cid]
    c.campaigns.add(ad.campaign_name)
    c.adsets.push({ id: ad.adset_id, name: ad.adset_name, campaign: ad.campaign_name, objective: ad.campaign_objective })
    c.ad_ids.push(ad.ad_id)

    // Aggregate age+gender breakdown
    for (const row of (ageGenderByAd[ad.ad_id] || [])) {
      const spend = parseFloat(row.spend || '0')
      const key = `${row.age}|${row.gender}`
      c.ageGender[key] = (c.ageGender[key] || 0) + spend
      c.total_spend += spend
      c.total_impressions += parseInt(row.impressions || '0')
      c.total_clicks += parseInt(row.clicks || '0')
      c.conversions += parseInt(
        (row.actions || []).find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0'
      )
    }

    // Aggregate placement breakdown
    for (const row of (placementByAd[ad.ad_id] || [])) {
      const spend = parseFloat(row.spend || '0')
      const key = `${row.publisher_platform}|${row.platform_position}`
      c.placements[key] = (c.placements[key] || 0) + spend
    }
  }

  // 4. Format each creative — top segments sorted by spend
  const fmtPlatform = (p: string) =>
    p === 'facebook' ? 'Facebook' : p === 'instagram' ? 'Instagram' : p === 'audience_network' ? 'Audience Network' : p === 'messenger' ? 'Messenger' : p

  const fmtPosition = (p: string) =>
    p?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || p

  const creatives = Object.values(creativeMap)
    .filter(c => c.total_spend > 0 || c.total_impressions > 0)
    .map(c => {
      const topAgeGender = Object.entries(c.ageGender as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([key, spend]) => {
          const [age, gender] = key.split('|')
          const pct = c.total_spend > 0 ? Math.round((spend / c.total_spend) * 100) : 0
          return { age, gender, spend, pct }
        })

      const topPlacements = Object.entries(c.placements as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, spend]) => {
          const [platform, position] = key.split('|')
          const pct = c.total_spend > 0 ? Math.round((spend / c.total_spend) * 100) : 0
          return { platform: fmtPlatform(platform), position: fmtPosition(position), spend, pct }
        })

      // Gender split
      const genderSpend: Record<string, number> = {}
      for (const [key, spend] of Object.entries(c.ageGender as Record<string, number>)) {
        const gender = key.split('|')[1]
        genderSpend[gender] = (genderSpend[gender] || 0) + (spend as number)
      }
      const totalGenderSpend = Object.values(genderSpend).reduce((a, b) => a + b, 0)
      const genderSplit = Object.entries(genderSpend).map(([g, s]) => ({
        gender: g === 'male' ? 'Male' : g === 'female' ? 'Female' : 'Unknown',
        pct: totalGenderSpend > 0 ? Math.round((s / totalGenderSpend) * 100) : 0,
      })).sort((a, b) => b.pct - a.pct)

      return {
        creative_id: c.creative_id,
        thumbnail_url: c.thumbnail_url,
        preview_url: c.preview_url,
        primary_text: c.primary_text,
        headline: c.headline,
        campaigns: Array.from(c.campaigns as Set<string>),
        adsets: c.adsets,
        total_spend: c.total_spend,
        total_impressions: c.total_impressions,
        total_clicks: c.total_clicks,
        conversions: c.conversions,
        ctr: c.total_impressions > 0 ? (c.total_clicks / c.total_impressions) * 100 : 0,
        topAgeGender,
        topPlacements,
        genderSplit,
      }
    })
    .sort((a, b) => b.total_spend - a.total_spend)

  // 5. Generate AI "why" explanation for top 8 creatives
  const toExplain = creatives.slice(0, 8)
  const explanations: Record<string, string> = {}

  if (toExplain.length > 0) {
    const prompt = `You are a Facebook Ads analyst. For each ad creative below, write ONE specific sentence (max 25 words) explaining WHY Meta is spending most on that exact audience segment.

Your explanation MUST:
1. Quote or reference a specific word, phrase, or theme from the actual ad copy
2. Connect it directly to why that demographic (age + gender) responds to it
3. Be grounded in the creative content — NOT generic phrases like "performance signal" or "high CTR"

Examples of BAD explanations (do not write these):
- "High CTR signals strong audience alignment with this demographic"
- "Performance data indicates this segment converts well"
- "Facebook's algorithm optimized delivery to this group"

Examples of GOOD explanations:
- "The phrase 'hair loss solution' resonates with men 35-44 who are most likely experiencing this concern"
- "Mentioning 'busy moms' directly speaks to women 25-34 juggling family and work"
- "The urgency of 'limited offer' appeals to deal-seeking women 18-24 who impulse-buy on Instagram"

${toExplain.map((c, i) => `
Creative ${i + 1} [ID: ${c.creative_id}]:
- Full ad copy: "${c.primary_text.slice(0, 200)}"
- Headline: "${c.headline || '(none)'}"
- Top audience receiving spend: ${c.topAgeGender.slice(0, 2).map(a => `${a.age} ${a.gender} (${a.pct}% of spend)`).join(', ')}
- Gender split: ${c.genderSplit.map(g => `${g.gender} ${g.pct}%`).join(', ')}
- Top placements: ${c.topPlacements.slice(0, 2).map(p => `${p.platform} ${p.position} (${p.pct}%)`).join(', ')}
`).join('')}

Respond ONLY with valid JSON — keys are the creative IDs exactly as shown:
{ "${toExplain[0]?.creative_id}": "your specific reason here", ... }`

    try {
      const res = await claude.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = res.content[0].type === 'text' ? res.content[0].text : ''
      const s = text.indexOf('{'), e = text.lastIndexOf('}')
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(text.slice(s, e + 1))
        Object.assign(explanations, parsed)
      }
    } catch {}
  }

  // Attach explanations
  const creativesWithWhy = creatives.map(c => ({ ...c, why: explanations[c.creative_id] || null }))

  return NextResponse.json({ creatives: creativesWithWhy, currency, dateRange })
}
