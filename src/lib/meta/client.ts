import axios, { AxiosInstance } from 'axios'

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

import crypto from 'crypto'

// Meta access tokens are LIVE credentials to a user's ad account — they must be encrypted at rest, not
// merely encoded. We use AES-256-GCM (authenticated) with a key derived from ENCRYPTION_KEY. Format:
// "gcm:<ivHex>:<authTagHex>:<cipherHex>". decryptToken stays backward-compatible with the legacy
// base64 ("v1:") and aes-256-cbc formats so tokens stored before this change keep working (they'll be
// re-encrypted with GCM on the next connect/sync that re-saves the token).
function encKey(): Buffer {
  // sha256 → always exactly 32 bytes regardless of the env string's length.
  return crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY || 'selfmade2025secretkey1234567890ab')).digest()
}

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv)
  const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptToken(encrypted: string): string {
  // New authenticated format.
  if (encrypted.startsWith('gcm:')) {
    try {
      const [, ivHex, tagHex, dataHex] = encrypted.split(':')
      const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
    } catch { return '' }   // tampered/undecryptable → empty (caller treats as no token), never the ciphertext
  }
  // Legacy base64 ("encoding") tokens from before real encryption existed.
  if (encrypted.startsWith('v1:')) {
    return Buffer.from(encrypted.split(':')[1], 'base64').toString('utf8')
  }
  // Legacy aes-256-cbc "<ivHex>:<dataHex>".
  try {
    const [ivHex, encryptedData] = encrypted.split(':')
    const key = String(process.env.ENCRYPTION_KEY || 'selfmade2025secretkey1234567890ab').slice(0, 32)
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(ivHex, 'hex'))
    return decipher.update(encryptedData, 'hex', 'utf8') + decipher.final('utf8')
  } catch {
    return encrypted
  }
}

export class MetaClient {
  private client: AxiosInstance
  private accountId: string

