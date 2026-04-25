import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

async function metaPost(path: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`https://graph.facebook.com/${V}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Meta: ${data.error.message} (code: ${data.error.code})`)
  return data
}

async function searchInterest(name: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/${V}/search?` +
    new URLSearchParams({ type: 'adinterest', q: name, limit: '1', access_token: token })
  )
  const data = await res.json()
  return data.data?.[0] || null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { campaignName, creatives, interests, budget, location, ageMin, ageMax, gender, pixelId } = body

  const admin = createAdminClient()
  const { data: metaAccount } = await admin
    .from('meta_accounts')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .single()

  if (!metaAccount) return NextResponse.json({ error: 'No primary Meta account connected' }, { status: 400 })

  const token = decryptToken(metaAccount.access_token)
  const adAccountId = `act_${metaAccount.account_id}`

  console.log('Launching M4 for account:', metaAccount.account_name, adAccountId)

  const errors: string[] = []
  const dailyBudgetCents = Math.round(parseFloat(budget || '50') * 100)

  // Build geo_locations
  const geoLocations: Record<string, unknown> = {}
  if (location) {
    const loc = location.trim()
    if (loc.length === 2) {
      geoLocations.countries = [loc.toUpperCase()]
    } else {
      geoLocations.countries = ['PK'] // default Pakistan
      geoLocations.cities = [{ key: loc }]
    }
  } else {
    geoLocations.countries = ['PK']
  }

  const buildTargeting = (interestObj?: { id: string; name: string }) => {
    const targeting: Record<string, unknown> = {
      age_min: parseInt(ageMin) || 18,
      age_max: parseInt(ageMax) || 65,
      geo_locations: geoLocations,
    }
    if (gender === 'MALE') targeting.genders = [1]
    if (gender === 'FEMALE') targeting.genders = [2]
    if (interestObj) {
      targeting.flexible_spec = [{ interests: [{ id: interestObj.id, name: interestObj.name }] }]
    }
    return targeting
  }

  // ── STEP 1: Create exclusion audiences ────────────────────
  const exclusionIds: string[] = []
  if (pixelId) {
    const audienceDefs = [
      { name: `${campaignName} — Visitors 60d`, event: 'PageView', days: 60 },
      { name: `${campaignName} — Purchasers 180d`, event: 'Purchase', days: 180 },
    ]
    for (const aud of audienceDefs) {
      try {
        const result = await metaPost(`${adAccountId}/customaudiences`, token, {
          name: aud.name,
          rule: JSON.stringify({
            inclusions: { operator: 'or', rules: [{
              event_sources: [{ id: pixelId, type: 'pixel' }],
              retention_seconds: aud.days * 86400,
              filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: aud.event }] }
            }]}
          }),
          prefill: true,
        })
        exclusionIds.push(result.id)
      } catch (e: any) {
        errors.push(`Audience ${aud.name}: ${e.message}`)
      }
    }
  }

  const exclusions = exclusionIds.length > 0
    ? { custom_audiences: exclusionIds.map(id => ({ id })) }
    : undefined

  // ── STEP 2: Broad Campaign ─────────────────────────────────
  let broadCampaignId = ''
  let broadAdSetsCount = 0
  try {
    const broadCampaign = await metaPost(`${adAccountId}/campaigns`, token, {
      name: `${campaignName} — M4 Broad`,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: dailyBudgetCents,
    })
    broadCampaignId = broadCampaign.id

    for (const creative of (creatives || [])) {
      try {
        const targeting = buildTargeting()
        if (exclusions) (targeting as any).exclusions = exclusions

        await metaPost(`${adAccountId}/adsets`, token, {
          name: `${campaignName} — Broad — ${creative.name}`,
          campaign_id: broadCampaignId,
          status: 'PAUSED',
          targeting,
          optimization_goal: 'OFFSITE_CONVERSIONS',
          billing_event: 'IMPRESSIONS',
          daily_budget: Math.max(100, Math.round(dailyBudgetCents / Math.max(creatives.length, 1))),
          pixel_id: pixelId || undefined,
          promoted_object: pixelId ? { pixel_id: pixelId, custom_event_type: 'PURCHASE' } : undefined,
        })
        broadAdSetsCount++
      } catch (e: any) {
        errors.push(`Broad ad set "${creative.name}": ${e.message}`)
      }
    }
  } catch (e: any) {
    errors.push(`Broad campaign: ${e.message}`)
  }

  // ── STEP 3: Interest Campaign ──────────────────────────────
  let interestCampaignId = ''
  let interestAdSetsCount = 0
  try {
    const interestCampaign = await metaPost(`${adAccountId}/campaigns`, token, {
      name: `${campaignName} — M4 Interests`,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: dailyBudgetCents,
    })
    interestCampaignId = interestCampaign.id

    for (const interest of (interests || [])) {
      try {
        // Search for real Meta interest ID
        const metaInterest = await searchInterest(interest.name, token)
        const targeting = buildTargeting(metaInterest || { id: interest.name, name: interest.name })
        if (exclusions) (targeting as any).exclusions = exclusions

        await metaPost(`${adAccountId}/adsets`, token, {
          name: `${campaignName} — Interest — ${interest.name}`,
          campaign_id: interestCampaignId,
          status: 'PAUSED',
          targeting,
          optimization_goal: 'OFFSITE_CONVERSIONS',
          billing_event: 'IMPRESSIONS',
          daily_budget: Math.max(100, Math.round(dailyBudgetCents / Math.max(interests.length, 1))),
          pixel_id: pixelId || undefined,
          promoted_object: pixelId ? { pixel_id: pixelId, custom_event_type: 'PURCHASE' } : undefined,
        })
        interestAdSetsCount++
      } catch (e: any) {
        errors.push(`Interest ad set "${interest.name}": ${e.message}`)
      }
    }
  } catch (e: any) {
    errors.push(`Interest campaign: ${e.message}`)
  }

  // ── STEP 4: Log ────────────────────────────────────────────
  await admin.from('activity_logs').insert({
    user_id: user.id,
    action_type: 'M4_LAUNCHED',
    entity_type: 'campaign',
    description: `M4 launched: Broad ${broadCampaignId}, Interests ${interestCampaignId} in ${metaAccount.account_name}`,
    performed_by: 'user',
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    account: metaAccount.account_name,
    account_id: metaAccount.account_id,
    broad_campaign_id: broadCampaignId,
    interest_campaign_id: interestCampaignId,
    broad_adsets: broadAdSetsCount,
    interest_adsets: interestAdSetsCount,
    exclusion_audiences: exclusionIds.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
