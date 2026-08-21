# /scan Audit Theater → Subscription — Design Spec

**Date:** 2026-08-21
**Status:** Design approved in brainstorm; awaiting spec review before implementation planning.
**Surface:** `tryselfmade.ai/scan` (public, no login, noindex, unlinked). Standalone "Audit your ads" funnel — NEVER wired into main onboarding.

## Goal

Turn the free, anonymous Facebook ad audit into a cinematic experience that (a) delivers real value before any ask, and (b) converts the viewer into a paying Selfmade subscriber. The product being sold is **"fix it for me"** — the AI marketing company generates the exact ads the audit says they're missing.

## Conversion spine — a 3-rung value ladder

Each rung answers the question the previous rung raised, so every ask feels earned, never salesy.

1. **Free scan** (public Meta Ad Library, via brand pick or ad-library link).
   Output: their ad DNA + competitor comparison + gaps + the $100k→$1M benchmark + **1–2 fully-rendered image ads** + a **timestamped video script with their product written in**.
2. **Connect Meta** (free, read-only, ~30s), positioned immediately after the scan.
   Output: "awesome reports" that fill in the *invisible half* the free audit explicitly named — real ROAS, wasted spend, true winners/losers. Completion psychology, not a sale. Also a data moat + retention hook.
3. **Subscribe to act.**
   Unlocks **video generation** (the script from rung 1, rendered), ongoing done-for-you creative, and rival monitoring.

**Give vs gate:** Free = 1–2 image ads + full video script. Gated = video generation + the Meta-powered reports' ongoing/action layer.

### Full flow with the sign-up + payment gates (approved 2026-08-21)

Never ask for money until they've felt the product work. Two free wins, then a low-friction sign-up, then payment only to *act*.

| Step | Ask | Cost | Why here |
|---|---|---|---|
| 1. Anonymous scan | nothing | free | Zero-friction full audit — the magic |
| 2. Free image ads + video script | nothing | free | Win #1 — they hold real creative |
| 3. Sign up (1-click Google) | email | free | Low ask *after* value; saves their audit, attributes the user |
| 4. Connect Meta (read-only) | permission | free | Win #2 — real numbers, wasted spend revealed |
| 5. Subscribe / payment | 💳 **$1 now** | trial→paid | Only now — to ACT: generate the scripted video, launch, weekly ads, rival monitoring |

**Payment lands at step 5 only** — when they want us to DO the work (generate the video they already saw scripted; fix the gaps they already saw named). Everything before is proof, not product.

### Checkout model (approved 2026-08-21) — mirrors Ryze `reports.get-ryze.ai/.../checkout`

**$1 setup charge now → 3-day trial → auto-convert to Creator $49/mo. Single tier. Cancel anytime.**
The $1 charge captures the card and filters tire-kickers, so trial→paid converts far higher than a free trial. **This overrides the "no trial" stance in pricing model v2** for the /scan funnel (Creator price $49/mo is retained; Agency $149 is not offered at this checkout — single-tier to keep the decision trivial).

Checkout page copy/structure to adopt from the Ryze reference:
- **"Fix all N gaps on [brand]"** headline + "First videos in minutes. You approve every ad before it launches."
- **"Priced like hiring it out"** value grid — frame the plan against agency cost: e.g. "$X/mo of ad creative", "a media buyer watching your rivals", "$0 risk — $1 for 3 days, cancel anytime". Makes $49 feel tiny.
- **The "rival remade as yours" wow sits AT the gate** — show it watermarked/half-rendered → "Start trial to export & launch."
- Social proof row (founder quotes) below the fold.

Sub-decision for the plan: first video generation is included in the trial so they receive a real deliverable inside the 3 days (crossing the value threshold before the first $49 bill).

## The film — 5-act emotional arc (Tension → Verdict → Payoff)

Lean-back "cinema+": richer auto-reveal (tickers, gauge sweeps, ads flying in, score assembling) — NOT an interactive form. ~90 seconds.

