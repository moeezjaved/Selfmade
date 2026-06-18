// ── USER & AUTH ──────────────────────────────────────────────
export interface User {
  id: string
  email: string
  full_name: string
  avatar_url?: string
  created_at: string
}

export interface UserProfile {
  id: string
  user_id: string
  business_type: 'ecommerce' | 'saas' | 'leadgen' | 'service' | 'solo' | 'other'
  niche?: string
  monthly_ad_spend?: string
  experience_level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  onboarding_completed: boolean
  stripe_customer_id?: string
  stripe_subscription_id?: string
  subscription_status: 'trialing' | 'active' | 'canceled' | 'past_due'
  trial_ends_at?: string
  created_at: string
  updated_at: string
}

// ── META ACCOUNT ─────────────────────────────────────────────
export interface MetaAccount {
  id: string
  user_id: string
  account_id: string           // act_xxxxx
  account_name: string
  access_token: string         // encrypted in DB
  token_expires_at?: string
  currency: string
  timezone: string
  status: 'active' | 'disconnected' | 'error'
  is_primary: boolean
  created_at: string
  updated_at: string
}

// ── CAMPAIGNS ────────────────────────────────────────────────
export interface Campaign {
  id: string
  user_id: string
  meta_account_id: string
  meta_campaign_id: string
  name: string
  objective: 'OUTCOME_SALES' | 'OUTCOME_LEADS' | 'OUTCOME_TRAFFIC' | 'OUTCOME_AWARENESS'
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  daily_budget?: number
  lifetime_budget?: number
  start_time?: string
  stop_time?: string
  created_at: string
  updated_at: string
  // Insights (joined)
  insights?: CampaignInsights
}

export interface CampaignInsights {
  campaign_id: string
  date_start: string
  date_stop: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpm: number
  cpc: number
  conversions: number
  conversion_value: number
  roas: number
  cpa: number
  reach: number
}

// ── AD SETS ──────────────────────────────────────────────────
export interface AdSet {
  id: string
  campaign_id: string
  meta_adset_id: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED'
  daily_budget?: number
  targeting: AdSetTargeting
  optimization_goal: string
  billing_event: string
  insights?: CampaignInsights
}

export interface AdSetTargeting {
  age_min: number
  age_max: number
  genders?: number[]              // 1=male, 2=female
  geo_locations: {
    countries?: string[]
    cities?: { key: string; name: string; region: string }[]
  }
  interests?: { id: string; name: string }[]
  behaviors?: { id: string; name: string }[]
  custom_audiences?: { id: string; name: string }[]
  excluded_custom_audiences?: { id: string; name: string }[]
  publisher_platforms?: string[]
}

// ── ADS ──────────────────────────────────────────────────────
export interface Ad {
  id: string
  adset_id: string
  meta_ad_id: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED'
  creative: AdCreative
  insights?: CampaignInsights
}

export interface AdCreative {
  id?: string
  meta_creative_id?: string
  headline: string
  primary_text: string
  description?: string
  cta: CTAType
  image_url?: string
  image_hash?: string
  video_id?: string
  link_url: string
}

export type CTAType = 
  | 'SHOP_NOW' 
  | 'LEARN_MORE' 
  | 'SIGN_UP' 
  | 'GET_OFFER'
  | 'BOOK_TRAVEL'
  | 'CONTACT_US'
  | 'DOWNLOAD'

// ── RECOMMENDATIONS ──────────────────────────────────────────
export type RecommendationType = 
  | 'PAUSE'
  | 'SCALE'  
  | 'TEST_CREATIVE'
  | 'ADJUST_BUDGET'
  | 'AUDIENCE_EXPAND'
  | 'AUDIENCE_NARROW'
  | 'DUPLICATE'

export type RecommendationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED'

export interface Recommendation {
  id: string
  user_id: string
  meta_account_id: string
  campaign_id?: string
  adset_id?: string
  ad_id?: string
  type: RecommendationType
  title: string
  reasoning: string
  impact_estimate: string
  confidence_score: number          // 0-100
  status: RecommendationStatus
  meta_action?: Record<string, unknown>     // what will be sent to Meta API
  executed_at?: string
  execution_result?: Record<string, unknown>
  created_at: string
  updated_at: string
  // Relations
  campaign?: Campaign
  adset?: AdSet
}

// ── CREATIVE STUDIO ──────────────────────────────────────────
export interface CreativeAnalysis {
  id: string
  user_id: string
  ad_id?: string                    // source ad from Meta
  product: string
  niche?: string
  audience?: string
  winning_analysis: {
    hook_type: string
    emotional_trigger: string
    visual_style: string
    offer_type: string
    audience_intent: string
    why_winning: string[]
  }
  competitor_analysis: {
    has_data: boolean
    common_hooks: string[]
    visual_trends: string[]
    offer_patterns: string[]
    doing_better: string[]
    missing: string[]
  }
  strategy: {
    preserve: string[]
    improve: string[]
    test: string[]
  }
  variations: CreativeVariation[]
  created_at: string
}

