# Pricing, Plans & Credits — Full Build Spec

Complete, build-ready spec for Self Made's subscription plans, credit system, top-ups, feature-gating,
and billing. Hand this to engineering and build end-to-end. Extends the existing credit ledger in
`credits-and-create-spec.md` (reserve/commit/refund) — this doc adds **plans, entitlements, top-ups,
monthly reset, and enforcement** on top of that ledger.

Positioning: Self Made is broader than any single competitor (Atria = intelligence only; Motion =
analytics only; GetHookd = spy+create). We do **Discovery + Brand Spy + Patterns + AI creation +
Launch + Campaigns + ROAS analytics** — so we undercut Atria ($129–959) 4–5× while offering more.

---

## 1. Plans (the tier matrix)

| | **Free** | **Starter** | **Pro** ⭐ | **Business** | **Enterprise** |
|---|---|---|---|---|---|
| **Monthly price** | $0 | **$39** | **$99** | **$249** | Custom |
| **Annual price** (~25% off) | $0 | $29/mo ($351/yr) | $74/mo ($888/yr) | $186/mo ($2,232/yr) | Custom |
| **Ad Discovery (search)** | Full search, **capped to 3 pages / ~60 results per query** | Full, uncapped + all filters | Full | Full | Full |
| **Filters** (perf, niche, hook, emotion, angle, format) | Basic only (time + niche) | All | All | All | All |
| **Brand Spy** (tracked brands) | **1** | **15** | **50** | **150** | **Unlimited** |
| **Patterns / AI Insights** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Top Picks** (curated packs) | Preview | ✅ | ✅ | ✅ | ✅ |
| **Saved Ads / Following / Boards** | 1 board, 25 saves | ✅ | ✅ | ✅ (team boards) | ✅ |
| **Ask Mello** (AI agent) | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Scripts / Transcribe** | Preview | ✅ (credits) | ✅ | ✅ | ✅ |
| **Image Clone** | ❌ | ❌ | ✅ (credits) | ✅ | ✅ |
| **Launch Ads** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Campaigns / Scale & Insights / Deep Reports** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Monthly credits** | **20** | **150** | **500** | **2,000** | Custom |
| **Seats** | 1 | 1 | 3 | 10 | 15+ |
| **API / MCP access** | ❌ | ❌ | ✅ | ✅ | ✅ (raised limits) |
| **Exports (CSV / download creatives)** | ❌ | Limited | ✅ | ✅ | ✅ |
| **Support** | Community | Email | Email | Priority | Dedicated + SSO |

**Notes**
- **"Most Popular" badge → Pro.** That's the tier the pricing page should visually push.
- **AI Insights (Patterns) is the #1 upgrade trigger** — gated at Pro+ (mirrors Atria gating it above Core).
- **Launch/Campaign management is the differentiator** vs pure spy tools — gated Pro (Launch) / Business (Campaigns).
- Free tier exists purely as a **signup funnel** — no credit purchases, no clone downloads, capped everything.

---

## 2. Credit system

### 2.1 Two separate buckets per account
Every account (org/user) has **two** credit balances, tracked separately:

| Bucket | Source | Resets? | Rolls over? | Expiry |
|---|---|---|---|---|
| **Plan credits** | Monthly plan allotment (20/150/500/2000) | **Reset to allotment every billing cycle** | **NO — use-it-or-lose-it** | End of billing cycle |
| **Top-up credits** | Purchased packs | Never reset | **YES — roll over** | 12 months from purchase |

**Total displayed balance = plan_credits + topup_credits.** UI must show both (e.g. "120 plan + 250 top-up = 370 credits").

### 2.2 Consumption order (critical)
When spending credits, **always drain plan credits first, then top-up credits.** This ensures the
monthly allotment is used before it's wiped at reset, and paid top-ups persist. Enforce in the spend function.

### 2.3 Action costs (credits per action)
Extend the existing costs. One shared currency across all generative/analytic actions:

| Action | Credits |
|---|---|
| Transcribe an ad | 2 |
| AI script (per script) | 5 |
| URL / brand analyze | 3 |
| Review mining | 3 |
| Ask Mello (per message) | 1 |
| **Image Clone — 1K** (standard Nano Banana) | **10** |
| **Image Clone — 2K** (Nano Banana Pro, **default**) | **15** |
| **Image Clone — 4K / HD** (Nano Banana Pro) | **25** |
| Video Clone (future) | 30 |

