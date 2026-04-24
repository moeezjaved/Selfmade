import axios, { AxiosInstance } from 'axios'

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

// Simple encryption using base64 + XOR for token storage
// In production use proper AES encryption
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
  // Legacy format
  try {
    const { createDecipheriv } = require('crypto')
    const [ivHex, encryptedData] = encrypted.split(':')
    const key = (process.env.ENCRYPTION_KEY || 'selfmade2025secretkey1234567890ab').slice(0, 32)
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv)
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

  async getAccount() {
    const res = await this.client.get(`/${this.accountId}`, {
      params: { fields: 'id,name,currency,timezone_name,account_status,amount_spent,balance' },
    })
    return res.data
  }

  async getCampaigns(fields?: string) {
    const defaultFields = 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time'
    const res = await this.client.get(`/${this.accountId}/campaigns`, {
      params: { fields: fields || defaultFields, limit: 100 },
    })
    return res.data.data
  }

  async getCampaignInsights(entityId: string, datePreset: string = 'last_30d') {
    const res = await this.client.get(`/${entityId}/insights`, {
      params: {
        fields: 'spend,impressions,clicks,ctr,cpm,cpc,actions,action_values,reach,date_start,date_stop',
        date_preset: datePreset,
        level: 'campaign',
      },
    })
    return res.data.data.map((insight: any) => {
      const actions = insight.actions || []
      const actionValues = insight.action_values || []
      const purchases = actions.find((a: any) => a.action_type === 'purchase')
      const purchaseValue = actionValues.find((a: any) => a.action_type === 'purchase')
      const leads = actions.find((a: any) => a.action_type === 'lead')
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

  async getAdSets(campaignId?: string) {
    const endpoint = campaignId ? `/${campaignId}/adsets` : `/${this.accountId}/adsets`
    const res = await this.client.get(endpoint, {
      params: { fields: 'id,name,campaign_id,status,daily_budget,targeting,optimization_goal,billing_event', limit: 100 },
    })
    return res.data.data
  }

  async pauseCampaign(campaignId: string) {
    const res = await this.client.post(`/${campaignId}`, { status: 'PAUSED' })
    return res.data
  }

  async activateCampaign(campaignId: string) {
    const res = await this.client.post(`/${campaignId}`, { status: 'ACTIVE' })
    return res.data
  }

  async scaleAdSetBudget(adSetId: string, newDailyBudget: number) {
    const res = await this.client.post(`/${adSetId}`, { daily_budget: Math.round(newDailyBudget * 100) })
    return res.data
  }

  async pauseAdSet(adSetId: string) {
    const res = await this.client.post(`/${adSetId}`, { status: 'PAUSED' })
    return res.data
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