  constructor(accessToken: string, accountId: string) {
    this.accountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`
    this.client = axios.create({
      baseURL: BASE_URL,
      params: { access_token: accessToken },
    })
    this.client.interceptors.response.use(
      res => res,
      err => {
        const meta = err.response?.data?.error
        if (meta) throw new Error(`Meta API Error ${meta.code}: ${meta.message}`)
        throw err
      }
    )
  }

  async getCampaigns(fields?: string) {
    const f = fields || 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time'
    const res = await this.client.get(`/${this.accountId}/campaigns`, { params: { fields: f, limit: 100 } })
    return res.data.data
  }

  async getAdSets(campaignId?: string) {
    const endpoint = campaignId ? `/${campaignId}/adsets` : `/${this.accountId}/adsets`
    const res = await this.client.get(endpoint, {
      params: { fields: 'id,name,campaign_id,status,daily_budget,targeting,optimization_goal,billing_event', limit: 100 }
    })
    return res.data.data
  }

  async getCampaignInsights(entityId: string, datePreset: string = 'last_30d') {
    const res = await this.client.get(`/${entityId}/insights`, {
      params: {
        fields: 'spend,impressions,clicks,ctr,cpm,cpc,actions,action_values,reach,date_start,date_stop',
        date_preset: datePreset,
        level: 'campaign',
      }
    })
    return res.data.data.map((insight: Record<string, unknown>) => {
      const actions = (insight.actions as {action_type:string;value:string}[]) || []
      const actionValues = (insight.action_values as {action_type:string;value:string}[]) || []
      const purchases = actions.find(a => a.action_type === 'purchase')
      const purchaseValue = actionValues.find(a => a.action_type === 'purchase')
      const leads = actions.find(a => a.action_type === 'lead')
      const conversions = Number(purchases?.value || leads?.value || 0)
      const conversionValue = Number(purchaseValue?.value || 0)
      const spend = Number(insight.spend || 0)
      return {
        campaign_id: entityId,
        date_start: insight.date_start,
        date_stop: insight.date_stop,
        spend,
        impressions: Number(insight.impressions || 0),
        clicks: Number(insight.clicks || 0),
        ctr: Number(insight.ctr || 0),
        cpm: Number(insight.cpm || 0),
        cpc: Number(insight.cpc || 0),
        conversions,
        conversion_value: conversionValue,
        roas: spend > 0 ? conversionValue / spend : 0,
        cpa: conversions > 0 ? spend / conversions : 0,
        reach: Number(insight.reach || 0),
      }
    })
  }

  // Account-level frequency (avg times each person saw an ad). Meta returns `frequency` directly; fall
  // back to impressions/reach. Best-effort → null on any error, so callers degrade to "no data".
  async getAccountFrequency(datePreset = 'last_30d'): Promise<number | null> {
    try {
      const res = await this.client.get(`/${this.accountId}/insights`, {
        params: { fields: 'frequency,reach,impressions', date_preset: datePreset, level: 'account' },
      })
      const row = res.data?.data?.[0]
      if (!row) return null
      const freq = Number(row.frequency || 0)
      if (freq > 0) return freq
      const reach = Number(row.reach || 0), impr = Number(row.impressions || 0)
      return reach > 0 ? impr / reach : null
    } catch { return null }
  }

  // Count of currently-ACTIVE ads (creatives) in the account. Best-effort → null on error.
  async getActiveAdCount(): Promise<number | null> {
    try {
      const res = await this.client.get(`/${this.accountId}/ads`, {
        params: { fields: 'id', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]), limit: 500, summary: 'total_count' },
      })
      const total = res.data?.summary?.total_count
      if (typeof total === 'number') return total
      return Array.isArray(res.data?.data) ? res.data.data.length : null
    } catch { return null }
  }

  async pauseCampaign(campaignId: string) {
    const res = await this.client.post(`/${campaignId}`, { status: 'PAUSED' })
    return res.data
  }

  async activateCampaign(campaignId: string) {
    const res = await this.client.post(`/${campaignId}`, { status: 'ACTIVE' })
    return res.data
  }

  async pauseAdSet(adSetId: string) {
    const res = await this.client.post(`/${adSetId}`, { status: 'PAUSED' })
    return res.data
  }

  async scaleAdSetBudget(adSetId: string, newDailyBudget: number) {
    const res = await this.client.post(`/${adSetId}`, { daily_budget: Math.round(newDailyBudget * 100) })
    return res.data
  }

  /** Campaign-level (CBO) daily budget update — dollars in, cents to Graph. */
  async scaleCampaignBudget(campaignId: string, newDailyBudget: number) {
    const res = await this.client.post(`/${campaignId}`, { daily_budget: Math.round(newDailyBudget * 100) })
    return res.data
  }

  async updateAdSet(adSetId: string, updates: Record<string, unknown>) {
    const res = await this.client.post(`/${adSetId}`, updates)
    return res.data
  }

  async uploadAdImage(imageUrl: string) {
    try {
      const res = await this.client.post(`/${this.accountId}/adimages`, { url: imageUrl })
      return res.data
    } catch { return {} }
  }

  async createCampaign(payload: Record<string, unknown>) {
    const res = await this.client.post(`/${this.accountId}/campaigns`, { ...payload, special_ad_categories: [] })
    return res.data
  }

  async createAdSet(payload: Record<string, unknown>) {
    const res = await this.client.post(`/${this.accountId}/adsets`, payload)
    return res.data
  }

  async createAdCreative(payload: Record<string, unknown>) {
    const res = await this.client.post(`/${this.accountId}/adcreatives`, payload)
    return res.data
  }

  async createAd(payload: Record<string, unknown>) {
    const res = await this.client.post(`/${this.accountId}/ads`, payload)
    return res.data
  }

  async launchFullCampaign(draft: {
    campaignName: string
    objective: string
    targeting: Record<string, unknown>
    dailyBudget: number
    startTime: string
    endTime?: string
    pageId: string
    creative: {
      imageHash?: string
      headline: string
      primaryText: string
      cta: string
      linkUrl: string
    }
  }) {
    const campaign = await this.createCampaign({ name: draft.campaignName, objective: draft.objective, status: 'PAUSED' })
    const adSet = await this.createAdSet({
      name: `${draft.campaignName} — Ad Set`,
      campaign_id: campaign.id,
      daily_budget: Math.round(draft.dailyBudget * 100),
      start_time: draft.startTime,
      end_time: draft.endTime,
      targeting: draft.targeting,
      optimization_goal: draft.objective === 'OUTCOME_LEADS' ? 'LEAD_GENERATION' : 'OFFSITE_CONVERSIONS',
      billing_event: 'IMPRESSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      status: 'PAUSED',
    })
    const creative = await this.createAdCreative({
      name: `${draft.campaignName} — Creative`,
      object_story_spec: {
        page_id: draft.pageId,
        link_data: {
          image_hash: draft.creative.imageHash,
          link: draft.creative.linkUrl,
          message: draft.creative.primaryText,
          name: draft.creative.headline,
          call_to_action: { type: draft.creative.cta, value: { link: draft.creative.linkUrl } },
        },
      },
    })
    const ad = await this.createAd({
      name: `${draft.campaignName} — Ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    })
    await this.activateCampaign(campaign.id)
    await this.updateAdSet(adSet.id, { status: 'ACTIVE' })
    await this.client.post(`/${ad.id}`, { status: 'ACTIVE' })
    return { campaign_id: campaign.id, adset_id: adSet.id, creative_id: creative.id, ad_id: ad.id }
  }
}

export async function createMetaClientForUser(userId: string, accountId?: string) {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const supabase = createAdminClient()
  const query = supabase.from('meta_accounts').select('*').eq('user_id', userId).eq('status', 'active')
  if (accountId) query.eq('account_id', accountId)
  else query.eq('is_primary', true)
  const { data: account, error } = await query.single()
  if (error || !account) throw new Error('No connected Meta account found')
  const token = decryptToken(account.access_token)
  return new MetaClient(token, account.account_id)
}
