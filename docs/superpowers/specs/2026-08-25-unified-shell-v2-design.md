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

- **Home** — NEW chat-first landing (see below)
- **Mission** — the existing mission control (growth engine, next moves, revenue)
- **Inbox**

**COMPANY**
- Journey
- Your Team
- Company Brain
- Documents

**ADS** *(= the Lapis workspace we built — merged into the shell)*
- Ads Chat (the "Start with an idea" generator)
- Your Ads
- My Competitors
- Discover
- Products
- Brand Kit
- Audiences
- Calendar
- Google Ads

**SEO** *(Grow's hidden tabs, flattened — each a visible item)*
- Overview
- Store
- Content
- Pages at scale
- SEO
- AI Search
- SEO Competitors

**INTEL** *(Spy/Discovery stays its own group)*
- Discovery
- Brand Spy
- Boards
- Studio (classic)

Bottom: credits chip → "Hire the team →" (/hire) · Settings · Account.

Notes:
- Sections are labels, not accordions — everything visible, one click to anywhere (Result pattern).
- Locked/coming items render dimmed with a lock (like ads-studio's ChatGPT Ads) — roadmap as desire.
- Mobile: the same list in an off-canvas drawer (existing useIsMobile pattern).

## Chat-first Home (decided)
Landing = talking to your AI company, not a dashboard:
- Full-width **Mello chat** ("What should we work on?") reusing the EXISTING Mello agent + tools
  (grounded router, create_ad, brain recall) — not a new brain.
- Above the chat: the Mission **NEXT MOVE** banner + 3 stat cards (revenue / content live / share of
  voice) so the company's standing is one glance.
- Prompt chips: "What should I do today?" · "Make an ad" · "Fix my product SEO" · "Who are my
  competitors?" — each seeds the chat; ad requests hand off into Ads Chat with context.
- Mission remains one click away as its own item (it is NOT removed).

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