| Act | Beat | What plays | Emotion | Data source |
|---|---|---|---|---|
| 1. "This is you" | Read their ads | Their ads fly in; counters ("1,000 ads read"); hooks/personas assemble into a portrait | Recognition | `ownDna` (discovery_ads_index) |
| 2. "This is them" | Spy on rivals | Competitor winners slide in beside theirs ("435 winners running 90+ days") | Tension / FOMO | `winnerDna` (days_running≥90) |
| 3. "The gap" | Find gaps | Side-by-side lights the missing moves (e.g. "0 formats" glows red vs rivals' full mix) | Sting | `dnaDiff` |
| 4. "The verdict" | $100k→$1M | Benchmark assembles axis-by-axis, lands on score + tier verdict | Clarity / ambition | `benchmark()`, `scoreDna` |
| 5. "The fix" | Payoff | 1–2 image ads render live; video script types itself out, product inside | Relief / desire | ad studio + script generator |

Act 4's existing line — *"the invisible half: we can't see your CAC/LTV/AOV from outside"* — is the deliberate setup for the Meta connect CTA. The film names the hole, then offers to fill it.

## Value drops (aha before every ask)

- **Drop 1 (free, Act 1):** "We read N of your ads — here's your DNA." Most founders have never seen this. Pure gift.
- **Drop 2 (free, Act 5):** 1–2 real image ads + timestamped video script with their product. Downloadable. Worth more than most paid audits.
- **Drop 3 (free, post-scan):** Meta report reveals wasted spend + true winners → subscribe becomes emotional, not rational.

## Where the money asks land

- **Ask 1 — Connect Meta** (free, read-only), right after Act 5. Framing: *"Your audit is ~60% complete. The other 40% is inside your account — connect Meta (read-only, 30s) to see your real numbers."*
- **Ask 2 — Subscribe**, after the Meta report. Framing: *"You've seen the gaps and the fixes. Want us to build and run them? Generate this video, get new ads weekly, and we watch your rivals for you."* The already-scripted video is the concrete first deliverable.

## Conversion mechanics (baked into copy)

- Named, personal, specific — always "[Brand], you run 0 video formats while 8 rivals run all of them."
- Staleness hook — "This snapshot is true today; your rivals shipped 20 new ads this month" → makes *ongoing* the obvious answer.
- Loss framing over gain — "leaving these angles on the table" > "you could try these angles."
- One ad they can hold — the free rendered ad is the demo; the paywall is "keep going," not "see anything."

## v1 "wow" multiplier — Rival ad remade as yours

Take a competitor's top winner and show it restyled in the viewer's brand — the single most visceral "I need this" moment. Reuses the existing Discovery "Make it mine" / studio clone path. (Shareable social scorecard: **deferred** to a later version.)

## Build slice (smallest-first) — for the implementation plan

Most of Acts 1–5 already exist (`ScanTheater`, `runDnaEngine`, benchmark, staged reveal). New work, in order:

1. **Act 5 free creative** — render 1–2 image ads live from the top gaps (reuse ad studio / inspiration + industry DNA path).
2. **Video-script generator** — timestamped ARC-style shot list with the product; render a gated "Generate this video" button (video gen behind paywall).
3. **"Rival remade as yours"** — pull a competitor winner → restyle in-brand (reuse studio clone).
4. **Meta-connect bridge** — post-scan CTA → read-only connect → the reports view (real ROAS / wasted spend / winners).
5. **Paywall + subscribe** — after the Meta report; ties to existing plan/billing.
6. **cinema+ polish** — tickers, gauge sweeps, ad fly-ins layered over existing acts (reduced-motion safe).

## Open questions / risks (resolve during planning)

- **Pricing/offer at Ask 2** — RESOLVED: $1 setup now → 3-day trial → Creator $49/mo, single tier (Ryze-style checkout). Plan must wire the $1 charge + trial + auto-convert through the existing PayPal rail; confirm PayPal supports a nominal setup charge + delayed subscription start (or emulate via a $1 capture + subscription created with a 3-day trial period).
- **Meta read-only scope** — which token/permission path for an anonymous, not-yet-signed-up visitor? Connecting Meta likely requires account creation first — sequence needs care (may become "sign up free → connect Meta").
- **Video-gen cost control** — gated, but confirm per-generation economics.
- **Anonymous → identified handoff** — RESOLVED: 1-click Google sign-up slots in at step 3 (after the two free wins, before Meta connect). Free scan stays anonymous; sign-up only to save the audit + connect Meta. Plan must persist the anonymous scan result and re-attach it to the new account on sign-up.
- **Rate/abuse limits** on live image generation in a public, no-login theater.

## Constraints (standing)

- `/scan` stays purely additive and isolated from production onboarding; verify on production (keys live there), keep noindex + unlinked until Moeez adds the landing link.
- Reuse existing engine + studio paths; no new DDL without the pause-before-migration rule.
