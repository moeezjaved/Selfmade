# The Company Brain — Selfmade's integration architecture

*Founder decision record · 2026-07-28 · status: RECOMMENDED, awaiting Moeez's sign-off*

## The decision in one sentence

**Option C, with a hard rule: own the brain and the bloodstream, standardize the hands.**
Mello (the orchestration layer the brief calls "M4") is the only intelligence. Every external system — Meta first, then Shopify, GA4, TikTok, Klaviyo — connects through a **Skill**: a self-describing, capability-gated tool package that we own, that syncs *into one shared memory* (the **Company Brain**), and that Mello alone decides when to use. Claude-style skills are the *interface pattern* we adopt; they are never the runtime we depend on. MCP stays what it is today: a **port** for external AI clients, not a foundation.

---

## 1 · Why not A or B

### Option A — build everything directly into M4/Mello
The six-month view loves it: fastest path, no new abstractions. The five-year view kills it. Every integration hard-wired into the brain makes the brain heavier, and by integration #6 (Meta + Shopify + GA4 + TikTok + Klaviyo + email) the orchestrator is a monolith where touching Klaviyo risks Meta. Worse: hard-wired integrations don't *compound* — each one is bespoke plumbing to a bespoke feature. The brief's own test fails: adding a connection increases product complexity instead of Mello's intelligence.