(Assets generated *via* Mello also charge the asset's own cost, e.g. Mello-triggered 2K Image Clone = 1 + 15.)

### 2.3.1 Image Clone — model & resolution (drives the credit cost above)
The clone pipeline uses **Nano Banana Pro (Gemini 3 Pro Image, `gemini-3-pro-image-preview`)** — chosen for
its **text rendering**, which standard Nano Banana garbles (critical for ad creatives with headlines/CTAs baked
into the image). Cost scales with **resolution**, so the credit cost tiers to match:

| Output | Real API cost | Credits | Notes |
|---|---|---|---|
| 1K (1024²), standard Nano Banana | $0.039 | 10 | cheapest; use for non-ad/simple images |
| **2K (≤2048²), Nano Banana Pro** | **$0.134** | **15** | **DEFAULT for ad clones** — plenty for feed/grid, ~44% cheaper than 4K |
| 4K (4096²), Nano Banana Pro | $0.24 | 25 | HD download only; explicit opt-in |

**Pipeline rules for engineering:**
- **Default all ad clones to 2K.** Ads display small (IG feed ~1080px) — 4K is wasted spend.
- Offer **4K only as an explicit "HD download"** button, charged at 25 credits.
- Do **NOT** use Batch mode for interactive clones (24h delay breaks the UX); real-time only.
- Do **NOT** route through third-party $0.05 image providers (reliability/ToS risk for a production feature).
- Watch **calls-per-clone**: cutout → composite → text-layer as separate Pro calls multiplies cost. Minimize gen calls; one Pro call per output where possible.

**Margin at these costs is not close** — even worst case (a Business user burning all 2,000 credits on 2K images
= 133 × $0.134 = ~$18) is ~93% margin against the $249 plan; top-ups at ~$0.076/credit yield ~5–8× on every image.

### 2.4 Spend mechanics — reserve / commit / refund (from existing ledger)
Reuse the pattern in `credits-and-create-spec.md`:
1. **Reserve** the cost before starting the action (deduct from balance, plan-first).
2. **Commit** on success (finalize the ledger entry).
3. **Refund** on failure (return the reserved credits to the same bucket they came from).

Every movement writes a `credit_ledger` row.

### 2.5 Monthly reset job
On billing-cycle rollover (per subscription, driven by Stripe `invoice.paid` or a daily cron checking `current_period_end`):
- Set `plan_credits_balance = plan.monthly_credits` (overwrite — **no rollover**).
- Do **not** touch `topup_credits_balance`.
- Write a ledger row: `type='plan_grant', bucket='plan', delta=monthly_credits`.
- Separately, **expire top-up credits** older than 12 months: reduce `topup_credits_balance`, write `type='expire', bucket='topup'`.

---

## 3. Top-ups (credit refills)

Any **paid** tier (Starter+) can buy top-up packs anytime. Free tier cannot (forces upgrade).

### 3.1 Packs
| Pack | Credits | Price | ~ per credit |
|---|---|---|---|
| Small | 250 | $19 | $0.076 |
| Medium | 750 | $49 | $0.065 |
| Large | 2,000 | $119 | $0.060 |

**Design rule:** top-up per-credit price is set *above* the effective in-plan credit value, so upgrading a
tier is always the better deal → top-ups are the overflow valve, upgrades are the destination.

### 3.2 Behavior
- Purchased credits land in `topup_credits_balance`, **roll over**, expire 12 months after purchase (track per-purchase for FIFO expiry).
- One-time Stripe charge (not a subscription line).
- **Auto-refill (opt-in):** "When my balance drops below X, auto-buy pack Y." Store the rule; trigger on spend.
- **Low-credit nudge:** when total balance ≤ 10% of the plan's monthly allotment, surface **both** "Top up" and "Upgrade" CTAs (upgrade shown as the better value).

---

## 4. Feature-gating / entitlements

### 4.1 Entitlements config (single source of truth)
Define plans as a config map the whole app reads from. Example shape:

```ts
export const PLANS = {
  free:       { brandSpy: 1,   monthlyCredits: 20,   seats: 1,  aiInsights: false, launch: false, campaigns: false, api: false, discoveryPages: 3,   canBuyCredits: false, canClone: false },
  starter:    { brandSpy: 15,  monthlyCredits: 150,  seats: 1,  aiInsights: false, launch: false, campaigns: false, api: false, discoveryPages: null, canBuyCredits: true,  canClone: false },
  pro:        { brandSpy: 50,  monthlyCredits: 500,  seats: 3,  aiInsights: true,  launch: true,  campaigns: false, api: true,  discoveryPages: null, canBuyCredits: true,  canClone: true  },
  business:   { brandSpy: 150, monthlyCredits: 2000, seats: 10, aiInsights: true,  launch: true,  campaigns: true,  api: true,  discoveryPages: null, canBuyCredits: true,  canClone: true  },
  enterprise: { brandSpy: Infinity, monthlyCredits: null /*custom*/, seats: 15, aiInsights: true, launch: true, campaigns: true, api: true, discoveryPages: null, canBuyCredits: true, canClone: true },
} as const
```

### 4.2 Enforcement points (server-side, never trust the client)
| Guarded action | Check |
|---|---|
| Add a brand to Brand Spy | `count(active spied brands) < plan.brandSpy` else 402/upsell |
| Open Patterns / AI Insights | `plan.aiInsights === true` |
| Launch Ads / create campaign | `plan.launch` / `plan.campaigns` |
| Any credit action (script, clone, Mello, transcribe) | balance ≥ cost (reserve/commit/refund); `plan.canClone` for Image/Video Clone |
| Invite a teammate | `count(members) < plan.seats` |
| API / MCP request | `plan.api === true` (check on the API key's org) |
| Buy top-up | `plan.canBuyCredits === true` |
| Discovery search (Free) | cap results to `plan.discoveryPages` |

Each failed check returns a **structured upsell response** (`{ error: 'plan_limit', limit: 'brandSpy', current, max, upgradeTo }`) so the UI can show the right "Upgrade to Pro" modal.

---

## 5. Billing

- **Provider:** Stripe (Subscriptions for plans; one-time Charges/Payment Intents for top-ups).
- **Cycles:** monthly and annual. **Annual = 25% off** the monthly rate (`price_annual = round(price_monthly * 12 * 0.75)`).
- **Free trial:** 7 days on any paid tier, **no card required** to start (or card-on-file, decide) — during trial, full tier access + that tier's monthly credits (or a fixed trial credit grant of e.g. 100). On trial end without conversion → downgrade to Free.
- **Upgrade:** immediate; **prorate** the difference; **top up plan credits to the new tier's allotment immediately** (grant the delta).
- **Downgrade:** takes effect **at period end** (keep current entitlements until then). At the switch, plan credits reset to the lower allotment; excess brand-spy/seats become read-only until pruned to the new limit.
- **Dunning:** on failed renewal → retry per Stripe Smart Retries; after final failure → suspend to Free (data retained, features locked).
- **Seat add-on (optional later):** extra seats beyond plan at a per-seat monthly price (e.g. +$15/seat), mirroring Atria's +$20/seat.

---

## 6. Database schema

```sql
-- Subscription per account (org or user)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                 -- org_id or user_id
  plan text not null default 'free',      -- free|starter|pro|business|enterprise
  billing_cycle text default 'monthly',   -- monthly|annual
  status text default 'active',           -- active|trialing|past_due|suspended|canceled
  seats_used int default 1,
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,         -- drives monthly credit reset
  stripe_customer_id text,
  stripe_subscription_id text,
  scheduled_plan text,                    -- pending downgrade target (applied at period end)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Two-bucket credit wallet
create table credit_wallets (
  owner_id uuid primary key,
  plan_credits_balance int not null default 0,
  topup_credits_balance int not null default 0,
  plan_credits_reset_at timestamptz,      -- = current_period_end
  updated_at timestamptz default now()
);

-- Every credit movement (audit + reserve/commit/refund)
create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  delta int not null,                     -- +grant / -spend / +refund / -expire
  bucket text not null,                   -- plan|topup
  type text not null,                     -- plan_grant|spend|reserve|commit|refund|topup|expire
  action text,                            -- script|image_clone|transcribe|mello|analyze|...
  ref_id text,                            -- the generation/job id
  balance_after int,
  created_at timestamptz default now()
);
create index on credit_ledger (owner_id, created_at desc);

-- Top-up purchases (FIFO expiry)
create table topup_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credits int not null,
  credits_remaining int not null,
  amount_usd numeric not null,
  stripe_payment_id text,
  expires_at timestamptz not null,        -- purchase + 12 months
  created_at timestamptz default now()
);
create index on topup_purchases (owner_id, expires_at) where credits_remaining > 0;
```

(Plans themselves live in the `PLANS` config, not a table — simpler to version in code.)

---

## 7. Edge cases (handle explicitly)

- **Credits run out mid-action:** reserve fails → return the structured upsell (top-up OR upgrade). Never start a paid action without a successful reserve.
- **Downgrade below current brand-spy count:** don't delete brands — mark the over-limit ones **read-only/paused** and prompt the user to pick which to keep active within the new limit.
- **Downgrade below seat count:** block until members are removed to fit, or keep extra members read-only.
- **Trial ends, no card:** downgrade to Free, keep saved data, lock gated features.
- **Refund/chargeback on a top-up:** claw back `topup_credits_balance` (down to 0 floor) and ledger it.
- **Annual plan, mid-term upgrade:** prorate on Stripe; grant credit delta immediately.
- **Concurrent spends:** the reserve step must be atomic (row lock / conditional update on `credit_wallets`) to prevent double-spend.
- **Enterprise custom credits:** `monthlyCredits` null in config → set per-account override on the subscription row.

---

## 8. Build order

```
1. PLANS config map + entitlements helper (getEntitlements(ownerId) → plan limits)
2. DB: subscriptions, credit_wallets, credit_ledger, topup_purchases
3. Credit engine: reserve/commit/refund, plan-first consumption, atomic wallet update
4. Feature-gate middleware: check limit → structured upsell response (used by every guarded route)
5. Wire gates into: Brand Spy (add-brand), Patterns, Launch, Campaigns, Clone, Mello, API, seats
6. Stripe: plan subscriptions (monthly/annual, 25% off), 7-day trial, upgrade proration, downgrade-at-period-end
7. Monthly reset cron/webhook: plan credits → allotment (no rollover); expire top-ups > 12mo
8. Top-ups: Stripe one-time charge → topup bucket (12mo expiry) + auto-refill rule + low-credit nudge
9. Pricing page (Free/Starter/Pro⭐/Business/Enterprise) + in-app upsell modals + credit meter UI (plan vs top-up split)
10. Admin: view/override a customer's plan, credits, seats (for support + Enterprise)
```

---

## 9. Unit economics & monitoring (keep margins safe)

Real per-action API costs (verified July 2026):
| Action | Real cost | Credits | Effective margin |
|---|---|---|---|
| AI script | ~$0.001 (LLM) | 5 | huge |
| Transcribe | ~$0.002 | 2 | huge |
| Image Clone 2K (default) | $0.134 | 15 | plan ~93%, top-up ~5–8× |
| Image Clone 4K | $0.24 | 25 | plan ~89%, top-up ~5× |

**Worst-case plan cost** (every credit spent on the most expensive action = 2K image, 15 cr):
- Pro $99 → 500/15 = 33 images × $0.134 = **$4.42 cost → 96% margin**
- Business $249 → 2,000/15 = 133 images × $0.134 = **$17.82 cost → 93% margin**

**Monitoring to add:** per-account monthly AI-cost gauge (sum of real API $ spent vs plan price). Alert if any
account's fulfillment cost exceeds ~40% of its plan price — that's the early signal of an abuse pattern or a
mispriced action. No account should ever be underwater given the caps above, but monitor to be sure.

---

## Summary of the decisions locked in this spec
- **Tiers:** Free $0 · Starter $39 · Pro $99 (Most Popular) · Business $249 · Enterprise custom. Annual = 25% off.
- **Credit buckets:** plan credits **reset monthly, do NOT roll over**; **top-up credits roll over (12-month expiry)**; spend **plan-first**.
- **Monthly credits:** 20 / 150 / 500 / 2,000 / custom.
- **Top-up packs:** 250/$19 · 750/$49 · 2,000/$119, priced above in-plan value to nudge upgrades.
- **Image Clone:** Nano Banana **Pro**, **default 2K (15 cr / $0.134)**; 1K = 10 cr, 4K/HD = 25 cr (opt-in). Never batch/3rd-party for interactive clones.
- **Upgrade triggers:** AI Insights (Pro+), Launch (Pro+), Campaigns (Business+), brand-spy count, credits, seats, API/MCP.
- **Trial:** 7-day, all paid tiers. **Enforcement:** server-side, structured upsell responses.
- **Margins verified:** 89–96% on plans worst-case, 5–8× on top-ups. No loss scenario.
