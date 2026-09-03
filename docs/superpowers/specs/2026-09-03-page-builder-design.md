# Selfmade Page Builder — Design Spec

**Status:** Approved design, ready for implementation plan.
**Date:** 2026-09-03
**Owner:** Moeez (founder) · Claude (build)

## 1. What we're building

A **template-driven AI page builder**: the merchant picks a hand-built, high-converting
template, picks one of their products, shapes the copy (research → persona → angle), and Selfmade
generates a finished page with **their** copy and **their** product images swapped in — then imports it
into their Shopify store. Modeled on the Atlas "Create landing page" flow.

**v1 ships two templates: one Advertorial + one Listicle** (the two ad-landing formats), fully working
end to end. Home-page and product-page templates come later on the same engine.

## 2. Locked decisions (from founder Q&A, 2026-09-03)

| Decision | Choice |
|---|---|
| Publish target | **Import into the merchant's Shopify** (native, they own + can edit it) |
| MVP scope | **Advertorial + Listicle first** — 1 template each, end to end |
| Build flow | **Wizard only** (Atlas-style multi-step; no Mello-chat trigger in v1) |
| Images | **Product photos first; AI-generate to fill gaps** (hero/lifestyle/before-after) |
| Copy shaping | **Full flow**: optional research upload → AI persona → AI angles → user picks |
| Shopify format | **Shopify Page with self-contained inline-styled HTML** (see §8 recommendation) |

## 3. Non-goals (explicitly NOT in v1)

- Home-page and product-page templates (later — same engine).
- Native Shopify **theme sections** / drag-drop block editing (v1 is a Page; §8 is the v2 path).
- Mello-chat trigger ("build me an advertorial") — wizard only for v1.
- A/B testing, per-page analytics, multi-variant generation.
- Editing a generated page inside Selfmade after building (v1: rebuild or edit in Shopify).

## 4. Architecture

### 4.1 Template model (the engine)

A template = **a self-contained HTML skeleton + a slot schema (JSON)**.

- **Skeleton**: hand-authored, inline-styled HTML. This is the fixed, high-converting layout. Inline
  styles so it renders identically inside a Shopify Page with no external CSS.
- **Slot schema**: the list of fillable spots the AI may write, each typed:
  - `text` slots carry a `role`: `headline | subhead | body | label | quote | list_item`.
  - `image` slots carry a `role`: `product | hero | lifestyle | before | after | thumbnail`.
  - other slots: `rating`, `price`, `offer`, `countdown_hours`, `list` (repeatable group).
- **Invariant:** AI fills slots only; it never edits layout/structure. This is what keeps every
  generated page on-template. A slot the AI leaves empty falls back to a template default.

Templates live in code as data (`src/lib/builder/templates/*`), each exporting
`{ id, type, name, thumbnail, schema, skeletonHtml }`. Adding a template later = author one skeleton +
schema; no engine change.

Repeatable sections (e.g. listicle items, proof cards) are declared as a `list` slot with an item
sub-schema; the generator emits N filled copies.

### 4.2 Generation pipeline

Input: `templateId`, `productId`, `persona`, `angle`, optional `research`.

1. **Gather context** — product (title, description, images[], price, review snippets) from Shopify
   sync; brand voice + USPs from Company Brain; chosen persona + angle; parsed research text.
2. **Write copy** — one grounded LLM pass (existing Opus→Gemini→gpt-4o chain from
   `mello/reports/competitor-report.ts`) that returns a JSON object mapping every `text`/`list`/`offer`
   slot → written value, in the brand voice, for the persona + angle. Strictly keyed to the schema so
   output is deterministic to assemble.
3. **Resolve images** — for each `image` slot: match a real product photo by role first; when none fits
   (`hero`/`lifestyle`/`before`/`after`), AI-generate with `gemini/image` using a product photo as
   reference; upload generated images to R2; collect `{slot: url}`.
4. **Assemble** — substitute copy + image URLs into the skeleton → final self-contained HTML.
5. **Preview** — render the HTML in a sandboxed iframe with desktop/mobile toggle.
6. **Publish / Save** — see §4.4.

Steps 2 and 3 run concurrently where possible. The whole build shows a staged progress UI
("Reading product data → Writing copy → Assembling → Finalizing preview"), matching the Atlas UX.

### 4.3 The wizard (`/builder`)

Atlas-style, 4 inputs then preview:

1. **Template** — Advertorial or Listicle, each with a live thumbnail + one-line "what it's for".
2. **Product** — searchable list of synced Shopify products (title, SKU, price, thumbnail).
3. **Customer research** (optional) — upload `txt/pdf/md/docx/csv`; toggle **Stick closely** vs
   **Use as inspiration**. Reuses existing upload + parse.
4. **Persona + angle** — AI generates 1+ persona(s) and 3–4 marketing angles from product + brand
   (reuses DNA/strategist/persona infra); the user picks one persona and one angle. "Add your own"
   persona is allowed (free-text → AI expands).

Then **Build** → staged progress → **Preview** (desktop/mobile) → **Import to Shopify** or **Save as
draft**. A right-rail **Summary** mirrors the inputs (template / product / research / persona / angle),
like Atlas.

