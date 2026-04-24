import axios, { AxiosInstance } from 'axios'
import {
  MetaAdAccount,
  MetaCampaignCreatePayload,
  MetaAdSetCreatePayload,
  MetaAdCreativeCreatePayload,
  MetaAdCreatePayload,
  CampaignInsights,
} from '@/types'

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

// ── Token encryption helpers ──────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!

export function encryptToken(token: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8').slice(0, 32), iv)
  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export function decryptToken(encrypted: string): string {
  const [ivHex, encryptedData] = encrypted.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8').slice(0, 32), iv)
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ── Meta API Client class ────────────────────────────────────
export class MetaClient {
  private client: AxiosInstance
  private accessToken: string
  private accountId: string

  constructor(accessToken: string, accountId: string) {
    this.accessToken = accessToken
    this.accountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`

    this.client = axios.create({
      baseURL: BASE_URL,
      params: { access_token: accessToken },
    })

    // Error interceptor
    this.client.interceptors.response.use(
      res => res,
      err => {
        const meta = err.response?.data?.error
        if (meta) {
          throw new Error(`Meta API Error ${meta.code}: ${meta.message}`)
        }
        throw err
      }
    )
  }

  // ── ACCOUNT ────────────────────────────────────────────────

  async getAccount(): Promise<MetaAdAccount> {
    const res = await this.client.get(`/${this.accountId}`, {
      params: {
        fields: 'id,name,currency,timezone_name,account_status,amount_spent,balance',
      },
    })
    return res.data
  }

  async getAdAccounts(): Promise<MetaAdAccount[]> {
    const res = await this.client.get('/me/adaccounts', {
      params: {
        fields: 'id,account_id,name,currency,timezone_name,account_status,amount_spent',
      },
    })
    return res.data.data
  }

  // ── CAMPAIGNS ──────────────────────────────────────────────

  async getCampaigns(fields?: string) {
    const defaultFields = 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time'
    const res = await this.client.get(`/${this.accountId}/campaigns`, {
      params: { fields: fields || defaultFields, limit: 100 },
    })
    return res.data.data
  }

  async createCampaign(payload: MetaCampaignCreatePayload) {
    const res = await this.client.post(`/${this.accountId}/campaigns`, {
      ...payload,
      special_ad_categories: [],
    })
    return res.data // { id: 'campaign_id' }
  }

  async updateCampaign(campaignId: string, updates: Partial<MetaCampaignCreatePayload>) {
    const res = await this.client.post(`/${campaignId}`, updates)
    return res.data
  }

  async pauseCampaign(campaignId: string) {
    return this.updateCampaign(campaignId, { status: 'PAUSED' })
  }

  async activateCampaign(campaignId: string) {
    return this.updateCampaign(campaignId, { status: 'ACTIVE' })
  }

  // ── AD SETS ────────────────────────────────────────────────

  async getAdSets(campaignId?: string) {
    const endpoint = campaignId
      ? `/${campaignId}/adsets`
      : `/${this.accountId}/adsets`
    const res = await this.client.get(endpoint, {
      params: {
        fields: 'id,name,campaign_id,status,daily_budget,targeting,optimization_goal,billing_event',
        limit: 100,
      },
    })
    return res.data.data
  }

  async createAdSet(payload: MetaAdSetCreatePayload) {
    const res = await this.client.post(`/${this.accountId}/adsets`, payload)
    return res.data
  }

  async updateAdSet(adSetId: string, updates: Record<string, unknown>) {
    const res = await this.client.post(`/${adSetId}`, updates)
    return res.data
  }

  async pauseAdSet(adSetId: string) {
    return this.updateAdSet(adSetId, { status: 'PAUSED' })
  }

  async scaleAdSetBudget(adSetId: string, newDailyBudget: number) {
    // Meta API uses cents
    return this.updateAdSet(adSetId, { daily_budget: Math.round(newDailyBudget * 100) })
  }

  // ── ADS ────────────────────────────────────────────────────

  async getAds(adSetId?: string) {
    const endpoint = adSetId ? `/${adSetId}/ads` : `/${this.accountId}/ads`
    const res = await this.client.get(endpoint, {
      params: {
        fields: 'id,name,adset_id,status,creative{id,name,thumbnail_url,body,title,image_url}',
        limit: 100,
      },
    })
    return res.data.data
  }

  async createAdCreative(payload: MetaAdCreativeCreatePayload) {
    const res = await this.client.post(`/${this.accountId}/adcreatives`, payload)
    return res.data
  }

  async uploadAdImage(imageUrl: string) {
    // Upload image by URL to get image hash
    const res = await this.client.post(`/${this.accountId}/adimages`, {
      url: imageUrl,
    })
    return res.data
  }

  async uploadAdImageFromBytes(imageBytes: string, imageName: string) {
    const res = await this.client.post(`/${this.accountId}/adimages`, {
      bytes: imageBytes,
      name: imageName,
    })
    return res.data
  }

  async createAd(payload: MetaAdCreatePayload) {
    const res = await this.client.post(`/${this.accountId}/ads`, payload)
    return res.data
  }

  async pauseAd(adId: string) {
    const res = await this.client.post(`/${adId}`, { status: 'PAUSED' })
    return res.data
  }

  // ── INSIGHTS ───────────────────────────────────────────────

  async getCampaignInsights(
    entityId: string,
    datePreset: string = 'last_30d'
  ): Promise<CampaignInsights[]> {
    const res = await this.client.get(`/${entityId}/insights`, {
      params: {
        fields: [
          'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'cpc',
          'actions', 'action_values', 'reach', 'date_start', 'date_stop',
        ].join(','),
        date_preset: datePreset,
        level: 'campaign',
      },
    })

    return res.data.data.map((insight: Record<string, unknown>) => {
      const actions = (insight.actions as { action_type: string; value: string }[]) || []
      const actionValues = (insight.action_values as { action_type: string; value: string }[]) || []
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

  async getAccountInsights(datePreset: string = 'last_30d') {
    return this.getCampaignInsights(this.accountId, datePreset)
  }

  // ── AUDIENCES ──────────────────────────────────────────────

  async getCustomAudiences() {
    const res = await this.client.get(`/${this.accountId}/customaudiences`, {
      params: { fields: 'id,name,subtype,approximate_count', limit: 50 },
    })
    return res.data.data
  }

  async searchInterests(query: string) {
    const res = await this.client.get('/search', {
      params: {
        type: 'adinterest',
        q: query,
        limit: 20,
      },
    })
    return res.data.data
  }

  // ── PAGES ──────────────────────────────────────────────────

  async getPages() {
    const res = await this.client.get('/me/accounts', {
      params: { fields: 'id,name,access_token,category' },
    })
    return res.data.data
  }

  // ── FULL CAMPAIGN LAUNCH ────────────────────────────────────
  // This is the main function called when user clicks "Launch"
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
      imageUrl?: string
      headline: string
      primaryText: string
      description?: string
      cta: string
      linkUrl: string
    }
  }) {
    // Step 1: Create campaign
    const campaign = await this.createCampaign({
      name: draft.campaignName,
      objective: draft.objective,
      status: 'PAUSED', // Start paused, activate after review
      special_ad_categories: [],
    })

    // Step 2: Create ad set
    const adSet = await this.createAdSet({
      name: `${draft.campaignName} — Ad Set`,
      campaign_id: campaign.id,
      daily_budget: Math.round(draft.dailyBudget * 100), // cents
      start_time: draft.startTime,
      end_time: draft.endTime,
      targeting: draft.targeting,
      optimization_goal: draft.objective === 'OUTCOME_LEADS' ? 'LEAD_GENERATION' : 'OFFSITE_CONVERSIONS',
      billing_event: 'IMPRESSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      status: 'PAUSED',
    })

    // Step 3: Create ad creative
    const creative = await this.createAdCreative({
      name: `${draft.campaignName} — Creative`,
      object_story_spec: {
        page_id: draft.pageId,
        link_data: {
          image_hash: draft.creative.imageHash,
          link: draft.creative.linkUrl,
          message: draft.creative.primaryText,
          name: draft.creative.headline,
          description: draft.creative.description,
          call_to_action: {
            type: draft.creative.cta,
            value: { link: draft.creative.linkUrl },
          },
        },
      },
    })

    // Step 4: Create ad
    const ad = await this.createAd({
      name: `${draft.campaignName} — Ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    })

    // Step 5: Activate campaign (after all pieces are set)
    await this.activateCampaign(campaign.id)
    await this.updateAdSet(adSet.id, { status: 'ACTIVE' })
    await this.client.post(`/${ad.id}`, { status: 'ACTIVE' })

    return {
      campaign_id: campaign.id,
      adset_id: adSet.id,
      creative_id: creative.id,
      ad_id: ad.id,
    }
  }
}

// ── Factory: create client from stored account ───────────────
export async function createMetaClientForUser(userId: string, accountId?: string) {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const supabase = createAdminClient()

  const query = supabase
    .from('meta_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (accountId) query.eq('account_id', accountId)
  else query.eq('is_primary', true)

  const { data: account, error } = await query.single()

  if (error || !account) throw new Error('No connected Meta account found')

  const token = decryptToken(account.access_token)
  return new MetaClient(token, account.account_id)
}
