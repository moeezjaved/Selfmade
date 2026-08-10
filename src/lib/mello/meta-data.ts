/**
 * Data layer behind Mello's tools. Reuses the existing Meta plumbing
 * (meta_accounts table + decryptToken) so the agent reads a user's LIVE ad
 * performance, and queries discovery_ads_index for our own ad-intelligence
 * ("inspiration library"). Everything is scoped to user_id.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import { scopedMetaAccounts, resolveScopedAccount } from '@/lib/meta/scope'

const V = process.env.META_API_VERSION || 'v20.0'

export interface MetaAccountRow {
  id: string
  account_id: string        // without the act_ prefix
  account_name: string
  currency: string | null
  page_id: string | null
  is_primary: boolean
  access_token: string
  status: string
}

/** Resolve the account to use: an explicitly named one, else the primary. ORG-SCOPED — a founder must
 *  see accounts connected by any org member (matching /api/meta/accounts + the "Meta connected" pill),
 *  not just rows they personally own. Using .eq('user_id', self) here is what made Mello say "no Meta
 *  account connected" while the app showed it connected. */
async function resolveAccount(userId: string, accountId?: string): Promise<MetaAccountRow> {
  const admin = createAdminClient()
  const data = await resolveScopedAccount(admin, userId, accountId ? accountId.replace(/^act_/, '') : null)
  if (!data) throw new Error(accountId ? `No connected Meta account matching ${accountId}` : 'No primary Meta account connected. Ask the user to connect one in Settings.')
  return data as MetaAccountRow
}

/** List all connected ad accounts this user may use (for the picker / get_ad_accounts). ORG-SCOPED. */
export async function listAdAccounts(userId: string) {
  const admin = createAdminClient()
  const rows = await scopedMetaAccounts(admin, userId)
  return rows.map((a: any) => ({
    platform: 'meta',
    account_id: 'act_' + a.account_id,
    name: a.account_name,
    currency: a.currency || 'USD',
    is_primary: !!a.is_primary,
    last_synced_at: a.last_synced_at || null,
  }))
}

/** Account metadata — name, currency, account id, primary flag. */
export async function getAccountInfo(userId: string, accountId?: string) {
  const acc = await resolveAccount(userId, accountId)
  return {
    account_id: 'act_' + acc.account_id,
    name: acc.account_name,
    currency: acc.currency || 'USD',
    page_id: acc.page_id || null,
    is_primary: acc.is_primary,
  }
}

// Graph supports these date_preset values directly.
const VALID_PRESETS = new Set([
  'today', 'yesterday', 'this_week_mon_today', 'last_week_mon_sun', 'this_month',
  'last_month', 'this_quarter', 'last_3d', 'last_7d', 'last_14d', 'last_28d',
  'last_30d', 'last_90d', 'maximum',
])

function pickPurchase(rows: { action_type: string; value: string }[] | undefined): number {
  if (!rows) return 0
  const r = rows.find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')
    || rows.find(a => a.action_type === 'purchase')
    || rows.find(a => a.action_type === 'omni_purchase')
    || rows.find(a => a.action_type === 'lead')
  return Number(r?.value || 0)
}

export interface AdPerfParams {
  accountId?: string
  date_preset?: string
  date_start?: string
  date_end?: string
  level?: 'ad' | 'adset' | 'campaign'
  limit?: number
  sort_by?: string
  sort_order?: 'desc' | 'asc'
  status?: 'ACTIVE' | 'ALL'
}

