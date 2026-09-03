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
  monthlyCredits: number | null // null = custom (enterprise). For SUBSCRIBERS this is the VIDEO budget
                                // (images are free — see imagesUnlimited); 1 video = 600 cr.
  welcomeCredits?: number      // one-time top-up grant on signup (free only)
  seats: number
  brandSpy: number             // tracked-brand cap (Infinity = unlimited)
  expressPulls: number         // on-demand brand ad-pulls PER DAY (IPRoyal cost control + upgrade lever)
  discoveryPages: number | null // Free is capped; null = uncapped
  aiInsights: boolean          // Patterns / AI Insights
  launch: boolean              // Launch Ads
  campaigns: boolean           // Campaigns / Scale & Insights / Deep Reports
  inbox?: boolean              // customer inbox (Creator+); Free gets an upgrade prompt
  api: boolean                 // API / MCP access
  exports: boolean             // CSV / creative downloads
  canBuyCredits: boolean       // top-ups allowed
  teamBoards: boolean          // shared/org-visible boards (Pro+); personal boards always allowed
  assetsGb: number | null      // uploaded-asset storage cap in GB (null = uncapped/custom)
  // ── Pricing-model v2 (2026-07-17): the customer sees VIDEOS & IMAGES, never credits. ──
  videosPerMonth?: number | null // how many video ads/mo the credit pool covers (display); null = pay-as-you-go / custom
  imagesUnlimited?: boolean    // subscribers: image remakes are FREE + unlimited (charged 0 credits in reserveCredits)
  hidden?: boolean             // kept as a valid tier but NOT shown on the pricing page (legacy 'pro')
  mostPopular?: boolean
}

// ── Pricing model v2 (2026-07-17, LOCKED) ── The customer sees VIDEOS & IMAGES, not credits.
// Internal ids are KEPT to avoid a data migration: `starter` IS "Creator", `business` IS "Agency",
// `pro` is hidden (legacy). Subscribers get FREE unlimited image ads; their credit pool = video budget
// (1 video = 600 cr). Free = a taste of images; Pay-as-you-go (the $9 launch top-up) needs no plan.
export const PLANS: Record<PlanId, PlanEntitlements> = {
  free: {
    label: 'Free', priceMonthly: 0, priceAnnualMonthly: 0,
    // Free = a ONE-TIME 75-credit trial (5 image ads @ 15 cr each). No monthly refill, and free users
    // CANNOT buy credits — when the 75 run out, generating media prompts an upgrade to a paid plan.
    monthlyCredits: 0, welcomeCredits: 75, seats: 1, brandSpy: 1, expressPulls: 3, discoveryPages: 3,
    aiInsights: false, launch: false, campaigns: false, api: false, exports: false, canBuyCredits: false,
    teamBoards: false, assetsGb: 0.5, videosPerMonth: 0, imagesUnlimited: false, inbox: false,
  },
  // "Creator" — the ONLY paid plan now (one-plan model, 2026-08-01). It unlocks the whole app:
  // Patterns/AI Insights, Launch (M4), Campaigns/Scale & Insights, API — the Meta cockpit included.
  // 6,000 cr = 10 video ads/mo; image ads free + unlimited.
  starter: {
    label: 'Creator', priceMonthly: 49, priceAnnualMonthly: 49,
    monthlyCredits: 6000, seats: 3, brandSpy: 15, expressPulls: 15, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: true, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 5, videosPerMonth: 10, imagesUnlimited: false, inbox: true, mostPopular: true,
  },
  // Legacy 'pro' — kept valid for any existing subscriber, HIDDEN from the pricing page.
  pro: {
    label: 'Pro', priceMonthly: 99, priceAnnualMonthly: 74,
    monthlyCredits: 12000, seats: 3, brandSpy: 50, expressPulls: 50, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: false, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 50, videosPerMonth: 20, imagesUnlimited: false, inbox: true, hidden: true,
  },
  // "Agency" — teams. 18,000 cr = 30 video ads/mo; image ads free + unlimited; 5 seats.
  business: {
    label: 'Agency', priceMonthly: 149, priceAnnualMonthly: 149,
    monthlyCredits: 18000, seats: 5, brandSpy: 50, expressPulls: 50, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: true, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: 50, videosPerMonth: 30, imagesUnlimited: false, inbox: true,
  },
  enterprise: {
    label: 'Enterprise', priceMonthly: 0, priceAnnualMonthly: 0,
    monthlyCredits: null, seats: 25, brandSpy: Infinity, expressPulls: Infinity, discoveryPages: null,
    aiInsights: true, launch: true, campaigns: true, api: true, exports: true, canBuyCredits: true,
    teamBoards: true, assetsGb: null, videosPerMonth: null, imagesUnlimited: false, inbox: true,
  },
}

// Order for upsell math. ONE-PLAN model (2026-08-01): only Free → Creator. 'pro'/'business'(Agency)/
// 'enterprise' stay valid tiers in PLANS (legacy subscribers keep their entitlements) but are OUT of
// the ladder, so nothing ever upsells to "Agency" and firstPlanWith() resolves gated features to Creator.
export const PLAN_ORDER: PlanId[] = ['free', 'starter']

/** Plans whose image remakes are free + unlimited (subscribers). Used by reserveCredits. */
export function imagesAreFree(planId?: string | null): boolean {
  return !!PLANS[normalizePlan(planId)]?.imagesUnlimited
}

/** The paid plans shown on the pricing page. One-plan model → just Creator. */
export const PRICING_PLANS: PlanId[] = ['starter']

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
  image_clone_pro: 15,      // 2K Nano Banana Pro — DEFAULT ad clone ($0.15, matches CloneModal)
  image_clone_4k: 25,       // 4K / HD download ($0.25)
  image_studio_pro: 15,     // 2K AI Ad Studio — original ad ($0.15). Flat "image ad = 15 cr" (mig 168), same as a clone.
  image_studio_4k: 25,      // 4K / HD Studio ad ($0.25) — same as a 4K clone (mig 168)
  image_edit_pro: 15,       // iterative edit — one 2K Pro image, same cost as a fresh clone ($0.15). Free for subscribers.
  video_clone: 600,         // UGC 15s ($6.00 @ 1cr=1¢) — the "video ad = $6" anchor (v2 pricing)
  video_captions: 100,      // TikTok-style burned captions — high-margin add-on
  asset_ai_tag: 10,         // AI tagging of an uploaded asset (caption/embed + video clip analysis)
  brand_spy: 50,            // spy a competitor — start tracking + thorough ad-library crawl ($0.50)
  page_build: 150,          // Page Builder — AI copy for one landing page ($1.50). Images billed per image.
}

// Retired 2026-07-29: no free images on any plan — every image ad is charged its credit_pricing price
// ($0.15). (The DB stopped free-images in migration 104; this app-layer set is now empty to match.)
export const FREE_FOR_SUBSCRIBERS = new Set<string>()

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
  atLimit?: boolean   // true = already on the top visible plan, no upgrade path → "remove one to add another"
  message: string
}
