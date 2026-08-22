# /scan → Meta Connect → Mello Leak Report → Paywall — Design Spec

**Date:** 2026-08-22
**Status:** Design approved in brainstorm (Moeez). Ready for implementation plan.
**Surface:** the `/scan` funnel's forward path — after the free audit + signup.

## Goal

Turn a signed-up `/scan` visitor into a paying, ongoing customer by: connecting their real Meta account, showing where their money is leaking (real spend, not the free estimate), and letting Mello continuously find + fix leaks — gated behind a subscription.

## Approved decisions

- **Connect Meta = the REAL connection** (reuse the brief's `connect-byo` flow: mint/paste a System User token → sync → M4 audit). NOT a read-only OAuth. (`src/app/api/meta/connect-byo`.)
- **The connected report LEADS with "Where your money is leaking"** — real wasted spend on ads below the account's average ROAS. Turns the free scan's *estimate* into their true number.
- **The unlock = ongoing monitoring + auto-fixes (Mello-powered).** Mello runs its research pass, surfaces "N actions waiting for your approval" (the existing suggestion/approval system — the emailed card in Moeez's screenshot), each action → **Manage with Mello**. Mello keeps watching and re-sends the approvals digest when it finds new leaks/opportunities.
- **Paywall = $1 setup → 3-day trial → Creator $49/mo.** Seeing the leak (the total) is the free hook; **approving/acting + ongoing monitoring sit behind the paywall.** Reuse PayPal (`paypal/create-order`, `end-trial`), `UpgradeGate`, `/pricing`, `email-domains` gate is OFF so Gmail works.

## Reuse vs new

- ♻️ **Reused:** Meta connect (`connect-byo`), the M4 audit, Mello's suggestion/approval cards + "N actions waiting" email, PayPal billing + trial, `UpgradeGate`, `/pricing`, existing signup (gate off).
- 🆕 **New:** (a) `/scan` forward path → after signup, route to Meta connect; (b) the **leak-led framing** over the M4 audit output ("€X/mo leaking" headline + the losers/winners); (c) drop the **$1→trial→$49 paywall** in front of "act / ongoing"; (d) resume onboarding/into-app from the stashed `sf_scan` brand.

## Flow (end to end)

1. Free `/scan` audit → "Start free" → `/signup?ref=scan` (Gmail OK) → into app, brand pre-loaded from `sf_scan`.
2. Prompt: **Connect Meta** → `connect-byo` (validate token → pick accounts → sync → M4 audit).
3. **Leak report** (free to view): "€X/mo leaking" + the itemized losers vs winners (from M4).
4. **Paywall:** to *act* (approve the fixes, launch the scan creative) + turn on ongoing monitoring → **$1 → 3-day trial → $49/mo**.
5. **Post-paywall:** Mello sends "N actions waiting for your approval"; each → **Manage with Mello**; approve → agent acts. Ongoing digests keep the loop alive.

## Open questions for the plan

- Exact "wasted spend" definition from M4 (below-average-ROAS spend? below break-even?) — reuse M4's existing pause/underperformer logic.
- Where the $1-trial PayPal variant differs from existing subscription checkout (does `paypal/create-order` already support a setup charge + trial period, or is a new variant needed?).
- Onboarding resume: `sf_scan` gives a Meta page_id + name, not a website; look up `brand_directory.website` to pre-fill onboarding's website field.
- Production safety: Meta connect, billing, and onboarding are all sensitive — additive wiring only, no restructuring of the existing flows.

## Constraints (standing)

- Do NOT disturb production onboarding/auth/billing/Meta flows — additive wiring only.
- `/scan` stays the standalone funnel; this extends its forward path, doesn't change the free audit.
- No real payment executed by the agent; build the checkout, the user/customer completes payment.
