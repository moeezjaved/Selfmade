# Project Scope — Native Theme-Blocks Product Template

**Owner:** _tbd_ · **Status:** Scoping · **Created:** 2026-09-05

## 1. Goal

Make the Selfmade-generated **product page** structurally identical to a stock Shopify theme's
product template by rebuilding the main product area on Shopify's **native block architecture**, so
that in the Shopify theme editor a merchant can **add / remove / reorder the individual blocks** of the
product section (title, price, variant picker, buy-buttons, description, media) **and drop in third‑party
app blocks** (reviews, upsells, subscriptions), exactly like Dawn/Horizon.

This is the one remaining **architectural** gap. Everything else is already done:
- Native `{% form 'product' %}` + `{{ form | payment_button }}` (Shop Pay / Buy-it-now) — `src/lib/builder/shopify-sections.ts:productForm`
- Dynamic `{{ product.title / price / description }}` + gallery loop — `dynamizeProduct`
- Pill + colour-swatch variant picker with variant→image switching — `FORM_JS` / pill markup
- Per-section style settings (bg / text / align / spacing / size) + editable text/images/button-links — `SECTION_STYLE_SETTINGS`, `editablize`

## 2. Current state (what we replace)

Today `buildThemeAssets` (`src/lib/builder/shopify-sections.ts`) splits the built landing page into ~18
**self-contained sections**, one `.liquid` file each, and bakes the whole buy-box (form + variant picker +
gallery + title/price/description) into a **monolithic "Hero" section**. The section `{% schema %}` has
`settings` + `presets` but **no `blocks`** (`liquidSection`). So merchants can reorder whole sections and
edit settings, but cannot compose the product section from blocks, and cannot insert app blocks into it.

## 3. Target architecture

Adopt the **classic section-blocks model** (`{% for block in section.blocks %}` + `blocks: [...]` in the
section schema + block order in the template JSON). Rationale: it is supported by **every theme since 2016**
(Dawn, Horizon, and merchant themes), and — critically — it supports **`{ "type": "@app" }`** so
Shopify app blocks appear in the merchant's block picker. (Shopify's newer "theme blocks" in
`/blocks/*.liquid` are more powerful but skew Horizon-specific; keep them as a possible Phase‑6 upgrade,
not the baseline.)

The generated `templates/product.<suffix>.json` gains a **`main-product`** section whose `blocks` object +
`block_order` compose the buy-box, plus the existing marketing sections after it.

Emitted per publish (extends the current `publish-theme.ts` writer — still just `assets.json` PUTs):
- `sections/<slug>-main-product.liquid` — the product section: renders `{% for block in section.blocks %}`
  with a `case block.type` for each native block, and `{% schema %}` declaring the block list incl. `@app`.
- The rest of the marketing sections as today (Phase 4 turns their inner pieces into blocks too).
- `templates/product.<suffix>.json` — references `main-product` with its `blocks` + `block_order`.

## 4. Phased plan

Each phase ships independently and is publishable/testable on a draft theme.

### Phase 1 — Main product section as native blocks (core)
Replace the monolithic hero with a `main-product` section built from blocks. Block types:
`title`, `price`, `variant_picker` (our pill/swatch picker), `buy_buttons` (native form + `name="add"` +
`{{ form | payment_button }}` + quantity), `description`, `media` (gallery), plus a generic
`text` / `custom` block for marketing copy, plus `{ "type": "@app" }`.
- Files: `src/lib/builder/shopify-sections.ts` (new `mainProductSection()` + block renderers; extend
  `liquidSection`/`buildThemeAssets` to emit block schema + template-JSON `blocks`/`block_order`).
- Deliverable: merchant can add/remove/reorder title/price/variant/buy/description/media blocks + app blocks
  in the theme editor; all still dynamic.
- **Effort: L** (largest phase; the schema + template-JSON block wiring is the heart of the project.)

