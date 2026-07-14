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
  expressPulls: number         // on-demand brand ad-pulls PER DAY (IPRoyal cost control + upgrade lever)
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
    // canBuyCredits TRUE on Free (2026-07-14): the onboarding funnel sells the $9 Launch Pack to
    // free users at the video-clone moment — blocking free users from buying credits killed the
    // exact conversion we want. Subscriptions upsell separately.
    monthlyCredits: 100, welcomeCredits: 500, seats: 1, brandSpy: 1, expressPulls: 3, discoveryPages: 3,
    aiInsights: false, launch: false, campaigns: false, api: false, exports: false, canBuyCredits: true,
    teamBoards: false, assetsGb: 0.5,
  },
  starter: {
    label: 'Starter', priceMonthly: 39, priceAnnualMonthly: 29,
    monthlyCredits: 2000, seats: 1, brandSpy: 15, expressPulls: 15, discoveryPages: null,
    aiInsights: false, launch: false, campaigns: false, api: false, exports: true, canBuyCredits: true,
    teamBoards: false, assetsGb: 5,
  },
  pro: {
    label: 'Pro', priceMonthly: 99, priceAnnualMonthly: 74,
    monthlyCredits: 5000, seats: 3, brandSpy: 50, expressPulls: 50, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: false, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 50, mostPopular: true,
  },
  business: {
    label: 'Business', priceMonthly: 249, priceAnnualMonthly: 186,
    monthlyCredits: 15000, seats: 10, brandSpy: 150, expressPulls: 200, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: true, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 250,
  },
  enterprise: {
    label: 'Enterprise', priceMonthly: 0, priceAnnualMonthly: 0,
    monthlyCredits: null, seats: 25, brandSpy: Infinity, expressPulls: Infinity, discoveryPages: null,
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
// 1 credit = 1¢. Runtime source of truth is the credit_pricing DB table (reserve_credits reads it);
// these are the client display defaults, kept in sync with migration 095.
export const ACTION_COSTS: Record<string, number> = {
  transcribe: 15,
  script_generate: 35,
  script_duplicate: 35,
  brand_analysis: 20,
  review_mining: 20,
  ask_mello: 10,
  image_clone_pro: 100,     // 2K Nano Banana Pro — DEFAULT ad clone
  image_clone_4k: 160,      // 4K / HD download
  image_studio_pro: 100,    // 2K AI Ad Studio — original ad from inspiration + industry insights
  image_studio_4k: 160,     // 4K / HD Studio ad
  image_edit_pro: 65,       // iterative edit (one 2K Pro image)
  video_clone: 650,         // UGC 15s premium (2× fal cost) — video is a cost-plus loss-leader
  video_captions: 100,      // TikTok-style burned captions — high-margin add-on
  asset_ai_tag: 10,         // AI tagging of an uploaded asset (caption/embed + video clip analysis)
}

// ── Top-up packs — pricing spec §3.1 ──
export interface TopupPack { id: string; credits: number; priceUsd: number }
// 1 credit = 1¢. Bigger packs give progressively more than face value (bulk discount).
// 'launch' = the onboarding micro-pack: $9 covers one video clone (650cr) + change — bought at the
// moment of desire (they just tapped Clone video). One-time, no subscription — deliberately the
// anti-Higgsfield (they paywall generation behind an annual-default sub).
export const TOPUP_PACKS: TopupPack[] = [
  { id: 'launch', credits: 900, priceUsd: 9 },
  { id: 'small', credits: 2000, priceUsd: 19 },
  { id: 'medium', credits: 5500, priceUsd: 49 },
  { id: 'large', credits: 14000, priceUsd: 119 },
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