export interface CreativeVariation {
  id: number
  name: string
  type: 'hook' | 'emotion' | 'comp' | 'audience' | 'premium' | 'gap'
  type_label: string
  hook: string
  headline: string
  primary_text: string
  cta: string
  visual: {
    composition: string
    subject: string
    background: string
    text_placement: string
    colors: string
  }
  design_style: string
  what_changed: string[]
  why_better: string
  image_prompt: string
}

// ── AD ENGINE ────────────────────────────────────────────────
export interface CampaignDraft {
  id?: string
  user_id?: string
  user_type: 'first_timer' | 'experienced'
  objective: 'OUTCOME_SALES' | 'OUTCOME_LEADS'
  campaign_name: string
  landing_url?: string
  targeting: Partial<AdSetTargeting>
  budget: {
    type: 'DAILY' | 'LIFETIME'
    amount: number
    start_date: string
    end_date?: string
  }
  placements: string[]
  creative: {
    mode: 'upload' | 'ai_generated' | 'competitor_inspired'
    image_url?: string
    image_hash?: string
    product_description?: string
    tone?: string[]
    competitors?: string[]
    competitor_insights?: string
    selected_copy_variant?: number
  }
  ai_strategy?: AIStrategyResult
  status: 'draft' | 'approved' | 'launched' | 'failed'
  meta_campaign_id?: string
  created_at?: string
}

export interface AIStrategyResult {
  audience: {
    personas: AudiencePersona[]
    targeting_summary: string
    score: number
  }
  creative: {
    variations: GeneratedCopyVariant[]
    image_direction: string
    score: number
  }
  funnel: {
    structure: string
    tof: string
    mof: string
    bof: string
    retargeting: string
    score: number
  }
  competitive: {
    patterns_found: string[]
    gaps: string[]
    recommended_angle: string
    score: number
  }
  budget: {
    daily: number
    est_cpm: string
    est_cpc: string
    est_cpa: string
    est_reach_day: string
    scaling_trigger: string
    score: number
  }
  composite_score: number
  top_recommendation: string
}

export interface AudiencePersona {
  name: string
  age: string
  gender: string
  interests: string[]
  behaviors: string[]
  pain_points: string[]
  why_they_buy: string
}

export interface GeneratedCopyVariant {
  id: number
  type: string
  hook: string
  headline: string
  primary_text: string
  cta: string
  why: string
}

// ── ACTIVITY LOG ─────────────────────────────────────────────
export interface ActivityLog {
  id: string
  user_id: string
  meta_account_id?: string
  action_type: 
    | 'CAMPAIGN_CREATED'
    | 'CAMPAIGN_PAUSED'
    | 'CAMPAIGN_SCALED'
    | 'AD_PAUSED'
    | 'BUDGET_ADJUSTED'
    | 'RECOMMENDATION_APPROVED'
    | 'RECOMMENDATION_REJECTED'
    | 'SYNC_COMPLETED'
    | 'CREATIVE_GENERATED'
    | 'AD_LAUNCHED'
  entity_type: 'campaign' | 'adset' | 'ad' | 'recommendation' | 'system'
  entity_id?: string
  entity_name?: string
  description: string
  meta_api_response?: Record<string, unknown>
  performed_by: 'user' | 'system'
  created_at: string
}

// ── BILLING ──────────────────────────────────────────────────
export interface Subscription {
  id: string
  user_id: string
  stripe_subscription_id: string
  stripe_price_id: string
  status: 'trialing' | 'active' | 'canceled' | 'past_due' | 'incomplete'
  plan: 'monthly' | 'annual'
  amount: number
  currency: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  trial_start?: string
  trial_end?: string
  created_at: string
}

// ── API RESPONSES ────────────────────────────────────────────
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  has_more: boolean
}

// ── META API ─────────────────────────────────────────────────
export interface MetaOAuthToken {
  access_token: string
  token_type: string
  expires_in?: number
}

export interface MetaAdAccount {
  id: string
  account_id: string
  name: string
  currency: string
  timezone_name: string
  account_status: number
  amount_spent: string
  balance: string
}

export interface MetaCampaignCreatePayload {
  name: string
  objective: string
  status: 'ACTIVE' | 'PAUSED'
  special_ad_categories: string[]
}

export interface MetaAdSetCreatePayload {
  name: string
  campaign_id: string
  daily_budget?: number
  lifetime_budget?: number
  start_time: string
  end_time?: string
  targeting: Record<string, unknown>
  optimization_goal: string
  billing_event: string
  bid_strategy: string
  status: 'ACTIVE' | 'PAUSED'
}

export interface MetaAdCreativeCreatePayload {
  name: string
  object_story_spec: {
    page_id: string
    link_data: {
      image_hash?: string
      link: string
      message: string
      name: string
      description?: string
      call_to_action: {
        type: string
        value: { link: string }
      }
    }
  }
}

export interface MetaAdCreatePayload {
  name: string
  adset_id: string
  creative: { creative_id: string }
  status: 'ACTIVE' | 'PAUSED'
}
