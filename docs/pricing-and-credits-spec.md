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
| **Saved Ads / Following / Boards** | 1 board, 25 saves | ✅ personal boards | ✅ **team boards** | ✅ team boards | ✅ team boards |
| **Ask Mello** (AI agent) | ✅ *credits* | ✅ *credits* | ✅ | ✅ | ✅ |
| **Scripts / Transcribe** | ✅ *credits* | ✅ | ✅ | ✅ | ✅ |
| **Image Clone** (Nano Banana Pro) | ✅ *credits* | ✅ | ✅ | ✅ | ✅ |
| **Video Clone** | ✅ *credits* | ✅ | ✅ | ✅ | ✅ |
| **Launch Ads** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Campaigns / Scale & Insights / Deep Reports** | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Monthly credits** | **20** | **150** | **500** | **2,000** | Custom |
| **Seats** | 1 | 1 | 3 | **10** | 25 |
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
| **Image Clone — 2K** (Nano Banana Pro, **default**) | **15** |
| **Image Clone — 4K / HD** (Nano Banana Pro) | **25** |
| **Video Clone** (short AI clip) | **40** *(verify vs real video model cost)* |

(Assets generated *via* Mello also charge the asset's own cost, e.g. Mello-triggered 2K Image Clone = 1 + 15.)

> **We only generate on Nano Banana Pro** — the standard 1K model is not offered (its text rendering is too
> weak for ad creatives). So there is no "10-credit / 1K" tier; the minimum image action is **2K = 15 credits**.

> **All creation tools (Mello, Scripts, Transcribe, Image Clone, Video Clone) are available on EVERY tier,
> including Free** — they are gated by **credits, not by feature flag.** This is the product-led-growth hook:
> anyone can experience the AI creation, and the monthly credit cap is the natural throttle → hit the wall → upgrade.

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

### 2.5.1 Free welcome bonus (one-time)
On **signup to the Free plan**, grant `welcomeCredits` (60) into the **top-up bucket** — so it rolls over and
survives the first monthly reset. This lets a new user *test the AI creation* end-to-end — e.g. 1 Image Clone (15)
+ 1 Video Clone (40) = 55 — before the 20/mo Free cap applies. **One-time only**, never re-granted. Ledger:
`type='welcome', bucket='topup'`. (Without this, a Free user's 20/mo can't afford a 40-credit video — the bonus
is what makes "test everything free" real while capping the CAC per signup.)

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
  free:       { brandSpy: 1,   monthlyCredits: 20,   welcomeCredits: 60, seats: 1,  aiInsights: false, launch: false, campaigns: false, api: false, discoveryPages: 3,   canBuyCredits: false, teamBoards: false, assetsGb: 0.5 },
  starter:    { brandSpy: 15,  monthlyCredits: 150,  seats: 1,  aiInsights: false, launch: false, campaigns: false, api: false, discoveryPages: null, canBuyCredits: true,  teamBoards: false, assetsGb: 5 },
  pro:        { brandSpy: 50,  monthlyCredits: 500,  seats: 3,  aiInsights: true,  launch: true,  campaigns: false, api: true,  discoveryPages: null, canBuyCredits: true,  teamBoards: true,  assetsGb: 50 },
  business:   { brandSpy: 150, monthlyCredits: 2000, seats: 10, aiInsights: true,  launch: true,  campaigns: true,  api: true,  discoveryPages: null, canBuyCredits: true,  teamBoards: true,  assetsGb: 250 },
  enterprise: { brandSpy: Infinity, monthlyCredits: null /*custom*/, seats: 25, aiInsights: true, launch: true, campaigns: true, api: true, discoveryPages: null, canBuyCredits: true, teamBoards: true, assetsGb: null /*custom*/ },
} as const
// Creation tools (Mello, Scripts, Transcribe, Image Clone, Video Clone) are available on EVERY tier —
// gated by CREDIT BALANCE, not a feature flag. No canClone/canMello flags. `welcomeCredits` = one-time
// signup grant (Free only) so a new user can test ~1 image + 1 video before the 20/mo cap kicks in.
```

### 4.2 Enforcement points (server-side, never trust the client)
| Guarded action | Check |
|---|---|
| Add a brand to Brand Spy | `count(active spied brands) < plan.brandSpy` else 402/upsell |
| Open Patterns / AI Insights | `plan.aiInsights === true` |
| Launch Ads / create campaign | `plan.launch` / `plan.campaigns` |
| Any credit action (Mello, script, transcribe, image/video clone) | balance ≥ cost (reserve/commit/refund). **Available on ALL tiers** — no feature flag, credit-gated only |
| Invite a teammate | `count(members) < plan.seats` |
| API / MCP request | `plan.api === true` (check on the API key's org) |
| Buy top-up | `plan.canBuyCredits === true` |
| Discovery search (Free) | cap results to `plan.discoveryPages` |

Each failed check returns a **structured upsell response** (`{ error: 'plan_limit', limit: 'brandSpy', current, max, upgradeTo }`) so the UI can show the right "Upgrade to Pro" modal.

### 4.3 Teams & seats (CONFIRMED)

Modeled on Atria's structure, scaled to Self Made's lower price points and small-team ICP.

**Seat counts per plan (hard caps, confirmed):**
| Free | Starter | Pro | Business | Custom/Enterprise |
|---|---|---|---|---|
| 1 | 1 | **3** | **10** | 25 (covers "15+") |

- **Hard caps at launch — no paid per-seat add-on yet.** Hit the limit → upgrade to the next tier (`count(members) < plan.seats`, else 402/upsell). The 3 → 10 → 25 jumps are wide enough to absorb most growth. Add a `$/extra seat` add-on later only if customers ask (Atria charges +$20/seat; we'd do ~$15).

**Data model — ONE shared org workspace (like Atria):**
- Teammates share the org's **boards, saved ads, following, brands, and Creation/Assets** — one collaborative workspace, not private per-user spaces.
- The **only** per-member scoping is **connected Meta ad accounts** (which accounts a member can see in Launch/Analytics/Reports). Everything on the discovery/creation side is shared to the whole team.
- **Credits pool at the ORG level**, never per-seat. One shared plan-credit + top-up balance for the whole team. (Per-seat credit silos frustrate teams and suppress usage; a shared pool drives upgrades as the team grows.)

**Roles (launch with 3; add Guest later):**
| Role | Can do | Notes |
|---|---|---|
| **Owner** | Everything incl. delete org, transfer ownership | Exactly one per org (the creator) |
| **Admin** | Manage billing, seats, invite/remove members, all features | Cannot delete the org |
| **Member** | All product features; cannot manage billing/seats | Default for invitees |
| **Guest** *(later)* | View-only, scoped to specific ad accounts; no Creation/Assets; can't edit reports | **Business+ perk**, ship post-launch (mirrors Atria gating) |

**Enforcement:** seat check on invite; org-scoped credit wallet (one `credit_wallet` row per org, not per user); ad-account visibility join table (`member_id × ad_account_id`) gates Analytics/Launch only.

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
| Image Clone 2K (default) | **~$0.15 (verified in production)** | 15 | plan ~95%, top-up ~7.6× |
| Image Clone 4K | $0.24 | 25 | plan ~89%, top-up ~5× |

**Worst-case plan cost** (every credit spent on the most expensive action = 2K image, 15 cr):
- Pro $99 → 500/15 = 33 images × $0.134 = **$4.42 cost → 96% margin**
- Business $249 → 2,000/15 = 133 images × $0.134 = **$17.82 cost → 93% margin**

**Monitoring to add:** per-account monthly AI-cost gauge (sum of real API $ spent vs plan price). Alert if any
account's fulfillment cost exceeds ~40% of its plan price — that's the early signal of an abuse pattern or a
mispriced action. No account should ever be underwater given the caps above, but monitor to be sure.

---

## 10. Team Boards + Assets (build ticket)

Modeled on Atria's depth. Two related surfaces: **Boards** (collections of *ads* — saved/spied creatives) and
**Assets** (a media library of *your own uploaded files*). Both become **org-shared** at Pro+.

### 10.1 Current state (what exists today)
- ✅ **Personal boards built** — `discovery_boards` table + `/api/discovery/boards` (create/list/delete); `discovery_saved_ads.board_id` links ads to boards. Pinterest-style (name + emoji + description + counts).
- ❌ Everything is **user-scoped** (`.eq('user_id', user.id)`) — boards are private per user. No org sharing, no sub-boards, no tags.
- ❌ **No Assets surface** — users cannot upload their own files (only save library ads).

### 10.2 Team Boards — the build
**Schema changes (`discovery_boards`):**
```sql
ALTER TABLE discovery_boards ADD COLUMN org_id uuid REFERENCES orgs(id);
ALTER TABLE discovery_boards ADD COLUMN visibility text NOT NULL DEFAULT 'personal'
  CHECK (visibility IN ('personal','team'));          -- 'team' = visible to whole org
