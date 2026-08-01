import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

/**
 * POST /api/meta/scale { metaCampaignId, newDailyBudget }  — founder-confirmed "Scale it" from the brief.
 *
 * We SCALE BY DUPLICATING, never by editing the original's budget — a live budget change can reset a
 * winner's learning phase, so we don't touch it. Instead we copy the winning campaign into a separate
 * "Scaling" campaign (Meta /copies) at the founder's chosen budget, carrying the same ad sets + creatives,
 * and leave the ORIGINAL running untouched. Same mechanism as the tested M4 /api/m4/scale path; this
 * variant takes an absolute budget (from the brief's inline confirm) and auto-resolves the winning ad set.
 *
 * Never auto-runs — only fires after the founder sets a budget and confirms. `newDailyBudget` is MAJOR
 * units (e.g. 6 = €6.00).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const V = process.env.META_API_VERSION || 'v20.0'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { metaCampaignId, newDailyBudget } = await req.json().catch(() => ({}))
  const campaignId = String(metaCampaignId || '').trim()
  const budgetMajor = Number(newDailyBudget)
  if (!campaignId) return NextResponse.json({ error: 'metaCampaignId required' }, { status: 400 })
  if (!Number.isFinite(budgetMajor) || budgetMajor <= 0) return NextResponse.json({ error: 'A daily budget above 0 is required.' }, { status: 400 })
  if (budgetMajor > 100000) return NextResponse.json({ error: 'That budget looks too high — double-check the amount.' }, { status: 400 })

  const admin = createAdminClient()

  // The campaign must belong to THIS user — grab its account so we scale on the right token, even when
  // the campaign lives in a non-primary account.
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

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://graph.facebook.com/${V}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, access_token: token }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
    return data
  }
  const get = async (path: string, params: Record<string, string>) => {
    const res = await fetch(`https://graph.facebook.com/${V}/${path}?` + new URLSearchParams({ ...params, access_token: token }))
    return res.json()
  }

  try {
    // The winner + its name.
    const campData = await get(`${adAccountId}/campaigns`, { fields: 'id,name,status,objective,daily_budget', limit: '300' })
    const winning = (campData.data || []).find((c: any) => c.id === campaignId)
    if (!winning) return NextResponse.json({ error: 'Campaign not found on Meta — refresh the brief.' }, { status: 404 })

    // Winning ad set = highest spend in the campaign (that's the one worth copying).
    const adsetsData = await get(`${campaignId}/adsets`, { fields: 'id,name,insights.date_preset(last_30d){spend}', limit: '50' })
    const adsets = (adsetsData.data || []).map((a: any) => ({ id: a.id, name: a.name, spend: Number(a.insights?.data?.[0]?.spend || 0) }))
      .sort((a: any, b: any) => b.spend - a.spend)
    const winAdset = adsets[0]
    if (!winAdset) return NextResponse.json({ error: 'No ad set found to scale in that campaign.' }, { status: 400 })

    // STEP 1 — the Scaling campaign (reuse if it exists), at the founder's budget. Original untouched.
    const scalingName = `Scaling | ${winning.name}`
    const existing = (campData.data || []).find((c: any) => c.name === scalingName)
    let scalingId: string
    if (existing) {
      scalingId = existing.id
      await post(scalingId, { daily_budget: budgetCents, status: 'ACTIVE' }).catch(() => null)
    } else {
      const copied = await post(`${campaignId}/copies`, { deep_copy: false, status_override: 'PAUSED', rename_options: { rename_strategy: 'ONLY_TOP_LEVEL_RENAME' } })
      scalingId = copied.copied_campaign_id
      await post(scalingId, { name: scalingName, daily_budget: budgetCents, status: 'ACTIVE' })
    }

    // STEP 2 — copy the winning ad set (structure) into the Scaling campaign.
    const copiedAdset = await post(`${winAdset.id}/copies`, { campaign_id: scalingId, deep_copy: false, status_override: 'ACTIVE', rename_options: { rename_strategy: 'ONLY_TOP_LEVEL_RENAME' } })
    const newAdsetId = copiedAdset.copied_adset_id
    if (!newAdsetId) throw new Error('Could not copy the ad set.')

    // STEP 3 — recreate the ads in the new ad set reusing the SAME creatives (same media/copy/URL).
    const adsData = await get(`${winAdset.id}/ads`, { fields: 'id,name,creative' })
    for (const ad of (adsData.data || []).slice(0, 5)) {
      const creativeId = ad.creative?.id
      if (!creativeId) continue
      await post(`${adAccountId}/ads`, { name: `${ad.name} — Scale`, adset_id: newAdsetId, creative: { creative_id: creativeId }, status: 'ACTIVE' }).catch(() => null)
    }

    await admin.from('activity_logs').insert({
      user_id: user.id, action_type: 'META_SCALE', entity_type: 'campaign',
      description: `Scaled “${owned.name || winning.name}” — duplicated into “${scalingName}” at ${budgetMajor}/day. Original untouched. Approved from the brief.`,
      performed_by: 'mello',
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, campaign: winning.name, scalingCampaign: scalingName, newDailyBudget: budgetMajor })
  } catch (e: any) {
    const msg = String(e?.message || 'Scaling failed')
    return NextResponse.json({ error: /budget/i.test(msg) ? 'Meta rejected that budget — it may be below the account minimum. Try a bit higher.' : `Couldn’t scale it: ${msg}` }, { status: 400 })
  }
}
