/**
 * Plans, entitlements & action costs — the single source of truth the whole app reads from
 * (pricing spec §1, §2.3, §4). Plans live in code (versioned) not a table; the `plans` DB row only
 * carries billing basics (price/credits/seats/stripe_price_id). Creation tools (Mello, Scripts,
 * Transcribe, Image/Video Clone) are available on EVERY tier — gated by CREDIT BALANCE, not a flag.
 */

export type PlanId = 'free' | 'starter' | 'pro' | 'business' | 'enterprise'

export interface PlanEntitlements {
  label: string
  priceMonthly: number         // USD/mo (0 = free, null-ish for enterprise custom)
  priceAnnualMonthly: number   // USD/mo billed annually (~25% off)
  monthlyCredits: number | null // null = custom (enterprise)
  welcomeCredits?: number      // one-time top-up grant on signup (free only)
  seats: number
  brandSpy: number             // tracked-brand cap (Infinity = unlimited)
  discoveryPages: number | null // Free is capped; null = uncapped
  aiInsights: boolean          // Patterns / AI Insights
  launch: boolean              // Launch Ads
  campaigns: boolean           // Campaigns / Scale & Insights / Deep Reports
  api: boolean                 // API / MCP access
  exports: boolean             // CSV / creative downloads
  canBuyCredits: boolean       // top-ups allowed
  teamBoards: boolean          // shared/org-visible boards (Pro+); personal boards always allowed
  assetsGb: number | null      // uploaded-asset storage cap in GB (null = uncapped/custom)
  mostPopular?: boolean
}

export const PLANS: Record<PlanId, PlanEntitlements> = {
  free: {
    label: 'Free', priceMonthly: 0, priceAnnualMonthly: 0,
    monthlyCredits: 20, welcomeCredits: 60, seats: 1, brandSpy: 1, discoveryPages: 3,
    aiInsights: false, launch: false, campaigns: false, api: false, exports: false, canBuyCredits: false,
    teamBoards: false, assetsGb: 0.5,
  },
  starter: {
    label: 'Starter', priceMonthly: 39, priceAnnualMonthly: 29,
    monthlyCredits: 150, seats: 1, brandSpy: 15, discoveryPages: null,
    aiInsights: false, launch: false, campaigns: false, api: false, exports: true, canBuyCredits: true,
    teamBoards: false, assetsGb: 5,
  },
  pro: {
    label: 'Pro', priceMonthly: 99, priceAnnualMonthly: 74,
    monthlyCredits: 500, seats: 3, brandSpy: 50, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: false, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 50, mostPopular: true,
  },
  business: {
    label: 'Business', priceMonthly: 249, priceAnnualMonthly: 186,
    monthlyCredits: 2000, seats: 10, brandSpy: 150, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: true, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 250,
  },
  enterprise: {
    label: 'Enterprise', priceMonthly: 0, priceAnnualMonthly: 0,
    monthlyCredits: null, seats: 25, brandSpy: Infinity, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: true, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: null,
  },
}

export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'pro', 'business', 'enterprise']

/** Map any legacy/unknown plan id to a valid PlanId (trial→free, core→starter, plus→pro). */
export function normalizePlan(id?: string | null): PlanId {
  const map: Record<string, PlanId> = { trial: 'free', core: 'starter', plus: 'pro' }
  const v = (id || 'free') as string
  if (v in PLANS) return v as PlanId
  return map[v] || 'free'
}

export function planEntitlements(id?: string | null): PlanEntitlements {
  return PLANS[normalizePlan(id)]
}

/** The next tier up from a given plan (for "Upgrade to X" CTAs). */
export function nextPlan(id?: string | null): PlanId | null {
  const i = PLAN_ORDER.indexOf(normalizePlan(id))
  return i >= 0 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null
}

/** The cheapest plan that unlocks a boolean feature (for targeted upsell). */
export function firstPlanWith(feature: keyof PlanEntitlements): PlanId {
  for (const p of PLAN_ORDER) if (PLANS[p][feature]) return p
  return 'enterprise'
}

// ── Action costs (credits) — pricing spec §2.3. Mirrors the credit_pricing table (which is the
// runtime source of truth via reserve_credits); kept here for client display + defaults. ──
export const ACTION_COSTS: Record<string, number> = {
  transcribe: 2,
  script_generate: 5,
  script_duplicate: 5,
  brand_analysis: 3,
  review_mining: 3,
  ask_mello: 1,
  image_clone_pro: 15,      // 2K Nano Banana Pro — DEFAULT ad clone
  image_clone_4k: 25,       // 4K / HD download
  image_studio_pro: 15,     // 2K AI Ad Studio — original ad from inspiration + industry insights
  image_studio_4k: 25,      // 4K / HD Studio ad
  image_edit_pro: 10,       // iterative edit (one 2K Pro image)
  video_clone: 40,          // short AI video clip
}

// ── Top-up packs — pricing spec §3.1 ──
export interface TopupPack { id: string; credits: number; priceUsd: number }
export const TOPUP_PACKS: TopupPack[] = [
  { id: 'small', credits: 250, priceUsd: 19 },
  { id: 'medium', credits: 750, priceUsd: 49 },
  { id: 'large', credits: 2000, priceUsd: 119 },
]

/** Structured upsell payload returned by server gates so the UI shows the right modal. */
export interface UpsellResponse {
  error: 'plan_limit'
  limit: string
  current?: number
  max?: number | null
  upgradeTo: PlanId
  message: string
}