### Option B — Claude skills as the execution engine
The trap dressed as a shortcut. If third-party skills/MCP servers (Adspirer's Meta MCP, community Google MCPs) are the execution engine, then: user **tokens flow through code we don't control** (instant security disqualification — these are people's ad accounts and money), uptime and rate-limit behavior are someone's side project, and the "engine" of an AI Marketing Co-founder is a dependency we can't fix at 3 AM. claude-ads itself is honest about this — it's playbooks, and it points at external servers for live data. Note also: **claude-ads is MIT-licensed** — its *methodology* (250+ audit checks, scoring rubrics, 2026 benchmarks) is free to absorb as content inside our own skills. Take the knowledge, never the runtime.

### Option C — the operating system model
Mello is the OS. Skills are the applications. The Company Brain is the filesystem. What makes this the compounding choice is not the layering itself but the **data rule** that comes with it (next section).

**What the companies in the brief chose:** Shopify = an owned core with a standardized app interface — apps make the platform smarter, never touch the core. Stripe = owns the rails (identity, money, data) absolutely, standardizes the extension surface. Airbnb = one experience, complexity inside. All three are Option C with owned primitives. None outsourced their engine.

---

## 2 · The architecture

```
                        ┌──────────────────────────────────────────┐
                        │              FOUNDER (UI)                │
                        │  "Why is my ROAS dropping?"  · approvals │
                        └────────────────────┬─────────────────────┘
                                             │  one interface: Mello
                        ┌────────────────────▼─────────────────────┐
                        │             MELLO  (the brain)           │
                        │  orchestration · planning · judgment      │
                        │  nightly work loop (mello_tasks)          │
                        │  M4 method = one skill it applies         │
                        └───────┬──────────────────────┬───────────┘
                    reasons FROM│                      │acts THROUGH
                        ┌───────▼───────┐      ┌───────▼───────────┐
                        │ COMPANY BRAIN │◄─────│   SKILL REGISTRY  │
                        │  (the moat)   │ sync │  self-describing, │
                        │ one schema:   │      │  capability-gated │
                        │ entities ·    │      │  tool packages    │
                        │ metrics ·     │      ├───────────────────┤
                        │ creatives ·   │      │ meta-ads    (now) │
                        │ events ·      │      │ shopify   (next)  │
                        │ insights      │      │ ga4 · tiktok ·    │
                        └───────┬───────┘      │ klaviyo · email…  │
                                │              └───────┬───────────┘
                        ┌───────▼───────┐      ┌───────▼───────────┐
                        │  MCP SERVER   │      │   CONNECTIONS      │
                        │ (the port —   │      │ vault: encrypted   │
                        │ external AI   │      │ tokens, scopes,    │
                        │ clients read) │      │ health, rate limits│
                        └───────────────┘      └───────────────────┘
```

**The data rule (this is the whole ballgame):** a skill's job is not "answer a question when called." A skill's job is **to keep its slice of the Company Brain fresh** — and *then* also expose live actions. Mello reasons from the Brain, not from twelve APIs. That's what makes "Why is my ROAS dropping?" a single-memory question instead of a twelve-API scatter-gather, and it's why every new integration makes Mello smarter instead of the product bigger. The user never "connects Meta" — they *teach Mello about their business*, and the Brain is where the teaching lives.

---

## 3 · Data flow

1. **Connect** (once): founder completes the connect flow → token encrypted into the vault → skill runs its **first sync** → Mello narrates what it learned ("I can see 2 ad accounts, 47 campaigns, $12.4k spend this month — I'll study them tonight").
2. **Sync** (continuous): each skill has a sync contract — pull deltas on its own cadence (Meta insights: hourly-to-daily; Shopify orders: webhooks + backfill), normalize into the Brain's shared schema, emit `events` for things that changed ("CPA on campaign X doubled").
3. **Reason** (nightly + on demand): the existing nightly loop (brief_events → Morning Brief) now reads a Brain that spans sources. Cross-source insights are just queries: ad spend (Meta) ÷ revenue (Shopify) with page-conversion context (GA4) against competitor pressure (our own library).
4. **Act** (with approval): Mello proposes → founder approves (the same approval-gate pattern the video engine uses) → the skill executes the mutation (pause campaign, shift budget, launch creative) → result is written back to the Brain as an event → Mello learns from the outcome. Capability-gating: read tools are free; **mutating tools require an approval token minted by the UI**, never invocable by the model alone.

## 4 · Authentication model

- **Today (pre-app-review): BYO system-user token.** Meta Business users can mint a System User token in Business Settings scoped to their own assets (`ads_read`, `ads_management`, `read_insights`). No app review needed — it's their business, their token. The connect flow is a guided 3-step wizard (below).
- **Tomorrow (post-approval): OAuth becomes the default door**, BYO stays as the power-user/agency door. Same vault row either way — the skill never knows which door the token came through.
- **Per-source doors vary** (Shopify = OAuth app or custom-app token; GA4 = Google OAuth; Klaviyo = API key) — the vault normalizes them all into `connections(source, scopes, credential, health)`.

## 5 · Security model

- Tokens **AES-encrypted at rest** (extend the existing `encryptToken` in lib/meta/client), key in env, never in the DB, never logged, never sent to the browser after entry, never through third-party servers. RLS on `connections` like billing tables (mig 090 lesson).
- **Scope minimization**: request/accept the narrowest scopes; store granted scopes; skills declare required scopes and are refused tokens that exceed need.
- **Mutation gating**: every write-capable tool call carries a UI-minted, single-use approval id; logged to activity_logs with actor, tool, args-hash, result.
- **Blast-radius rule**: a skill can only touch its own source + the Brain schema. Skills cannot call other skills; only Mello composes.
- Per-member ad-account scoping already exists (mig 081 / lib/meta/scope.ts) — connections inherit it.

## 6 · Token management

`connections` table: `id, user_id, brand_id, source, credential_enc, scopes[], status(active|expired|revoked|error), last_ok_at, last_error, expires_at, meta jsonb`. A **connection-health loop** (extend the alert-worker): ping each connection daily; on failure → mark, tell the founder in the Morning Brief ("Meta lost access — reconnect in 1 minute"), pause that skill's syncs, never let a dead token silently rot the Brain. Refresh where the platform supports it; System User tokens are long-lived by design.

## 7 · Agent orchestration (Mello's responsibilities)

Mello owns: **intent → plan → tool selection → sequencing → synthesis → approval → memory.** Concretely: the mello_tasks loop grows from {research, creative, video} to skill-powered tasks ({audit_meta, rebalance_budget, sync_anomaly}). The M4 grading method stops being a page and becomes **a skill Mello applies** ("I graded your 47 campaigns M4-style: 3 graduate, 5 catchy-not-converting, 2 pause candidates — approve?"). claude-ads' MIT audit checklists get absorbed here as reference content for the audit skill — 250+ checks Mello can run against Brain data.

## 8 · Skill responsibilities (the contract)

Every skill ships four things:
1. **Manifest** — name, source, required scopes, tools (name, schema, read|write, cost-class), sync cadence.
2. **Sync** — pull → normalize → upsert into Brain schema → emit events. Idempotent, checkpointed (the video-worker checkpoint pattern, generalized).
3. **Tools** — typed functions Mello can call; reads hit the Brain first, live API only when freshness demands; writes require approval tokens.
4. **Narration** — human strings for what it's doing ("Reading 47 campaigns…"), because thinking-out-loud is the product's voice (Working.tsx pattern).

Skills are **internal packages in our repo** (`src/skills/meta-ads/…`), reviewed like any code. The pattern is Claude-skill-shaped so the ecosystem's knowledge ports in trivially — but execution is ours.

## 9 · MCP responsibilities

Unchanged in role, doubled in value: the **port**. Inbound today (external AI clients query our library). Later, outbound-optional: our skills *may* consume a vetted external MCP for a long-tail source we haven't built — allowed only for **read-only, non-credentialed** data, never for tokens or mutations. And one day the Brain itself becomes an MCP surface agencies can query — the moat sold as an API.

## 10 · Five-year evolution

- **Y1 — Meta + Shopify.** The vault, the Brain schema, the meta-ads skill (BYO token), M4-as-skill, audits in the Morning Brief. First cross-source insight: true ROAS (Meta spend ÷ Shopify revenue) — the number founders actually can't get.
- **Y2 — the senses multiply.** GA4, TikTok, Google Ads, Klaviyo, landing pages. Each is "just" a skill + schema mapping; the brief/tasks/approvals surfaces don't change. Mello's answers get denser with zero new UI.
- **Y3 — closed loop.** Outcome memory ("last time we shifted budget to UGC video, CPA fell 18%") makes recommendations self-improving. Autopilot graduates from ads-by-email to budget-guardrails-with-standing-approval.
- **Y4 — the platform.** Skill interface opens to partners (Shopify-style). Third parties extend Mello's hands; the Brain and judgment stay ours.
- **Y5 — the Brain is the business.** The dataset nobody else has: cross-platform performance joined to creative DNA joined to outcomes, per niche. Every product we haven't imagined yet reads from it.

---

## The Meta connect experience (ship first)

Framing: **"Teach Mello your ad account"** — never "connect an integration."

1. **One page, three steps** at `/connect/meta`: ① open Business Settings (deep link) → add System User → generate token (we show a 30-second visual guide with screenshots, per-step). ② paste token → we validate live, list the ad accounts it can see, founder picks. ③ Mello reads back what it learned — real numbers, immediately — and promises the first audit in tomorrow's brief.
2. **Paste-and-validate, never paste-and-pray**: on paste we call `/me/adaccounts` server-side, show green checks (token valid · scopes sufficient · N accounts found) or the exact fix ("this token is missing ads_read — regenerate with…").
3. OAuth slots into step ① as a single button the day the app is approved; nothing else changes.

## Why this wins (the brief's own judges)

- **Chesky**: one teammate, one memory, one conversation. The user never sees a "tool."
- **PG**: the compounding asset is the Brain — every integration deposits into it. Five-year moat, not six-week feature.
- **Jobs**: complexity (vault, sync, skills) lives entirely inside; the founder feels only "Mello understands my business."
- **Collison**: primitives (identity, credentials, memory, approval) built once; every future feature inherits them.
- **Tobi**: the skill contract makes integration-building boring — that's the point. Boring to build, compounding to own.
- **Kay**: the invention isn't a better dashboard — it's marketing as a *conversation with a memory that acts*.
