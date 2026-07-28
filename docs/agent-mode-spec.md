# Agent Mode — "Mello, the AI Media Buyer" (build spec)

Turns Self Made from **spy → clone → launch → track** into **…→ an agent that audits, fixes, and runs the ads
for you.** This is the "Mello that acts" item from the trajectory doc, pulled forward — and it **unblocks the
Analytics & Launch column without waiting for Meta app review.**

---

## 0. The core unlock — no Meta app approval required
Meta app review only governs *your app acting on strangers' accounts via OAuth*. It does **not** govern a user
connecting **their own** ad account with **their own** token. So we ship **"Bring Your Own Connection" (BYO
system-user token)** now:
- User creates a **System User token** in *their own* Business Manager (we guide them, ~5 min), pastes it in.
- We validate scopes, encrypt, store in the existing `meta_accounts` table (already holds crawler tokens).
- **Every META_LIVE-gated surface lights up for connected users** — Launch, Campaigns, Scale & Insights,
  Reports, Leaderboard, Snapshots. The "SOON" badges disappear for them.
- When Meta approves our app later, one-click OAuth becomes the *easy* path for non-technical users; BYO stays
  as the power-user path. **Nothing is wasted.**

**The Meta Marketing API itself is free** (read + manage), with or without approval. The only real cost is AI
inference — see §7.

---

## 1. What Mello does (6 capabilities)
1. **Audit** — read the connected account, grade it 0–100, list ranked problems (wasted spend, ad fatigue,
   bad budgets, broken tracking, losers still running, missing tests) with dated evidence + confidence.
2. **Report** — generate performance reports (ROAS, spend, winners/losers, trends) in the user's own format
   (white-label; see §6). Client-ready.
3. **Recommend** — what to scale, pause, shift budget to, and which new angle to test — **grounded in the 5M-ad
   corpus** ("your competitor runs this hook, you don't").
4. **Create** — generate the actual replacement creatives via existing Clone/Studio, in the **right size/format
   for the target platform** (see §5).
5. **Execute (confirm-gated)** — make the approved changes in the account: pause a loser, shift budget,
   duplicate a winner, launch a test. **Every write action requires explicit user confirmation.** Never silent auto-spend.
6. **Monitor** — ongoing watch on pacing, delivery, fatigue, policy, performance → alerts via the existing
   digest/notification spine.

Positioning: an **AI media buyer that does the analysis + creative work and executes what you approve** — not a
set-and-forget robot that spends unsupervised.

---

## 2. Reuse what already exists (don't rebuild)
| Need | Already have |
|---|---|
| Token storage | `meta_accounts` table |
| Per-member ad-account scoping | migration 081 `org_member_ad_accounts` + `src/lib/meta/scope.ts` |
| The corpus + ad DNA | `discovery_ads_index` / `discovery_creatives` + classifier (hook/angle/emotion/format tags) |
| Creative generation | Clone (`/api/discovery/clone-image`, `clone-video`) + Studio (`/api/discovery/generate-ad`) |
| The agent | Mello (tools + automations) |
| Credit metering | credits engine (`reserve/commit/refund`, `ACTION_COSTS` in `src/lib/plans.ts`) |
| Reports surface | `/reports`, insights (Motion-style, roadmapped) |
| Retention/alerts spine | brand alerts + weekly digest (built) |
| External access | MCP server (migration 079, subscriber-gated via `api` entitlement) |
| Gating flag | `META_LIVE` in `src/lib/flags.ts` |

**The new work is mostly connecting these + a connect wizard + audit engine + confirm-to-execute actions.**

---

## 3. New components to build
1. **Connect wizard** (`/settings` → "Connect ad account"): guided BYO system-user token flow with screenshots,
   scope validation (`ads_read`, then `ads_management` only when "let Mello act" is enabled), encrypt at rest,
   store in `meta_accounts`. Handle revocation (Meta error 190 → prompt reconnect).
2. **Account read layer** — typed wrappers over the Meta Marketing API for: account summary, campaigns/ad
   sets/ads, insights (spend, ROAS, CTR, CPA, frequency), delivery/pacing. Respect `scope.ts` per-member scoping.
3. **Audit engine** — a deterministic checklist (à la claude-ads' 250+ checks, start with ~30 high-value Meta
   checks) → weighted 0–100 score + ranked findings with evidence. Checks are **code + data**, not LLM-guessed,
   so scores are reproducible; the LLM writes the narrative around them.
4. **Mello action tools** (write, capability-gated): pause/enable ad or ad set, adjust budget, duplicate ad,
   launch campaign. Each returns a **preview → user confirms → execute → log to Activity Log**. Daily change caps.
5. **Platform-spec + winning-format reference** (see §5) — source-of-truth config, not LLM memory.
6. **White-label report generator** (see §6).
7. **Weekly auto-report + alerts** — reuse the digest spine.

---

