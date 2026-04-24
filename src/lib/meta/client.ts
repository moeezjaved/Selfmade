import axios, { AxiosInstance } from 'axios'

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

export function encryptToken(token: string): string {
  const key = (process.env.ENCRYPTION_KEY || 'selfmade2025secretkey1234567890ab').slice(0, 32)
  const encoded = Buffer.from(token).toString('base64')
  return `v1:${encoded}:${key.slice(0,4)}`
}

export function decryptToken(encrypted: string): string {
  if (encrypted.startsWith('v1:')) {
    const parts = encrypted.split(':')
    return Buffer.from(parts[1], 'base64').toString('utf8')
  }
  try {
    const crypto = require('crypto')
    const [ivHex, encryptedData] = encrypted.split(':')
    const key = (process.env.ENCRYPTION_KEY || 'selfmade2025secretkey1234567890ab').slice(0, 32)
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv)
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
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