/** Pull live ad-level performance from Meta's Insights API. */
export async function getAdPerformance(userId: string, params: AdPerfParams) {
  const acc = await resolveAccount(userId, params.accountId)
  const token = decryptToken(acc.access_token)
  const currency = acc.currency || 'USD'
  const level = params.level || 'ad'
  const limit = Math.min(Math.max(params.limit || 20, 1), 50)
  const sortBy = params.sort_by || 'spend'
  const sortOrder = params.sort_order === 'asc' ? 'ascending' : 'descending'

  const qs: Record<string, string> = {
    level,
    fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values',
    limit: String(limit),
    sort: `${sortBy}_${sortOrder}`,
    access_token: token,
  }
  if (params.date_start && params.date_end) {
    qs.time_range = JSON.stringify({ since: params.date_start, until: params.date_end })
  } else {
    const preset = params.date_preset && VALID_PRESETS.has(params.date_preset) ? params.date_preset : 'this_month'
    qs.date_preset = preset
  }
  if (params.status === 'ACTIVE') {
    qs.filtering = JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }])
  }

  const url = `https://graph.facebook.com/${V}/act_${acc.account_id}/insights?` + new URLSearchParams(qs)
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(`Meta API: ${json.error.message}`)

  const rows = (json.data || []).map((r: any) => {
    const spend = Number(r.spend || 0)
    const conversions = pickPurchase(r.actions)
    const revenue = pickPurchase(r.action_values)
    return {
      ad_id: r.ad_id,
      name: r.ad_name || r.adset_name || r.campaign_name || '(unnamed)',
      campaign: r.campaign_name || null,
      spend: Math.round(spend * 100) / 100,
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      ctr: Number(r.ctr || 0),
      cpc: Number(r.cpc || 0),
      cpm: Number(r.cpm || 0),
      reach: Number(r.reach || 0),
      frequency: Number(r.frequency || 0),
      conversions,
      revenue: Math.round(revenue * 100) / 100,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
      cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
      thumbnail_url: null as string | null,
    }
  })

  // Thumbnails for the ads shown, in ONE batched read (`?ids=a,b,c`) — never one call per ad (that
  // was the rate-limit culprit). Only for ad-level results (adset/campaign rows have no single creative).
  if (level === 'ad') {
    try {
      const ids = rows.map((r: any) => r.ad_id).filter(Boolean).slice(0, 50)
      if (ids.length) {
        const burl = `https://graph.facebook.com/${V}/?ids=${ids.join(',')}&fields=creative{thumbnail_url,image_url}&access_token=${encodeURIComponent(token)}`
        const batch = await fetch(burl).then(r => r.json()).catch(() => ({}))
        for (const r of rows) {
          const cre = batch?.[r.ad_id]?.creative
          r.thumbnail_url = cre?.thumbnail_url || cre?.image_url || null
        }
      }
    } catch { /* thumbnails best-effort */ }
  }

  return {
    account: 'act_' + acc.account_id,
    account_name: acc.account_name,
    currency,
    level,
    date_range: qs.time_range ? JSON.parse(qs.time_range) : { preset: qs.date_preset },
    count: rows.length,
    ads: rows,
  }
}

export interface AdLibraryParams {
  query?: string
  niche?: string
  format?: 'image' | 'video' | 'carousel'
  min_days_active?: number
  limit?: number
}

/** Search our own discovery ad-intelligence DB (the "inspiration library"). */
export async function searchAdLibrary(params: AdLibraryParams) {
  const admin = createAdminClient()
  const limit = Math.min(Math.max(params.limit || 10, 1), 24)
  let q = admin
    .from('discovery_ads_index')
    .select('ad_id, page_name, body, title, format, niche, thumbnail_url, days_running, performance_tier, performance_score, is_active')
    .or('thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%')   // only ads with a real creative
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (params.query) {
    const term = params.query.replace(/[%,()]/g, ' ').trim()
    if (term) q = q.or(`page_name.ilike.%${term}%,body.ilike.%${term}%,title.ilike.%${term}%,niche.ilike.%${term}%`)
  }
  if (params.format) q = q.ilike('format', `%${params.format}%`)
  if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  if (params.min_days_active) q = q.gte('days_running', params.min_days_active)

  const { data, error } = await q
  if (error) throw new Error(`Ad library: ${error.message}`)
  return {
    count: (data || []).length,
    ads: (data || []).map((a: any) => ({
      brand: a.page_name,
      headline: a.title || null,
      copy: (a.body || '').slice(0, 280),
      format: a.format,
      niche: a.niche || null,
      days_running: a.days_running ?? null,
      performance_tier: a.performance_tier || null,
      is_active: a.is_active,
      thumbnail_url: a.thumbnail_url || null,
    })),
  }
}