## 4. Multi-platform (build order — do NOT do all 12 at once)
Same wizard + tools + reports per platform; only the connector differs.
1. **Meta (FB/IG)** — BYO system-user token, **no app review needed**. Ship first.
2. **TikTok Ads** — TikTok Marketing API, BYO token via their developer portal (has its own lighter gate).
3. **Google / YouTube Ads** — Google Ads API; needs a Google **developer token** (basic access is quick).
Ship Meta end-to-end and prove value before adding TikTok, then Google. Everything else (LinkedIn, etc.) is later.

---

## 5. Platform-aware sizing & format (a real feature, mostly connecting existing pieces)
Two layers:
- **Layer 1 — canonical specs (source-of-truth config, NOT LLM memory):** placement → aspect ratio map.
  Meta Feed 1:1/4:5 · Stories/Reels 9:16 · TikTok 9:16 · YouTube in-stream 16:9 · Shorts 9:16 · Pinterest 2:3.
  When the user targets a platform/placement, Clone/Studio renders the **correct size automatically** (Clone
  already outputs 4:5/1:1/9:16 — just map placement→aspect).
- **Layer 2 — data-driven "what wins here" (our edge):** query the corpus + classifier for the winning
  **format** in the user's niche on that platform (e.g., "skincare on TikTok = 9:16 UGC unboxing, problem-first
  hook"). Recommend format from real winning ads, not generic best-practice.
Keep exact dimensions in the config table so the model never hallucinates a pixel count.

---

## 6. White-label reports
Reports are AI-generated from account data → let the user (esp. Agency tier) define their **own template**
(sections, metrics, branding). Feed one of their existing reports as the template; Mello matches the structure
+ voice and fills it from live data. Huge for agencies ("client-ready reports in *your* style, auto-generated").
Ties into the roadmapped Motion-style reports.

---

## 7. Cost model (important — bake in, don't hand-wave)
- **Customers pay us (subscription + credits). We pay the AI provider out of that, metered per action.** Same
  model as image clone.
- **New credit-metered actions** to add to `ACTION_COSTS` (price ABOVE token cost for margin; monitor per the
  pricing-spec margin gauge):
  - **Audit** — higher token use (reads lots of data + reasons) → price generously (e.g. ~30–50 credits).
  - **Report** — ~30 credits (bundle a generous number into Agency tier — agencies run these constantly).
  - **Campaign action / recommendation batch** — priced per action.
- **Meta/TikTok/Google APIs are free** — no marketplace cost, with or without app approval.
- **Optional power-user path:** the MCP server (mig 079) — technical users connect Self Made to their *own*
  Claude/Cursor and run it on *their own* AI, offloading inference. Niche, not default.
- **App approval does NOT reduce cost** — it only changes the connect UX (OAuth vs BYO token). AI inference is a
  permanent cost of goods, always recovered via credits.

---

## 8. Security & safety (non-negotiable)
- Tokens **encrypted at rest**; never in client bundles, logs, or any output (standing rule: never expose `access_token`).
- **Least scope** — `ads_read` by default; `ads_management` only when the user explicitly enables "Mello can act."
- **Every write action: preview → explicit confirm → execute → Activity Log entry.** No silent spend. Daily change caps.
- Per-member ad-account scoping enforced (migration 081 / `scope.ts`).
- Graceful revocation handling (error 190 → reconnect prompt).

---

## 9. Build order (ship incrementally — each step is demoable)
1. **Connect wizard** (BYO Meta token, validate + encrypt) → un-gate META_LIVE surfaces for connected users.
2. **Account read layer + Audit engine** → Mello answers *"check my ads"* with a scored audit + ranked fixes. (This alone is the "aha.")
3. **Recommendations grounded in the corpus** + **Create** (wire Clone/Studio to fix findings, correct size per platform §5).
4. **Weekly auto-report** (digest spine) + **white-label template** (§6).
5. **Confirm-to-execute action tools** (pause/budget/duplicate/launch) behind confirmation + logging.
6. **Add credit costs** for audit/report/action (§7).
7. **MCP ads tools** on the existing server.
8. **TikTok**, then **Google/YouTube** connectors (§4).

---

## 10. Acceptance / the demo that sells it
> User connects their Meta account, types *"check my ads."* Mello: *"Score 62/100. (1) 'Retargeting' ad set
> burning $30/day at 0.8 ROAS. (2) Top ad fatiguing — CTR down 40% over 45 days. (3) No UGC, but your top
> competitor's best ad is UGC. Fix these?"* → pauses the loser (confirm) · clones 3 fresh versions of the
> fatiguing winner from the corpus in 9:16 for Reels · drafts a UGC ad matching the competitor angle · launches
> as a test (confirm budget) · emails a weekly report.

If a non-technical seller can do that in one flow, in their own account, we've shipped the thing Atria/GetHookd
can't do at our price. Ship steps 1–2 first — that's most of the wow.