ALTER TABLE discovery_boards ADD COLUMN parent_board_id uuid REFERENCES discovery_boards(id); -- sub-boards (Atria depth)
ALTER TABLE discovery_boards ADD COLUMN created_by uuid REFERENCES auth.users(id); -- keep author for attribution
-- backfill: org_id = the owner's org; created_by = user_id; visibility='personal'
CREATE INDEX idx_boards_org ON discovery_boards(org_id, visibility);
```
**Tags (Atria depth) — cross-cutting labels on individual saved ads:**
```sql
CREATE TABLE saved_ad_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs(id), saved_ad_id uuid REFERENCES discovery_saved_ads(id) ON DELETE CASCADE,
  tag text NOT NULL, created_by uuid, created_at timestamptz DEFAULT now(),
  UNIQUE(saved_ad_id, tag)
);
```
**Query edits in `/api/discovery/boards/route.ts`:**
- GET: replace `.eq('user_id', user.id)` with **`.or('visibility.eq.team,and(visibility.eq.personal,created_by.eq.'+user.id+')').eq('org_id', orgId)`** — i.e. show all TEAM boards in my org + my own personal boards. Same change to the saved-ads count query (count by `org_id` for team boards, by `created_by` for personal).
- POST: set `org_id`, `created_by`, and accept `visibility` (default 'personal'); creating a **team** board requires `plan.teamBoards === true` → else 402 upsell. Accept optional `parent_board_id` for sub-boards.
- DELETE: allow if `created_by = user` OR requester is Admin/Owner (team boards are org assets).
**Entitlement:** gate team `visibility` + sub-boards on **`plan.teamBoards`** (Pro/Business/Enterprise). Starter/Free = personal boards only.
**UI:** sidebar shows two groups — "Team boards" (shared, with author avatar) and "My boards" (personal). A per-board "Share with team" toggle (Pro+). Sub-boards render nested. Tag chips filter the saved-ad grid.

### 10.3 Assets — manual file upload (new surface, mirrors Atria's "Assets")
Atria's Assets = a **per-brand media library of files the user uploads themselves** (own creatives, b-roll,
logos, footage) with AI search and clip filtering. Build it as:
**Schema:**
```sql
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs(id) NOT NULL,
  brand_id uuid REFERENCES brands(id),            -- optional: scope to a brand (Atria groups per-brand)
  uploaded_by uuid REFERENCES auth.users(id),
  file_url text NOT NULL,                          -- R2 object URL
  file_type text,                                  -- image | video | audio
  file_name text, size_bytes bigint, duration_sec numeric,
  width int, height int,
  tags text[] DEFAULT '{}',
  ai_caption text,                                 -- Gemini/vision auto-caption for semantic search
  embedding vector(1536),                          -- pgvector for visual/semantic search
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_assets_org_brand ON assets(org_id, brand_id);
CREATE INDEX idx_assets_embedding ON assets USING ivfflat (embedding vector_cosine_ops);
```
**Upload flow:**
1. Client requests a **presigned R2 upload URL** (`POST /api/assets/upload-url` → returns signed PUT URL + key). Direct-to-R2 upload (never proxy large files through the app server).
2. On success, `POST /api/assets` records the row; a background job (reuse the Studio auto-tag pipeline) generates `ai_caption` + `embedding` + a poster/thumbnail for video.
3. **Limits:** enforce `plan.assetsGb` storage cap per org (Free 0.5 / Starter 5 / Pro 50 / Business 250 GB) — check `sum(size_bytes)` before issuing the presigned URL, else 402.
**Features (Atria parity):**
- **Per-brand grouping** (filter Assets by brand).
- **Semantic/visual search** — embed the query, cosine-search `embedding` ("find my UGC unboxing clips").
- **Clip filters** — by type (image/video/audio), duration, tags.
- **Org-shared** — all teammates in the org see the org's Assets (same shared-workspace rule as boards).
- Uploaded assets are usable as **inputs to Image/Video Clone** (upload own product shot → clone).
**Enforcement:** Assets is available on all tiers but **storage-capped by `plan.assetsGb`**; the upload-URL endpoint is the single gate.

### 10.4 Build order for this ticket
1. Team Boards schema + query edits + entitlement (ship first — smallest lift, uses existing tables).
2. Tags on saved ads.
3. Sub-boards (parent_board_id + nested UI).
4. Assets: R2 presigned upload + `assets` table + storage cap.
5. Assets AI layer: auto-caption + embeddings + semantic search + clip filters.
6. Wire Assets → Clone as an input source.

---

## Summary of the decisions locked in this spec
- **Tiers:** Free $0 · Starter $39 · Pro $99 (Most Popular) · Business $249 · Enterprise custom. Annual = 25% off.
- **Credit buckets:** plan credits **reset monthly, do NOT roll over**; **top-up credits roll over (12-month expiry)**; spend **plan-first**.
- **Monthly credits:** 20 / 150 / 500 / 2,000 / custom. **Free gets a one-time 60-credit welcome bonus** (rollover) to test creation.
- **Top-up packs:** 250/$19 · 750/$49 · 2,000/$119, priced above in-plan value to nudge upgrades.
- **Creation = credit-gated on ALL tiers (PLG):** Mello, Scripts, Transcribe, Image Clone, Video Clone available everywhere incl. Free — the credit cap is the throttle, not a feature flag.
- **Image Clone:** Nano Banana **Pro only** (no standard-1K), **default 2K (15 cr / $0.134)**, 4K/HD = 25 cr. **Video Clone = 40 cr** (verify vs video model cost). Never batch/3rd-party for interactive clones.
- **Upgrade triggers (the paid unlocks):** brand-spy count · AI Insights (Pro+) · Launch (Pro+) · Campaigns/Scale/Reports (Business+) · seats · API/MCP · bigger credit pool.
- **Trial:** 7-day, all paid tiers. **Enforcement:** server-side, structured upsell responses.
- **Margins verified:** 89–96% on plans worst-case, 5–8× on top-ups. Free CAC per signup capped by the one-time bonus (~1 image + 1 video ≈ $0.60–1.20). No loss scenario.
