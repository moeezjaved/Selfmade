# Scan → Meta Connect → Mello Leak Paywall — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monetize the `/scan` funnel using the systems that already exist — route a signed-up scan visitor to a leak-led Meta paywall (Creator $49), and once they subscribe + connect Meta, the existing M4 audit + Mello approvals already show the leak and let them fix it. **No new billing in Phase 1.**

**Architecture:** Almost everything is reuse. `runMetaAudit` already computes the leak and writes fix-actions to `mello_tasks`; `/brief`'s `<MelloTasks>` already shows + executes them; Creator ($49, `starter`, `launch:true`) already gates `/connect/meta`. Phase 1 adds only: (a) a Meta-specific, leak-led upsell on `/billing` (the param is ignored today), (b) tighter scan→signup→connect routing + resume from the stashed `sf_scan` brand. The emailed approvals digest and the $1→trial→$49 are separated into Phases 2 and 3.

**Tech Stack:** Next.js App Router, Supabase, PayPal (existing card/vault subscription), TypeScript. No unit-test framework in-repo — verification is `tsc --noEmit`, prod `curl`, and the Browser pane (matches the repo's convention).

**Spec:** `docs/superpowers/specs/2026-08-22-scan-meta-connect-paywall-design.md`

## Global Constraints

- **Additive-only to sensitive production flows.** Do NOT modify auth (`auth/callback`), the M4 audit (`src/lib/meta/audit.ts`), `mello_tasks` execution (`run-task.ts`), the PayPal charge path (`billing/paypal/card/*`, `grant.ts`), or `plans.ts`. Reuse them; never restructure.
- **NO new billing in Phase 1.** The paywall IS the existing Creator ($49) subscription, which already gates `launch`. The $1→trial is Phase 3.
- **The business-email gate is OFF** (`REQUIRE_BUSINESS_EMAIL=false`) — Gmail signs up fine; do not change it.
- **Creator = plan id `starter`** ($49, `launch:true`). Free = no `launch`. `firstPlanWith('launch')` → `starter`. (Verbatim from `src/lib/plans.ts`.)
- **Verify on production** (keys live there; local dev has no `.env`). Keep changes `/scan`- and billing-page-scoped.
- No real payment executed by the agent; the customer completes checkout.

---

### Task 1: Leak-led Meta upsell on `/billing?feature=meta`

Today `src/app/(dashboard)/billing/page.tsx` ignores the `feature` param — a Free user redirected from `/connect/meta` sees the generic billing page. Add a Meta-specific, leak-led banner above the pricing so the paywall sells the outcome ("connect Meta to see exactly where your money is leaking").

**Files:**
- Create: `src/components/billing/MetaUpsellBanner.tsx`
- Modify: `src/app/(dashboard)/billing/page.tsx` (read `feature` param, render the banner when `feature==='meta'`)

**Interfaces:**
- Produces: `<MetaUpsellBanner />` — a self-contained client/server-safe banner (no props needed; static copy). Renders above `<PricingSection variant="dashboard" />`.

- [ ] **Step 1: Build the banner component**

Create `src/components/billing/MetaUpsellBanner.tsx` — a presentational banner matching the app's style (reuse the billing page's existing tokens/classes; inspect `billing/page.tsx` for the palette). Copy, leak-led:
- Eyebrow: "Your audit, completed"
- Headline: "Connect Meta to see exactly where your money is leaking"
- Body: "Your free scan estimated the opportunity from the outside. Creator connects your real account — Mello finds the ads bleeding budget, the winners to scale, and fixes each one with your approval."
- A 3-item value row: "See real wasted spend" · "One-click pause & scale" · "Mello watches it daily"
- No CTA of its own (the `<PricingSection>` below carries the Subscribe button).

- [ ] **Step 2: Render it on `/billing` when `feature=meta`**

