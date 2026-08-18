import { NextRequest, NextResponse } from 'next/server'
import { resolveBrandScopedAccount } from '@/lib/meta/scope'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import { logError } from '@/lib/admin/logError'
import { resolveBillingOwner } from '@/lib/org'
import { requireFeature } from '@/lib/entitlements'

const V = process.env.META_API_VERSION || 'v20.0'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Launching real ads is a Creator feature — gate on the billing owner's plan (teammates inherit it).
    {
      const gateAdmin = createAdminClient()
      const owner = await resolveBillingOwner(gateAdmin, user.id)
      const gate = await requireFeature(gateAdmin, owner, 'launch')
      if (gate) return NextResponse.json(gate, { status: 402 })
    }

    // Record that this user reached M4 and tried to launch — even if it fails validation below. The
    // admin funnel ("Clicked Ad Plan (M4)") reads this, so a user who engaged M4 counts as engaged,
    // not as "never touched it" (the mismatch: error logs showed the attempt but the funnel didn't).
    try {
      const { createAdminClient } = await import('@/lib/supabase/server')
      await createAdminClient().from('activity_logs').insert({
        user_id: user.id, action_type: 'M4_LAUNCH_ATTEMPT', entity_type: 'campaign',
        description: 'Started an M4 campaign launch', performed_by: 'user',
      })
    } catch { /* best-effort tracking */ }

    const body = await request.json().catch(() => ({}))
    const {
      campaignName = 'M4 Campaign',
      creatives = [],
      interests = [],
      budget = '500',
      ageMin = '18',
      ageMax = '65',
      gender = 'ALL',
      pixelId = '',
      objective = 'OUTCOME_SALES',
      pageId = '',
      instagramActorId = '',
      retargetingCreatives = [] as any[],
      retainerCreatives = [] as any[],
      retargetingCopy = {} as any,
      retainerCopy = {} as any,
      includeRetainer = false,
      location = 'PK',
      locations = [] as any[],
      primaryText = '',
      headline = '',
      cta = 'LEARN_MORE',
      websiteUrl = '',
      product = '',
      description = '',
      targetCustomer = '',
      competitorDomains = '',
    } = body
    console.log('LAUNCH creatives:', creatives?.length, 'interests:', interests?.length, 'budget:', budget)

    // Build geo_locations from locations array or fallback to location string
    const buildGeo = () => {
      if (locations && locations.length > 0) {
        const countries = locations.filter((l:any) => l.type === 'country').map((l:any) => l.key)
        const cities = locations.filter((l:any) => l.type === 'city').map((l:any) => ({ key: parseInt(l.key) }))
        const regions = locations.filter((l:any) => l.type === 'region').map((l:any) => ({ key: parseInt(l.key) }))
        const result: any = {}
        if (countries.length > 0) result.countries = countries
        if (cities.length > 0) result.cities = cities
        if (regions.length > 0) result.regions = regions
        if (Object.keys(result).length === 0) result.countries = [location || 'PK']
        return result
      }
      return { countries: [location || 'PK'] }
    }
    const geoLocations = buildGeo()


    const admin = createAdminClient()
    const metaAccount = await resolveBrandScopedAccount(admin, user.id)

    if (!metaAccount) return NextResponse.json({ error: 'No primary Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = `act_${metaAccount.account_id}`
    const currency = metaAccount.currency || 'USD'

    // Pre-flight: is this ad account actually ready to run ads? Catches the "campaign created but no ads /
    // Account overview" dead-end BEFORE we build anything. Never hard-blocks on a check that itself fails.
    try {
      const acctRes = await fetch(`https://graph.facebook.com/${V}/${adAccountId}?fields=account_status,disable_reason,funding_source&access_token=${encodeURIComponent(token)}`)
      const acct = await acctRes.json()
      // Token revoked / expired / checkpoint (190,102,10,200,459,467): the account row is stale-active.
      // Flip it to 'error' so /reports + MetaGate stop treating it as connected, and return a reconnect
      // prompt HERE instead of failing deep in campaign creation with a raw "[459]".
      const AUTH_CODES = new Set([190, 102, 10, 200, 459, 467])
      const errCode = acct?.error ? Number(acct.error.code) : null
      if (errCode != null && AUTH_CODES.has(errCode)) {
        try { await admin.from('meta_accounts').update({ status: 'error' }).eq('account_id', metaAccount.account_id) } catch { /* best-effort */ }
        return NextResponse.json({ error: 'Your Meta connection expired. Reconnect your ad account before launching (Settings → Meta).', needsReconnect: true }, { status: 400 })
      }
      const SETUP_MSG = 'Your Meta ad account isn’t set up to run ads yet. Open Meta Ads Manager → Account overview, add a payment method and confirm your account details, then launch again.'
      // account_status: 1 = ACTIVE. Anything else (disabled/unsettled/pending/closed) can't run ads.
      if (acct?.account_status != null && Number(acct.account_status) !== 1) {
        return NextResponse.json({ error: SETUP_MSG + ` (account status ${acct.account_status})`, needsSetup: true }, { status: 400 })
      }
      // No funding source id = no payment method attached yet (the classic new-account block).
      if (acct?.account_status != null && !acct.funding_source) {
        return NextResponse.json({ error: SETUP_MSG, needsSetup: true }, { status: 400 })
      }
    } catch { /* check failed → don't block; ad creation will still surface any real error */ }

    // CUSTOM AUDIENCES ToS PRE-FLIGHT (Meta error 2663): website-visitor retargeting/retainer audiences
    // CANNOT be created until the ad-account admin accepts Meta's Custom Audiences Terms of Service ONCE,
    // by hand, in Meta's UI. If the plan includes retargeting/retainer and the ToS isn't accepted, stop
    // BEFORE spending and point the user at the exact accept link — so once they accept, broad + retargeting
    // launch together instead of the retargeting silently skipping after the money's already committed.
    const wantsAudiences = !!pixelId && (
      (Array.isArray(retargetingCreatives) && (retargetingCreatives as any[]).length > 0) ||
      (includeRetainer && Array.isArray(retainerCreatives) && (retainerCreatives as any[]).length > 0)
    )
    if (wantsAudiences) {
      try {
        const tosRes = await fetch(`https://graph.facebook.com/${V}/${adAccountId}?fields=tos_accepted&access_token=${encodeURIComponent(token)}`)
        const tos = await tosRes.json()
        const map = tos?.tos_accepted
        // Only act when Meta actually returns the map (older API versions omit it → don't false-block).
        if (map && typeof map === 'object') {
          const accepted = [map.custom_audience_tos, map.web_custom_audience_tos, map.customaudiencetos]
            .some((v) => v === 1 || v === '1' || v === true)
          if (!accepted) {
            return NextResponse.json({
              needsCustomAudienceTos: true,
              tosUrl: `https://www.facebook.com/customaudiences/app/tos/?act=${metaAccount.account_id}`,
              error: 'One quick step before retargeting can launch: accept Meta’s Custom Audiences Terms of Service once for this ad account, then launch again — broad and retargeting will go out together.',
            }, { status: 400 })
          }
        }
      } catch { /* check failed → don't block; audience creation still surfaces the real reason */ }
    }

    const budgetAmount = parseFloat(budget) || 500
    const budgetCents = Math.round(budgetAmount * 100)
    const currencyMinimums: Record<string,number> = { USD:100, PKR:28100, GBP:100, EUR:100, AED:400, SAR:400, INR:8000 }
    const minBudget = currencyMinimums[currency] || 100
    const safeBudget = Math.max(minBudget, budgetCents)

    const validObjectives = ['OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_TRAFFIC','OUTCOME_AWARENESS','OUTCOME_ENGAGEMENT','OUTCOME_APP_PROMOTION']
    let apiObjective = validObjectives.includes(objective) ? objective : 'OUTCOME_TRAFFIC'

    // Meta rejects any ad set that optimizes for an OBJECT it can't see (error 1885154 "create a new ad
    // set with a selected object"). A Sales campaign optimizes PURCHASES, which REQUIRES a Meta Pixel as
    // the promoted object. If the account has no Pixel we cannot run Sales — fall back to a Traffic
    // campaign (optimizes link clicks; the ad's website URL is the object) so the launch still goes live
    // instead of dying. This is the exact failure the founder hit: Sales objective + no Pixel selected.
    // Every ad set MUST carry the object its objective optimizes toward, or Meta rejects it with 1885154
    // ("include an ad set with a selected object … e.g. a Page, URL or event"). We only build a
    // promoted_object for Sales (Pixel) and Leads (Page); for anything else — or when that object is
    // missing — fall back to Traffic, which optimizes LINK_CLICKS and needs no object (the ad's URL IS
    // the object). This guarantees the launch goes live instead of dying with 1885154.
    let downgradeNote = ''
    const SUPPORTED = new Set(['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS'])
    if (apiObjective === 'OUTCOME_SALES' && !pixelId) {
      apiObjective = 'OUTCOME_TRAFFIC'
      downgradeNote = 'No Meta Pixel found on this ad account, so we launched a Traffic campaign (drives clicks to your site). Add a Pixel in Meta Events Manager, then relaunch to optimize for Purchases.'
    } else if (apiObjective === 'OUTCOME_LEADS' && !pageId) {
      apiObjective = 'OUTCOME_TRAFFIC'
      downgradeNote = 'No Facebook Page was selected, so we launched a Traffic campaign (clicks to your site) instead of Leads. Pick a Page in the Creatives step, then relaunch to run Lead ads.'
    } else if (!SUPPORTED.has(apiObjective)) {
      apiObjective = 'OUTCOME_TRAFFIC'
      downgradeNote = 'That objective isn’t supported yet, so we launched a Traffic campaign (clicks to your site).'
    }

    const optimizationMap: Record<string,{optimization_goal:string,billing_event:string}> = {
      OUTCOME_SALES: { optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS' },
      OUTCOME_LEADS: { optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS' },
      OUTCOME_TRAFFIC: { optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS' },
      OUTCOME_AWARENESS: { optimization_goal: 'REACH', billing_event: 'IMPRESSIONS' },
    }
    const optSettings = optimizationMap[apiObjective] || optimizationMap.OUTCOME_TRAFFIC

    // promoted_object = what Meta optimizes toward. Sales→Pixel+Purchase, Leads→Page. Traffic/Awareness
    // need none (the ad's link / Page is the object). Missing this is what triggers 1885154.
    const promotedObject =
      (apiObjective === 'OUTCOME_SALES' && pixelId) ? { promoted_object: { pixel_id: pixelId, custom_event_type: 'PURCHASE' } }
      : (apiObjective === 'OUTCOME_LEADS' && pageId) ? { promoted_object: { page_id: pageId } }
      : {}

    const post = async (path: string, params: Record<string,unknown>) => {
      const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token }),
      })
      const d = await r.json()
      if (d.error) throw new Error(`${d.error.message} [${d.error.error_subcode||d.error.code}] ${d.error.error_user_msg||''}`)
      return d
    }

    // Search for real Meta interest ID
    const searchInterest = async (name: string) => {
      try {
        const r = await fetch(`https://graph.facebook.com/${V}/search?` + new URLSearchParams({ type: 'adinterest', q: name, limit: '3', access_token: token }))
        const d = await r.json()
        // Find best match
        const match = d.data?.find((i: any) => i.name.toLowerCase() === name.toLowerCase()) || d.data?.[0]
        return match || null
      } catch { return null }
    }

    const errors: string[] = []
    // Set when a retargeting/retainer audience is refused because Meta's Custom Audiences ToS isn't
    // accepted (error 2663). The broad + interest campaigns still launch; we return ONE clean, actionable
    // message + the exact accept link instead of Meta's wall of text.
    let tosBlocked = false
    const tosUrl = `https://www.facebook.com/customaudiences/app/tos/?act=${metaAccount.account_id}`

    // Reuse existing custom audience by name — only create if not found
    // Remember WHY an audience couldn't be built, so a retargeting/retainer campaign can report the real
    // Meta reason instead of silently shipping a BROAD ad set (which is what used to happen — the
    // retargeting ad set was created with no custom audience = "everyone in Pakistan", 60M+ people).
    const audienceErrors: Record<string, string> = {}
    const getOrCreateAudience = async (name: string, rule: object): Promise<string | null> => {
      try {
        // Search existing audiences for this account by name
        const searchRes = await fetch(
          `https://graph.facebook.com/${V}/${adAccountId}/customaudiences?` +
          new URLSearchParams({ fields: 'id,name', limit: '200', access_token: token })
        )
        const searchData = await searchRes.json()
        const existing = (searchData.data || []).find((a: any) => a.name === name)
        if (existing) {
          console.log(`Reusing existing audience "${name}":`, existing.id)
          return existing.id
        }
        // Not found — create it. On the CURRENT Graph API version a pixel-rule website audience is created
        // with just name + rule — the pixel `event_sources` inside the rule IS what makes it a website
        // audience. Do NOT send `subtype`: this API version rejects it outright
        // ("[1870053] The parameter subtype is not supported in the current API version") — that rejection
        // was the actual reason the audience returned null and retargeting got refused. An EMPTY website
        // audience is still valid (a fresh pixel with 0 PageViews creates fine, fills over time).
        const created = await post(`${adAccountId}/customaudiences`, {
          name, rule: JSON.stringify(rule), prefill: true,
        })
        console.log(`Created new audience "${name}":`, created.id)
        return created.id
      } catch(e: any) {
        console.log(`Audience "${name}" error:`, e.message)
        audienceErrors[name] = String(e?.message || 'unknown error')
        return null
      }
    }

    // Create ad creative — throws descriptive error so caller can surface it
    const createAdCreative = async (name: string, imageHash: string | null, customCopy?: any, isVideo = false): Promise<string | null> => {
      const cp = customCopy || {}
      const msg = cp.primaryText || primaryText || 'Check out our products'
      const lnk = (cp.destinationUrl || websiteUrl || '').trim()
      const hd = cp.headline || headline || campaignName
      const ct = cp.cta || cta || 'LEARN_MORE'

      if (!pageId) { errors.push(`Creative "${name}": no Facebook Page selected`); return null }
      if (!lnk) { errors.push(`Creative "${name}": destination URL is empty`); return null }
      if (!imageHash) { errors.push(`Creative "${name}": no image/video uploaded — upload a creative first`); return null }

      try {
        let storySpec: Record<string,unknown>
        if (isVideo) {
          // Meta video_data requires a thumbnail (image_url or image_hash)
          // Fetch auto-generated thumbnail from Meta's video thumbnails endpoint
          let thumbnailUrl: string | undefined
          try {
            const thumbRes = await fetch(`https://graph.facebook.com/${V}/${imageHash}/thumbnails?access_token=${token}`)
            const thumbData = await thumbRes.json()
            thumbnailUrl = thumbData.data?.[0]?.uri
          } catch {}

          const videoData: Record<string,unknown> = {
            video_id: imageHash,
            message: msg,
            title: hd,
            call_to_action: { type: ct, value: { link: lnk } },
          }
          if (thumbnailUrl) videoData.image_url = thumbnailUrl

          storySpec = { page_id: pageId, video_data: videoData }
        } else {
          storySpec = {
            page_id: pageId,
            link_data: {
              message: msg, link: lnk, name: hd, description: '',
              image_hash: imageHash,
              call_to_action: { type: ct, value: { link: lnk } },
            },
          }
        }

        const creativeSpec: Record<string,unknown> = { name, object_story_spec: storySpec }
        if (instagramActorId) creativeSpec.instagram_actor_id = instagramActorId

        const creative = await post(`${adAccountId}/adcreatives`, creativeSpec)
        return creative.id
      } catch(e: any) {
        errors.push(`Creative "${name}": ${e.message}`)
        return null
      }
    }

    let exclusionAudienceId: string | null = null
    let broadCount = 0
    let intCount = 0

    // Get or create exclusion audience (shared across all campaigns — reused not duplicated)
    if (pixelId) {
      exclusionAudienceId = await getOrCreateAudience(
        `M4 — Website Visitors 180d (Exclusion)`,
        { inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: 15552000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'PageView' }] } }] } }
      )
    }

    // ── CAMPAIGN 1: Broad (Advantage+ audience ON) ────────────
    const broadCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Broad`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: Math.max(minBudget, Math.round(safeBudget * 0.3)),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      is_adset_budget_sharing_enabled: false,
    })

    for (const c of (creatives as any[]).slice(0, 5)) {
      try {
        // Creative FIRST — if it can't be built (no image hash / account not set up), skip the whole ad
        // set so we never leave an orphaned ad set with no ad (the "empty ad sets" bug).
        const creativeId = await createAdCreative(`Creative — ${c.name}`, c.hash || null, undefined, c.type === 'video')
        if (!creativeId) continue
        const broadAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Broad — ${c.name}`,
          campaign_id: broadCamp.id,
          status: 'PAUSED',
          targeting: {
            age_min: parseInt(ageMin) || 18,
            geo_locations: geoLocations,
            ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
            targeting_automation: { advantage_audience: 1 },
            ...(exclusionAudienceId ? { excluded_custom_audiences: [{ id: exclusionAudienceId }] } : {}),
          },
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,
        })
        await post(`${adAccountId}/ads`, {
          name: `Ad — ${c.name}`,
          adset_id: broadAdset.id,
          creative: { creative_id: creativeId },
          status: 'PAUSED',
        })
        broadCount++
      } catch(e: any) {
        errors.push(`Broad "${c.name}": ${e.message}`)
      }
    }

    // ── CAMPAIGN 2: Interests (manual targeting) ──────────────
    const intCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Interests`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: Math.max(minBudget, Math.round(safeBudget * 0.3)),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      is_adset_budget_sharing_enabled: false,
    })

    // Use first creative's hash for interest ads
    const firstCreative = (creatives as any[])[0]
    const firstHash = firstCreative?.hash || null

    for (const interest of (interests as any[]).slice(0, 6)) {
      try {
        // Get real Meta interest ID
        const metaInterest = await searchInterest(interest.name)
        console.log('Interest search:', interest.name, '->', metaInterest?.name, metaInterest?.id)

        const intTargeting: Record<string,unknown> = {
          age_min: parseInt(ageMin) || 18,
          age_max: parseInt(ageMax) || 65,
          geo_locations: geoLocations,
          ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
          targeting_automation: { advantage_audience: 0 },
          ...(exclusionAudienceId ? { excluded_custom_audiences: [{ id: exclusionAudienceId }] } : {}),
        }
        if (metaInterest) {
          intTargeting.flexible_spec = [{ interests: [{ id: metaInterest.id, name: metaInterest.name }] }]
        }

        // Creative FIRST — skip the ad set entirely if it can't be built (no orphan ad sets).
        const creativeId = await createAdCreative(`Creative — ${interest.name}`, firstHash, undefined, firstCreative?.type === 'video')
        if (!creativeId) continue
        const intAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Interest — ${interest.name}`,
          campaign_id: intCamp.id,
          status: 'PAUSED',
          targeting: intTargeting,
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,
        })
        await post(`${adAccountId}/ads`, {
          name: `Ad — ${interest.name}`,
          adset_id: intAdset.id,
          creative: { creative_id: creativeId },
          status: 'PAUSED',
        })
        intCount++
      } catch(e: any) {
        errors.push(`Interest "${interest.name}": ${e.message}`)
      }
    }

    // ── CAMPAIGN 3: Retargeting (website visitors 60 days) ──────
    let retargetingCount = 0
    let retainerCount = 0

    console.log('Retargeting check - pixelId:', pixelId, 'retargetingCreatives:', (retargetingCreatives as any[]).length)
    if (pixelId && (retargetingCreatives as any[]).length > 0) {
      try {
        // Get or create retargeting audience (reused not duplicated)
        const rtAudId = await getOrCreateAudience(
          `M4 — Website Visitors 180d (Retargeting)`,
          { inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: 15552000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'PageView' }] } }] } }
        )
        const rtAud = rtAudId ? { id: rtAudId } : null
        // A retargeting ad set WITHOUT its audience is not retargeting — it's a broad ad set that would spend
        // the retargeting budget on everyone. Refuse to create it and say exactly why the audience failed.
        if (!rtAud) {
          const why = audienceErrors['M4 — Website Visitors 180d (Retargeting)'] || 'Meta did not return an audience id'
          if (/2663|terms of service/i.test(why)) {
            tosBlocked = true
            throw new Error('Retargeting needs Meta’s Custom Audiences Terms of Service accepted for this ad account first.')
          }
          throw new Error(`Couldn't build the website-visitor audience for the Pixel (${why}). Retargeting was skipped so it wouldn't run as a broad ad set. An empty audience is fine (a new Pixel fills over time) — if Meta refused it, it's usually the Custom Audience terms not yet accepted for this ad account (Ads Manager → Audiences), or the Pixel isn't shared with this ad account.`)
        }

        const rtPct = includeRetainer ? 0.2 : 0.4
        const rtBudget = Math.max(minBudget, Math.round(safeBudget * rtPct))
        const rtCamp = await post(`${adAccountId}/campaigns`, {
          name: `${campaignName} — M4 Retargeting`,
          objective: apiObjective,
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: rtBudget,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          is_adset_budget_sharing_enabled: false,
        })

        for (const c of (retargetingCreatives as any[]).slice(0, 3)) {
          try {
            const rtTargeting: Record<string,unknown> = {
              age_min: parseInt(ageMin) || 18,
              age_max: parseInt(ageMax) || 65,
              geo_locations: geoLocations,
              targeting_automation: { advantage_audience: 0 },
            }
            if (rtAud?.id) rtTargeting.custom_audiences = [{ id: rtAud.id }]

            const rtAdset = await post(`${adAccountId}/adsets`, {
              name: `${campaignName} — Retargeting — ${c.name}`,
              campaign_id: rtCamp.id,
              status: 'PAUSED',
              targeting: rtTargeting,
                  destination_type: 'WEBSITE',
              ...optSettings,
              ...promotedObject,
            })

            const rtCreative = await createAdCreative(`RT Creative — ${c.name}`, c.hash || null, retargetingCopy, c.type === 'video')
            if (rtCreative) {
              await post(`${adAccountId}/ads`, {
                name: `RT Ad — ${c.name}`,
                adset_id: rtAdset.id,
                creative: { creative_id: rtCreative },
                status: 'PAUSED',
              })
              retargetingCount++
            }
          } catch(e: any) { errors.push(`Retargeting "${c.name}": ${e.message}`) }
        }
      } catch(e: any) { errors.push(`Retargeting campaign: ${e.message}`) }
    }

    // ── CAMPAIGN 4: Retainer (past purchasers) ────────────────
    if (includeRetainer && pixelId && (retainerCreatives as any[]).length > 0) {
      try {
        // Get or create purchasers audience (reused not duplicated)
        const rnAudId = await getOrCreateAudience(
          `M4 — Purchasers 180d`,
          { inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: 15552000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'Purchase' }] } }] } }
        )
        const rnAud = rnAudId ? { id: rnAudId } : null
        // Same rule as retargeting: no purchasers audience → don't ship a broad "retainer" ad set.
        if (!rnAud) {
          const why = audienceErrors['M4 — Purchasers 180d'] || 'Meta did not return an audience id'
          if (/2663|terms of service/i.test(why)) {
            tosBlocked = true
            throw new Error('Retainer needs Meta’s Custom Audiences Terms of Service accepted for this ad account first.')
          }
          throw new Error(`Couldn't build the past-purchasers audience for the Pixel (${why}). Retainer was skipped so it wouldn't run as a broad ad set.`)
        }

        const rnBudget = Math.max(minBudget, Math.round(safeBudget * 0.2))
        const rnCamp = await post(`${adAccountId}/campaigns`, {
          name: `${campaignName} — M4 Retainer`,
          objective: apiObjective,
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: rnBudget,
          // Without an explicit strategy Meta applies the account's default, which on many accounts is a
          // BID-CAP strategy that then demands a bid_amount we don't collect → error 1815857 "Bid amount
          // required". Pin the same auto-bidding (no cap) the other three campaigns use so it never asks.
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          is_adset_budget_sharing_enabled: false,
        })

        for (const c of (retainerCreatives as any[]).slice(0, 3)) {
          try {
            const rnTargeting: Record<string,unknown> = {
              age_min: parseInt(ageMin) || 18,
              age_max: parseInt(ageMax) || 65,
              geo_locations: geoLocations,
              targeting_automation: { advantage_audience: 0 },
            }
            if (rnAud?.id) rnTargeting.custom_audiences = [{ id: rnAud.id }]

            const rnAdset = await post(`${adAccountId}/adsets`, {
              name: `${campaignName} — Retainer — ${c.name}`,
              campaign_id: rnCamp.id,
              status: 'PAUSED',
              targeting: rnTargeting,
                  destination_type: 'WEBSITE',
              ...optSettings,
              ...promotedObject,
            })

            const rnCreative = await createAdCreative(`RN Creative — ${c.name}`, c.hash || null, retainerCopy)
            if (rnCreative) {
              await post(`${adAccountId}/ads`, {
                name: `RN Ad — ${c.name}`,
                adset_id: rnAdset.id,
                creative: { creative_id: rnCreative },
                status: 'PAUSED',
              })
              retainerCount++
            }
          } catch(e: any) { errors.push(`Retainer "${c.name}": ${e.message}`) }
        }
      } catch(e: any) { errors.push(`Retainer campaign: ${e.message}`) }
    }

    try {
      await admin.from('activity_logs').insert({
        user_id: user.id,
        action_type: 'M4_LAUNCHED',
        entity_type: 'campaign',
        description: `M4 launched in ${metaAccount.account_name}: Broad ${broadCamp.id}, Interests ${intCamp.id}`,
        performed_by: 'user',
        brand_id: (metaAccount as any).brand_id || null,   // scope to the brand this ad account is linked to
      })
    } catch(e) { console.log('Activity log error') }

    // Store launch data for insights
    try {
      const adminSb = createAdminClient()
      await adminSb.from('m4_launches').insert({
        user_id: user.id,
        campaign_name: campaignName,
        product: product || '',
        description: description || '',
        target_customer: targetCustomer || '',
        competitor_domains: competitorDomains || '',
      })
    } catch(e: any) { console.log('Launch store error:', e.message) }

    // Log any partial errors (creative failures, interest failures, etc.) to admin dashboard
    if (errors.length > 0) {
      for (const errMsg of errors) {
        await logError({
          user_id: user.id,
          user_email: user.email,
          error_message: `M4 Launch: ${errMsg}`,
          page_url: '/m4',
          extra: { campaign_name: campaignName, account: metaAccount.account_name },
        })
      }
    }

    // If NOTHING launched and every failure is Meta's account-security checkpoint (error 3858385 /
    // "pending action" / "authenticated your account"), translate the raw Graph wall-of-text into ONE
    // plain, actionable line. This fires when a NEW app first tries to create ads on an ad account —
    // Meta's fraud protection flags it and blocks all ad creation until the owner confirms it's them.
    const totalCreated = broadCount + intCount + retargetingCount + retainerCount
    const checkpoint = errors.length > 0 && errors.every(e => /3858385|pending action|authenticated your account|confirm/i.test(e))
    if (totalCreated === 0 && checkpoint) {
      return NextResponse.json({
        error: 'Meta has put a security checkpoint on this ad account and is blocking new ads until you confirm it\'s you. Open Meta Ads Manager for this account (and facebook.com/accountquality), complete the "Confirm your identity / security check" step, wait a few minutes, then launch again. This is a one-time Meta verification — nothing is wrong with your setup.',
        needsVerify: true,
        errors,
      }, { status: 400 })
    }

    // Retargeting/retainer was refused for the Custom Audiences ToS → the broad + interest campaigns
    // still launched. Return ONE clean, actionable message + the exact accept link (not the raw errors).
    if (tosBlocked) {
      return NextResponse.json({
        success: true,
        account: metaAccount.account_name,
        broad_campaign_id: broadCamp.id,
        interest_campaign_id: intCamp.id,
        broad_adsets: broadCount,
        interest_adsets: intCount,
        retargeting_adsets: retargetingCount,
        retainer_adsets: retainerCount,
        needsCustomAudienceTos: true,
        tosUrl,
        note: `Your broad + interest campaigns are live. Your retargeting/retainer campaign was NOT created — this ad account hasn’t accepted Meta’s Custom Audiences Terms of Service yet. Accept it once here, then relaunch and retargeting will go out too.`,
      })
    }

    return NextResponse.json({
      success: true,
      account: metaAccount.account_name,
      broad_campaign_id: broadCamp.id,
      interest_campaign_id: intCamp.id,
      broad_adsets: broadCount,
      interest_adsets: intCount,
      retargeting_adsets: retargetingCount,
      retainer_adsets: retainerCount,
      exclusion_audiences: 0,
      note: downgradeNote || undefined,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: any) {
    console.error('M4 launch error:', err.message)
    // Log fatal launch failure
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await logError({
          user_id: user.id,
          user_email: user.email,
          error_message: `M4 Launch failed: ${err.message}`,
          error_stack: err.stack,
          page_url: '/m4',
        })
      }
    } catch {}
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