### 4.4 Publish

- **Import to Shopify** → create a native Shopify **Page** via the Admin API (`pages.json`, `body_html`
  = the assembled self-contained HTML), following the pattern in `src/lib/shopify/geo-apply.ts`. Returns
  the live `/pages/<handle>` URL. Handle derived from the page title, de-duplicated.
- **Save as draft** → persist to `builder_pages` (no Shopify write); resumable/re-openable.
- After a successful import, store `shopify_page_id` + `shopify_url` on the record.

### 4.5 Data model

New table **`builder_pages`** (migration required):

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid | owner |
| brand_id | uuid null | active brand |
| store_id | uuid null | connected Shopify store |
| template_id | text | e.g. `advertorial_v1` |
| type | text | `advertorial` \| `listicle` |
| product_id | text | Shopify product gid/id |
| persona | jsonb | chosen persona |
| angle | jsonb | chosen angle |
| research_ref | text null | uploaded research pointer |
| content | jsonb | filled `{slot: value}` (copy + image urls) — source of truth for re-render |
| preview_html | text | assembled HTML (cache) |
| status | text | `draft` \| `published` |
| shopify_page_id | text null | after import |
| shopify_url | text null | after import |
| created_at / updated_at | timestamptz | |

Templates themselves are **code, not a table** (versioned, like `plans.ts`).

Follow the standing rule: pause crawl/drain before applying the migration (see project memory
"Pause Before DDL").

### 4.6 Reuse map (little built from scratch)

| Need | Reuse |
|---|---|
| Product data | `src/lib/shopify/sync.ts` + a product fetch |
| Copy generation | model chain in `src/lib/mello/reports/competitor-report.ts` + Company Brain context |
| Persona + angles | DNA engine (`src/lib/dna/engine.ts`) / strategist / persona infra |
| Images | `src/lib/gemini/image.ts`, `src/lib/brand-photos.ts`, `src/lib/r2.ts` |
| Publish to Shopify | `src/lib/shopify/geo-apply.ts` (pages API) pattern |
| Research upload/parse | existing upload + parse used by the audit/task flows |
| Credits | `reserveCredits` — media/image gen billed per image; define a page-build cost |

### 4.7 Credits / cost

- Copy generation: one fixed page-build credit cost (define in `ACTION_COSTS`, e.g. `page_build`).
- Each AI-generated image: existing per-image media cost (product photos are free).
- No charge to preview a saved draft; charge on Build (generation), consistent with the media model.

## 5. Files (anticipated)

- `src/lib/builder/templates/advertorial_v1.ts`, `listicle_v1.ts` — skeleton + schema.
- `src/lib/builder/templates/index.ts` — registry + types.
- `src/lib/builder/generate.ts` — the pipeline (context → copy → images → assemble).
- `src/lib/builder/assemble.ts` — slot substitution into skeleton.
- `src/lib/builder/personas.ts` — persona + angle generation (wraps DNA/strategist).
- `src/lib/builder/publish.ts` — create Shopify Page.
- `src/app/(dashboard)/builder/*` — the wizard UI (steps + preview).
- `src/app/api/builder/*` — generate / personas / publish / drafts routes.
- `supabase/migrations/NNN_builder_pages.sql` — the table.

## 6. End-to-end flow (happy path)

Pick Advertorial → pick "G&T Pre-Wash Oil" → (skip research) → AI proposes persona "nutrient-deprived
hair sufferer" + 4 angles → pick persona + "Revitalize dull hair" → **Build** (reads product, writes
copy for that angle, pulls product photos + generates a hero shot, assembles) → **Preview** (mobile) →
**Import to Shopify** → live at `store/pages/revitalize-dull-hair`, editable in Shopify.

## 7. Risks / mitigations

- **Copy not matching the schema** → force strict JSON keyed to the schema; validate + fill missing
  slots with template defaults before assembling.
- **AI image quality / off-brand** → product photo first; generated images use the product photo as
  reference and a constrained prompt; user can rebuild.
- **Confabulated product claims** → ground copy strictly in the product's real description/reviews;
  never invent ingredients/results (see project memory on confabulation).
- **Self-contained HTML in Shopify** → inline all CSS, no external assets except R2 image URLs.
- **Migration under load** → pause crawl before DDL.

## 8. Recommendation: Shopify Page vs Theme Section

**v1 → publish as a Shopify Page (self-contained inline-styled HTML).** Rationale: it uses the pages API
we already have, is fully self-contained (renders identically anywhere), and ships fast and reliably.
Trade-off: the merchant edits it as an HTML block in Shopify, not as native drag-drop theme sections.

**v2 → theme section (Liquid + section schema)** for native block editing, once the engine + templates
are proven. The slot model maps cleanly onto section `settings`/`blocks`, so v1 is not throwaway.

## 9. Open questions for the plan phase

- Exact credit cost of a page build (copy) — align with `ACTION_COSTS`.
- Which persona/angle infra path exactly (DNA engine vs strategist) gives the best angles for a single
  product — resolve while writing the plan by reading both.
- Handle-collision + republish behavior (new page vs update existing).