In `src/app/(dashboard)/billing/page.tsx`, read the `feature` search param (the page already reads `searchParams.get('expired')` — add `const feature = searchParams.get('feature')` the same way; confirm whether the page is server or client and match its existing param-reading pattern). When `feature === 'meta'`, render `<MetaUpsellBanner />` immediately above the existing `<PricingSection>`. Change nothing else on the page.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` — expect 0 errors.

- [ ] **Step 4: Prod verification (after deploy)**

Browser pane: visit `https://www.tryselfmade.ai/billing?feature=meta` while logged in — confirm the leak-led banner shows above pricing, and `/billing` (no param) is unchanged. Screenshot both.

- [ ] **Step 5: Commit**

```bash
git add src/components/billing/MetaUpsellBanner.tsx "src/app/(dashboard)/billing/page.tsx"
git commit -m "feat(billing): leak-led Meta upsell on /billing?feature=meta (was ignored)"
```

---

### Task 2: Route scan signups toward Meta connect + resume the brand

A scan visitor clicks "Start free" → `/signup?ref=scan&brand=<pageId>` (already built) and we stash `sf_scan` in localStorage. After they finish signup/onboarding, nudge them to the Meta connect (which paywalls them into Creator). Keep it additive — do NOT change `auth/callback` routing.

**Files:**
- Modify: `src/app/(dashboard)/connect/meta/page.tsx` (read `sf_scan` / `?ref=scan` to show a scan-aware headline; no logic change to the gate)
- Reference (read only): `src/app/(dashboard)/brief/BriefScan.tsx` (already links to `/connect/meta`)