### Phase 2 — Native media gallery
Replace the custom scroll carousel with the theme-standard media block: thumbnails, pinch/zoom, **video &
3D/AR** model support, and lazy/deferred media.
- Option A (cross-theme, self-contained): our own gallery block that also renders `{% for media in
  product.media %}` handling `image` / `video` / `external_video` / `model`, with a light zoom lib inlined.
- Option B (best fidelity, theme-coupled): `{% render 'product-media-gallery' %}` when the target theme
  exposes it — detect per theme, fall back to A.
- **Effort: M–L.**

### Phase 3 — Variant picker fidelity
Bring the picker to native standard: swatch **images** from variant media / `color` swatch metafields
(not just CSS-name dots), **`?variant=` URL** update + history, and per-value availability (disable
unavailable combinations, not just the resolved variant).
- Files: extend `FORM_JS` + variant_picker block markup.
- **Effort: M.**

### Phase 4 — Marketing sections as blocks
Turn each marketing section's repeated items (review cards, feature rows, FAQ items, benefit cards) into
**section blocks** so merchants add/remove/reorder them natively, instead of the whole section being fixed.
- Files: `editablize` / `splitPageIntoSections` — emit `{% for block in section.blocks %}` for list-shaped
  sections + block schema.
- **Effort: M** (repeat the Phase‑1 pattern per list section type.)

### Phase 5 — Recommendations + app-block slots
Add a `product-recommendations` ("You may also like") section and confirm `@app` blocks work in both the
product section and marketing sections (reviews/upsell apps).
- **Effort: S.**

### Phase 6 — Migration, publish flow, QA (cross-cutting)
- Back-compat: old published pages keep working; re-publishing upgrades them. Decide whether to
  auto-migrate previously-published product pages.
- `src/app/api/builder/publish/route.ts` + `publish-theme.ts`: write the new block-bearing template JSON.
- QA on Dawn **and** Horizon draft themes (block editor, add/remove app block, add-to-cart, variant→media,
  dynamic checkout). Verify via the Admin Assets API read-back (as used in this session).
- **Effort: M.**

## 5. Key decisions (need sign-off before Phase 1)

1. **Block model:** classic section-blocks (recommended, universal + `@app`) vs new `/blocks/*` theme
   blocks (Horizon-first). Recommendation: **classic now, new theme-blocks as an optional Phase‑6+.**
2. **Marketing content in-section vs separate sections:** keep marketing as sibling sections (simpler) vs
   also block-ify (Phase 4). Recommendation: **Phase 1 does the product section only; Phase 4 is optional.**
3. **Media gallery build vs borrow:** self-contained block (portable) vs theme snippet (best fidelity).
   Recommendation: **self-contained, with theme-snippet detection as an enhancement.**
4. **Auto-migrate existing pages** on next publish, or leave until the merchant re-publishes.

## 6. Risks

- **Theme variance:** block rendering + app-block slots behave slightly differently across themes; must QA
  on Dawn + Horizon + at least one merchant theme. `@app` requires the theme to support app blocks (all
  Online Store 2.0 themes do).
- **Template-JSON block schema is strict:** malformed `blocks`/`block_order` breaks the template silently in
  the editor — needs the Admin-API read-back check in CI/QA.
- **Media/variant edge cases:** products with no media, single variant, or unavailable combinations.
- **Rate limit:** more assets per publish (Admin Theme API ~2 req/s) — keep the existing `sleep(140)`.

## 7. Non-goals

- Rewriting the Selfmade **visual editor** — it keeps producing the page; only the *publish → theme* output
  changes.
- Changing home/advertorial/listicle templates (separate follow-up if wanted).
- Building a marketplace app block of our own.

## 8. Rough effort

Phase 1 is the bulk (**L**). Phases 2–6 are **M/S** each and independently shippable. A sensible first
milestone = **Phase 1 + Phase 3** (native product section + real swatch/URL variant picker), which delivers
the visible "it's a real Shopify product template" outcome; media gallery (Phase 2) and marketing block-ify
(Phase 4) follow.
