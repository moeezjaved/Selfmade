import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import type { ApplyPlan } from '@/lib/meta/opportunities'

/**
 * POST /api/meta/tune { metaCampaignId, apply, newDailyBudget } — founder-confirmed "Target them" /
 * "Review placements" from the brief.
 *
 * Same safety as Scale: we NEVER edit the live winner (a targeting/placement change resets Meta's
 * learning phase). We DUPLICATE the winner into a separate campaign (Meta /copies) at the founder's
 * budget, then tune ONLY the copy's ad set toward the best segment (audience) or best placement
 * (placement) — merging into its FULL targeting spec so geo/interests are preserved. The original keeps
 * running untouched. Never auto-runs — only after the founder sets a budget and confirms.
 *
 * `newDailyBudget` is MAJOR units (e.g. 6 = €6.00). `apply` is the structured plan from the opportunity.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const V = process.env.META_API_VERSION || 'v20.0'
const PLATFORMS = new Set(['facebook', 'instagram', 'audience_network', 'messenger'])

/** Reject anything we didn't compute ourselves — never trust a client-sent targeting blob. */
function validate(apply: any): ApplyPlan | null {
  if (!apply || typeof apply !== 'object') return null
  if (apply.kind === 'audience') {
    const genders = Array.isArray(apply.genders) ? apply.genders.filter((g: any) => g === 1 || g === 2) : []
    const ageMin = Number(apply.ageMin), ageMax = Number(apply.ageMax)
    if (!genders.length) return null
    if (!Number.isFinite(ageMin) || !Number.isFinite(ageMax) || ageMin < 13 || ageMax > 65 || ageMin > ageMax) return null
    return { kind: 'audience', genders, ageMin, ageMax, label: String(apply.label || 'your best segment') }
  }
  if (apply.kind === 'placement') {
    if (!PLATFORMS.has(String(apply.platform))) return null
    return { kind: 'placement', platform: String(apply.platform), label: String(apply.label || 'your best placement') }
  }
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const campaignId = String(body.metaCampaignId || '').trim()
  const budgetMajor = Number(body.newDailyBudget)
  const apply = validate(body.apply)
  if (!campaignId) return NextResponse.json({ error: 'metaCampaignId required' }, { status: 400 })
  if (!apply) return NextResponse.json({ error: 'Nothing to tune — refresh the brief and try again.' }, { status: 400 })
  if (!Number.isFinite(budgetMajor) || budgetMajor <= 0) return NextResponse.json({ error: 'A daily budget above 0 is required.' }, { status: 400 })
  if (budgetMajor > 100000) return NextResponse.json({ error: 'That budget looks too high — double-check the amount.' }, { status: 400 })

  const admin = createAdminClient()

  // The winner must belong to THIS user — grab its account so we act on the right token.
  const { data: owned } = await admin.from('campaigns')
    .select('meta_campaign_id, name, meta_account_id').eq('user_id', user.id).eq('meta_campaign_id', campaignId).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'That campaign isn’t on your connected account — refresh the brief and try again.' }, { status: 404 })

  const { data: acct } = await admin.from('meta_accounts')
    .select('account_id, access_token').eq('id', owned.meta_account_id).maybeSingle()
  if (!acct) return NextResponse.json({ error: 'Ad account not found — reconnect Meta and try again.' }, { status: 400 })

  let token = ''
  try { token = decryptToken(acct.access_token) } catch { return NextResponse.json({ error: 'Meta access expired — reconnect and try again.' }, { status: 400 }) }
  const adAccountId = 'act_' + acct.account_id
  const budgetCents = Math.round(budgetMajor * 100)

  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await fetch(`https://graph.facebook.com/${V}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, access_token: token }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error))
    return json
  }
  const get = async (path: string, params: Record<string, string>) => {
    const res = await fetch(`https://graph.facebook.com/${V}/${path}?` + new URLSearchParams({ ...params, access_token: token }))
    return res.json()
  }

  try {
    const campData = await get(`${adAccountId}/campaigns`, { fields: 'id,name,status,objective,daily_budget', limit: '300' })
    const winning = (campData.data || []).find((c: any) => c.id === campaignId)
    if (!winning) return NextResponse.json({ error: 'Campaign not found on Meta — refresh the brief.' }, { status: 404 })

    // Best ad set to base the tuned copy on = highest spend in the winner (the proven one).
    const adsetsData = await get(`${campaignId}/adsets`, { fields: 'id,name,insights.date_preset(last_30d){spend}', limit: '50' })
    const adsets = (adsetsData.data || []).map((a: any) => ({ id: a.id, name: a.name, spend: Number(a.insights?.data?.[0]?.spend || 0) }))
      .sort((a: any, b: any) => b.spend - a.spend)
    const baseAdset = adsets[0]
    if (!baseAdset) return NextResponse.json({ error: 'No ad set found to duplicate in that campaign.' }, { status: 400 })

    // STEP 1 — the tuned campaign (reuse if it exists), at the founder's budget. Original untouched.
    const tunedName = `Focus: ${apply.label} | ${winning.name}`.slice(0, 380)
    const existing = (campData.data || []).find((c: any) => c.name === tunedName)
    let tunedId: string
    if (existing) {
      tunedId = existing.id
      await post(tunedId, { daily_budget: budgetCents, status: 'ACTIVE' }).catch(() => null)
    } else {
      const copied = await post(`${campaignId}/copies`, { deep_copy: false, status_override: 'PAUSED', rename_options: { rename_strategy: 'ONLY_TOP_LEVEL_RENAME' } })
      tunedId = copied.copied_campaign_id
      await post(tunedId, { name: tunedName, daily_budget: budgetCents, status: 'ACTIVE' })
    }

    // STEP 2 — copy the base ad set into the tuned campaign.
    const copiedAdset = await post(`${baseAdset.id}/copies`, { campaign_id: tunedId, deep_copy: false, status_override: 'PAUSED', rename_options: { rename_strategy: 'ONLY_TOP_LEVEL_RENAME' } })
    const newAdsetId = copiedAdset.copied_adset_id
    if (!newAdsetId) throw new Error('Could not copy the ad set.')

    // STEP 3 — tune the COPY's targeting. Fetch its full spec and MERGE the change so geo/interests/etc.
    // are never dropped (a partial targeting POST would wipe them).
    const cur = await get(newAdsetId, { fields: 'targeting' })
    const targeting: Record<string, any> = { ...(cur?.targeting || {}) }
    if (apply.kind === 'audience') {
      targeting.genders = apply.genders
      targeting.age_min = apply.ageMin
      targeting.age_max = apply.ageMax
    } else {
      // Restrict to the winning publisher platform; drop other platforms' explicit position lists so
      // Meta doesn't reject a mismatch, and keep this platform's positions if they were set.
      targeting.publisher_platforms = [apply.platform]
      for (const k of ['facebook_positions', 'instagram_positions', 'audience_network_positions', 'messenger_positions']) {
        if (k !== `${apply.platform}_positions`) delete targeting[k]
      }
    }
    await post(newAdsetId, { targeting })

    // STEP 4 — recreate the ads in the tuned ad set reusing the SAME creatives, then go live.
    const adsData = await get(`${baseAdset.id}/ads`, { fields: 'id,name,creative' })
    for (const ad of (adsData.data || []).slice(0, 5)) {
      const creativeId = ad.creative?.id
      if (!creativeId) continue
      await post(`${adAccountId}/ads`, { name: `${ad.name} — ${apply.label}`, adset_id: newAdsetId, creative: { creative_id: creativeId }, status: 'ACTIVE' }).catch(() => null)
    }
    await post(newAdsetId, { status: 'ACTIVE' }).catch(() => null)

    await admin.from('activity_logs').insert({
      user_id: user.id, action_type: apply.kind === 'audience' ? 'META_AUDIENCE' : 'META_PLACEMENT', entity_type: 'campaign',
      description: `Duplicated “${owned.name || winning.name}” into “${tunedName}” at ${budgetMajor}/day, tuned to ${apply.label}. Original untouched. Approved from the brief.`,
      performed_by: 'mello',
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, campaign: winning.name, newCampaign: tunedName, newDailyBudget: budgetMajor, apply })
  } catch (e: any) {
    const msg = String(e?.message || 'Tune failed')
    return NextResponse.json({ error: /budget/i.test(msg) ? 'Meta rejected that budget — it may be below the account minimum. Try a bit higher.' : `Couldn’t apply it: ${msg}` }, { status: 400 })
  }
}
