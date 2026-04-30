import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import Anthropic from '@anthropic-ai/sdk'

const V = process.env.META_API_VERSION || 'v20.0'
const claude = new Anthropic()

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { campaignName, product, description, competitorDomains, budgetMultiplier = 2, isBudgetIncrease = false, selectedInterests = [], adsetId, adsetName } = await request.json()

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()

    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = `act_${metaAccount.account_id}`
    const currency = metaAccount.currency || 'USD'
    const minBudgets: Record<string,number> = { USD:100, PKR:28100, GBP:100, EUR:100, AED:400 }
    const minBudget = minBudgets[currency] || 100

    const get = async (path: string, params?: Record<string,string>) => {
      const url = new URL(`https://graph.facebook.com/${V}/${path}`)
      url.searchParams.set('access_token', token)
      if (params) Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v))
      return (await fetch(url.toString())).json()
    }

    const post = async (path: string, params: Record<string,unknown>) => {
      const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token }),
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error.message)
      return d
    }

    // Find winning campaign
    const campaigns = await get(`${adAccountId}/campaigns`, {
      fields: 'id,name,daily_budget,objective,status', limit: '100',
    })
    const winning = campaigns.data?.find((c: any) =>
      c.name.toLowerCase().includes(campaignName.toLowerCase().slice(0, 20))
    )
    if (!winning) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const currentBudget = parseInt(winning.daily_budget || String(minBudget * 2))
    const scaledBudget = isBudgetIncrease ? Math.round(currentBudget * (1 + (budgetMultiplier / 100))) : Math.round(currentBudget * budgetMultiplier)

    // If budget increase only - update existing campaign
    if (isBudgetIncrease) {
      await post(`${winning.id}`, { daily_budget: Math.max(minBudget, scaledBudget) })
      return NextResponse.json({
        success: true,
        action: 'budget_increased',
        new_budget: scaledBudget,
        increase_pct: budgetMultiplier,
        new_interests: 0,
      })
    }

    // Add selected interest to original campaign if provided
    if (selectedInterests.length > 0 && !isBudgetIncrease) {
      try {
        const interestName = selectedInterests[0]
        // Search Meta for interest ID
        const intRes = await fetch("https://graph.facebook.com/" + V + "/" + adAccountId + "/search?" + new URLSearchParams({type:"adinterest",q:interestName,limit:"3",access_token:token}))
        const intData = await intRes.json()
        const match = intData.data?.[0]
        if (match) {
          // Add new adset with this interest to original campaign
          await post(adAccountId + "/adsets", {
            name: campaignName + " — Interest — " + match.name,
            campaign_id: winning.id,
            status: "PAUSED",
            targeting: {
              age_min: 18,
              geo_locations: { countries: ["PK"] },
              flexible_spec: [{ interests: [{ id: match.id, name: match.name }] }],
            },
            destination_type: "WEBSITE",
            optimization_goal: "OFFSITE_CONVERSIONS",
            billing_event: "IMPRESSIONS",
          })
        }
      } catch(e: any) { console.log("Interest add error:", e.message) }
    }

    // Duplicate campaign with scaled budget
    const duplicate = await post(`${adAccountId}/campaigns`, {
      name: `${winning.name} — Scale ${budgetMultiplier}x`,
      objective: winning.objective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    })

    // Copy ad sets to duplicate
    const adsets = await get(`${winning.id}/adsets`, {
      fields: 'id,name,targeting,optimization_goal,billing_event,bid_strategy,destination_type',
      limit: '20',
    })

    let copiedAdsets = 0
    for (const adset of (adsets.data || [])) {
      try {
        await post(`${adAccountId}/adsets`, {
          name: adset.name + ' SCALED',
          campaign_id: duplicate.id,
          status: 'PAUSED',
          daily_budget: Math.max(minBudget, scaledBudget),
          targeting: adset.targeting,
          optimization_goal: adset.optimization_goal,
          billing_event: adset.billing_event || 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: adset.destination_type || 'WEBSITE',
        })
        copiedAdsets++
      } catch(e: any) { console.log('Adset copy error:', e.message) }
    }

    // Generate NEW interests via Claude for the ORIGINAL campaign
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: `Generate 6 NEW niche Facebook interest targeting suggestions for: ${product}. Description: ${description}. Competitors: ${competitorDomains}. Find high-intent niche audiences different from obvious ones. Respond ONLY with JSON array: [{"name": "Interest Name", "why": "one line reason"}]` }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
    const newInterests = JSON.parse(text.replace(/```json|```/g, '').trim())

    // Add new interest ad sets to ORIGINAL campaign
    let newInterestCount = 0
    for (const interest of newInterests.slice(0, 6)) {
      try {
        const sr = await fetch(`https://graph.facebook.com/${V}/search?` + new URLSearchParams({ type: 'adinterest', q: interest.name, limit: '1', access_token: token }))
        const sd = await sr.json()
        const mi = sd.data?.[0]
        const targeting: Record<string,unknown> = {
          age_min: 18, age_max: 65,
          geo_locations: { countries: ['PK'] },
          targeting_automation: { advantage_audience: 0 },
        }
        if (mi) targeting.flexible_spec = [{ interests: [{ id: mi.id, name: mi.name }] }]
        await post(`${adAccountId}/adsets`, {
          name: `${winning.name} NEW ${interest.name}`,
          campaign_id: winning.id,
          status: 'PAUSED',
          daily_budget: Math.max(minBudget, currentBudget),
          targeting,
          optimization_goal: 'LINK_CLICKS',
          billing_event: 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: 'WEBSITE',
        })
        newInterestCount++
      } catch(e: any) { console.log('New interest error:', e.message) }
    }

    return NextResponse.json({
      success: true,
      duplicate_campaign_id: duplicate.id,
      copied_adsets: copiedAdsets,
      new_interests: newInterestCount,
    })

  } catch (err: any) {
    console.error('Scale error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
