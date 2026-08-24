# Unified Shell v2 — flat sidebar + chat-first Home (Lapis/Result pattern)

**Decision (2026-08-25, with founder):** replace the icon-rail + hidden-flyout navigation with ONE flat,
always-visible, grouped sidebar across the whole app — the Result.dev/Lapis pattern — and make the
landing experience **Mello chat-first**. Light theme, our orange (the ads-studio sidebar style extended
app-wide). Rolled out additively behind a flag; the old shell stays for rollback (standing rule: never
delete).

## Why
- The current rail hides the product: "Grow" hides 7 tabs, "Home" hides 5 pages behind a hover flyout,
  and the new ads workspace lives on an island route. Users can't see what they own.
- A flat sidebar with section labels makes the "company of AI employees" VISIBLE — every department a
  user can see in the nav is value they know they're paying for.
- The ads-studio sidebar (white, orange active pill, grouped labels, Fraunces/Inter) is already the
  design language — extend it, don't invent a new one.

## Rollout (decided: flag-first, additive)
- New `CompanyShell` component; the dashboard layout branches on a `sf_shell` cookie:
  `?shell=v2` → sets cookie → new shell; `?shell=v1` → back to the old rail. Default stays v1 until we
  flip it. Pages themselves are NOT rewritten — same routes render inside the new chrome.
- Old AppShell is kept untouched for rollback.

## The sidebar (light, our orange)
Top: logo + brand switcher (active brand, e.g. "Aura ·").

- **Home** — chat-first landing (Mello chat + the Mission dashboard, one screen — see below)
- **Inbox**

**COMPANY**
- Journey
- Your Team
- Company Brain
- Documents

**ADS** *(= the workspace we built — assets & insight, NOT a chat)*
- Your Ads
- My Competitors
- Discover
- Products
- Brand Kit
- Audiences
- Calendar

**SEO** *(Grow's hidden tabs, flattened — each a visible item)*
- Overview · Store · Content · Pages at scale · SEO & AI Search · SEO Competitors

**INTEL** *(Spy/Discovery stays its own group)*
- Discovery · Brand Spy · Boards · Studio (classic)

Bottom: credits/usage (paid) OR "Hire the team →" (/hire, free) — context-aware · Settings · Account.

### Refinements folded in (a, b, c — founder-approved)
- **(a) ONE chat — Mello — everywhere.** There is no separate "Ads Chat". Users make ads by talking to
  Mello on Home (it generates inline via the existing ads engine / create_ad tool). The ADS group is
  assets + insight only. Kills the "which chat do I type in?" confusion.
- **(b) Mission is MERGED into Home** (not a separate item) — one command center, not two overlapping
  dashboards.
- **(c) Progressive disclosure by STAGE.** The sidebar surfaces the departments the user is actually
  using; the rest sit dimmed below a "Grows with your stage" divider with a gentle unlock. Connecting a
  store / running ads / publishing pages lights up more of the company. Groups are labels (Result
  pattern), not accordions; the dimming is stage-driven, not collapsed-by-default.
- Mobile: the same (stage-filtered) list in an off-canvas drawer (existing useIsMobile pattern).

## Chat-first Home (decided) — Mission merged in
Landing = talking to your AI company, WITH the numbers on the same screen:
- Full-width **Mello chat** ("What should we work on?") reusing the EXISTING Mello agent + tools
  (grounded router, create_ad, brain recall) — not a new brain, and the ONLY chat in the app.
- **Directly below the chat**, the Mission dashboard: the **NEXT MOVE** banner + revenue / content-live /
  share-of-voice cards. (Mission is folded in — there is no separate Mission page competing with Home.)
- Prompt chips: "What should I do today?" · "Make an ad" · "Fix my product SEO" · "Who are my
  competitors?" — each seeds the same Mello chat; ad requests generate inline / open the ads canvas.

## SEO flattening (phase-cheap)
Sidebar SEO items deep-link to the existing /grow surfaces (`/grow?tab=…`) — zero page rewrites in
phase 1. Real standalone routes can come later if wanted.

## Ads merge
The ads-studio screens mount inside the shell (shared nav state), while the standalone
`/ads-studio?domain=…` route KEEPS working (it's the audit funnel's landing). One codebase of screens,
two entries.

## Phases
1. **Shell scaffold** — CompanyShell + flag plumbing + mobile drawer; all existing pages render inside.
2. **Ads merge** — ads-studio screens mounted in-shell under the ADS group.
3. **SEO + COMPANY flattening** — deep-linked items replace flyout/tabs.
4. **Chat-first Home** — the Mello landing (biggest new build; reuses existing agent).
5. **Polish + flip** — default v2, old rail behind ?shell=v1, watch, then retire the flag.

Each phase ships independently behind the flag; founder tests at ?shell=v2 throughout.