**Interfaces:**
- Consumes: `localStorage.sf_scan = { pageId, name, at }` (written by `ScanTheater`'s `ForwardCta`).

- [ ] **Step 1: Scan-aware copy on the connect page**

In `src/app/(dashboard)/connect/meta/page.tsx`, on mount read `localStorage.getItem('sf_scan')` (guard JSON.parse). If present (and recent, e.g. `< 7 days`), show a scan-aware intro line above the existing connect UI: "Finish your audit for {name} — connect Meta to see your real numbers." Do NOT change the entitlement gate or the connect fetches. This is presentational only.

- [ ] **Step 2: Confirm the paywall redirect already carries the user here**

Verify (read-only) that `connect/meta/page.tsx` already redirects Free users to `/billing?feature=meta` (it does, per investigation). No change — this step just confirms Task 1's banner is what they'll see.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add "src/app/(dashboard)/connect/meta/page.tsx"
git commit -m "feat(scan): scan-aware copy on Meta connect (resume from stashed audit)"
```

---

### Task 3: Verify the post-subscribe leak + actions surface (integration check, no code)

Once a scan user is Creator + connects Meta, the leak report and one-click fixes must already appear on `/brief`. This task is a verification gate — confirm the existing chain works end-to-end for a freshly-connected account; only file a follow-up if a gap is found (do NOT modify the audit/Mello internals).

**Files:** none (verification only).

- [ ] **Step 1: Confirm connect triggers the audit**

Read `src/app/api/meta/connect-byo/route.ts` — confirm it calls `runMetaAudit(admin, user.id, { syncFirst: true })` inline on save (it does). So `mello_tasks` populate immediately on connect.

- [ ] **Step 2: Confirm `/brief` shows the actions**

Read `src/app/(dashboard)/brief/MelloTasks.tsx` + `GET /api/mello/tasks` — confirm `meta_pause`/`meta_scale` tasks render as approvable cards and `POST /api/mello/tasks/run` executes them via `runTask`. (Per investigation, yes.)

- [ ] **Step 3: Confirm the leak $ is available for framing**

Read `src/lib/meta/opportunities.ts` — confirm the `Pause` card's `impact` ("saves ~$X/mo", `(spend/days)*30*(1-roas)`) is present, so a future "€X/mo leaking" headline can sum these. Note the exact field for Phase 2.

- [ ] **Step 4: Write the findings**

Append a short "Phase 1 integration verified" note to the spec (or this plan) listing: does connect→audit→brief work unbroken? Is the leak $ summable? Any gap → a Phase-1.5 follow-up task; otherwise proceed. No commit if nothing changed.

---

### Task 4: Surface Mello approvals on Reports too (not just /brief)

The leak actions currently live only on `/brief` via `<MelloTasks>`. Render the same approvals on the Reports page so users see + act on them there too. Additive reuse of the existing component.

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx`
- Reference (read only): `src/app/(dashboard)/brief/MelloTasks.tsx` (the component), `src/app/(dashboard)/brief/BriefScan.tsx` (how it passes `brandId`)

**Interfaces:**
- Consumes: `<MelloTasks brandId={activeBrandId} />` — the existing component (self-contained, fetches `/api/mello/tasks`, renders approvable cards).

- [ ] **Step 1: Read how MelloTasks gets its brandId**

Read `BriefScan.tsx` around its `<MelloTasks brandId={...} />` usage to learn how the active brand id is resolved on a dashboard page. Read `reports/page.tsx` to see if it already has the active brand id in scope (it likely resolves a brand for the reports it shows).

- [ ] **Step 2: Render `<MelloTasks>` on Reports**

In `src/app/(dashboard)/reports/page.tsx`, add `<MelloTasks brandId={<activeBrandId in scope>} />` near the top of the reports content (above the report list), matching how BriefScan mounts it. If `reports/page.tsx` is a server component and `MelloTasks` is a client component, importing + rendering it is fine (client islands in server pages are supported). If the active brand id isn't already resolved there, resolve it the same way BriefScan/other dashboard pages do — do not invent a new resolution path.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` — expect 0 errors.

- [ ] **Step 4: Prod verification**

Browser pane: visit `/reports` logged in as a Creator with a connected Meta account — confirm the approval cards render and a "Start"/approve click still works (same as /brief). Confirm `/brief` is unchanged.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/reports/page.tsx"
git commit -m "feat(reports): surface Mello approvals on Reports too (reuse MelloTasks)"
```

---

## Self-Review

**Spec coverage (Phase 1):** connect Meta = real (reuse connect-byo) ✓ (Tasks 2–3); leak-led framing → the paywall banner (Task 1) + verified leak data (Task 3) ✓; paywall = existing Creator $49 ✓ (no new billing, per constraints); Mello ongoing loop ✓ (already exists, verified Task 3). Onboarding resume → partial (connect-page copy, Task 2; full onboarding pre-fill deferred — see roadmap). The **emailed** approvals digest and **$1 trial** are explicitly Phases 2–3.

**Placeholder scan:** none — each task names exact files + the reuse targets are real (verified by investigation).

**Type consistency:** `<MetaUpsellBanner />` (Task 1) is prop-less; `sf_scan` shape matches what `ForwardCta` writes (`{pageId,name,at}`).

**Production-safety:** Tasks touch only the billing page (additive param branch) + the connect page (presentational copy) + a new banner component. Zero changes to audit/Mello/PayPal/auth/plans.

---

## Roadmap — later phases (separate plans)

- **Phase 2 — "N actions waiting for your approval" email.** New cron (or fold into `/api/cron/meta-audit`) that counts `mello_tasks WHERE status='suggested'` per user, sums the leak $ (`opportunities` impact), and sends via the existing `sendEmail()` (`src/lib/email.ts`) with a "Review approvals →" button linking to `/brief`. Today this digest is Slack/WhatsApp-only (`sendApprovalToChannels`/`pushNewApprovals`); this adds the email channel the screenshot shows. Additive.
- **Phase 3 — $1 setup → 3-day trial → $49 (net-new billing, HIGH RISK, real money).** No trial exists on the live PayPal card path; `createPlan` mints no trial tenure/setup fee, and the card path charges $49 immediately. Options: (a) native PayPal billing plan with a TRIAL cycle + `$1 setup_fee` (switches rails from the card path), or (b) $1 capture + vault now, defer the first $49 by 3 days via the renewals cron. Must inspect the renewals cron before changing charge timing. Its own spec + plan + careful QA; do NOT bundle with Phase 1.
- **Onboarding full resume** — pre-fill onboarding's website field from `brand_directory.website` for the `sf_scan` brand (onboarding is website-driven; the scan gives a page_id + name). Additive to onboarding, but onboarding is sensitive — its own small task.
