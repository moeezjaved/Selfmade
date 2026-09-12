# Advanced Visual Page Builder — Design Spec

**Date:** 2026-09-12
**Owner:** Moeez
**Goal:** Rebuild the Selfmade Page Builder into an advanced, PagePilot/PageFly‑class visual editor: a structured page model with a 3‑pane editor (section/block tree · live canvas · granular property panel), a full section library, AI‑to‑schema generation, and native Shopify publish. Exact parity with PagePilot's advanced editor. A **beginner** mode comes in a later spec.

> Reference product being matched: **PagePilot: AI Page Builder** (Shopify app) advanced editor.

---

## 1. Why (and the decision already made)

- **Approved approach (Moeez):** a **full structured rebuild** — a typed JSON page model + a runtime that renders it both to the live canvas and to the published Shopify HTML. This is what enables an exact per‑element property panel; our current HTML‑blob storage cannot.
- **Approved scope:** **all** PagePilot section types in the first build.
- **Beginner editor:** separate, later. This spec is **advanced** only.

### What we already have (reuse, don't discard)
- `src/app/(dashboard)/builder/page.tsx` — create flow (product URL/select · Language · palette · **AI‑images count**, already shipped).
- `src/app/(dashboard)/builder/BuilderEditor.tsx` — current iframe editor: inline text edit, section reorder/duplicate/delete (in‑iframe runtime), device toggle, AI "Add a section" composer, per‑image popover, Publish.
- `src/lib/builder/` — `templates` (`getTemplate`, `SlotDef` schema of typed slots), `generate.ts` (`generatePage`: slots → grounded copy + resolved images, now with `aiImageCount`), `palettes`, `context`, `personas`, `products`.
- APIs: `/api/builder/generate`, `/api/builder/section-agent`, `/api/builder/image`, `/api/builder/publish`, `/api/builder/update`, `/api/builder/drafts`, `/api/builder/templates`.
- Storage: `builder_pages` rows (page HTML + metadata today).

**The rebuild evolves the slot schema into a full section/block/element tree and swaps HTML storage for the JSON model** — but keeps generate, section‑agent, image, and publish as adapters over the new model.

---

## 2. Target UX (from PagePilot)

### 2.1 Editor shell — 3 panes + top bar
```
┌───────────────────────────────────────────────────────────────────────┐
│ [Edit Product] [select] [🖥 desktop][📱 mobile][⛶ full]     [Publish] [Menu] │  top bar
├───────────────┬───────────────────────────────────┬─────────────────────┤
│ SECTION TREE  │            LIVE CANVAS            │   PROPERTY PANEL     │
│ (left)        │            (center)              │   (right)           │
│               │                                   │                     │
│ Product Info  │  [live rendered page, editable]   │  <selected element> │
│  ▸ Gallery    │   hover block → toolbar:          │  Typography         │
│    + Add Block│     👁 ⧉ ↑ ↓ ＋AddBlock 🗑          │  Spacing            │
│  ▸ Details    │   click text → inline edit        │  Color / Background │
│ Image w/ TL   │   click image → replace/generate  │  Border / Layout    │
│ …             │                                   │                     │
│ + Add Section │                                   │                     │
└───────────────┴───────────────────────────────────┴─────────────────────┘
```

**Top bar**
- **Edit Product** — opens product‑field editing (title, price, compare‑at, options, rating, media) that the page binds to.
- **Select tool** — pointer/marquee to pick elements on the canvas.
- **Device toggle** — desktop / mobile (and PagePilot's fullscreen). Canvas re‑renders at the device width; property panel supports per‑device overrides (see §4.4).
- **Publish** — push to Shopify (native section/blocks — see §6).
- **Menu** — page settings, SEO, duplicate, delete, version history, revert, undo/redo.

**Left — Section/Block tree**
- Ordered list of **sections**; each expandable to its **blocks**; each block expandable to **elements** where relevant. Counts shown per node (matching PagePilot: "Product Information (25)", "Image with Benefits (24)", etc. — the number is the descendant element count).
- Per‑node actions: select (syncs canvas + panel), reorder (drag or ↑↓), duplicate, hide, delete, **＋ Add Block** (within a section), **＋ Add Section** (opens the Section Library picker).
- Selecting a tree node scrolls the canvas to it and loads its props in the panel; selecting on the canvas highlights the tree node. Two‑way binding.

**Center — Live canvas**
- Renders the page model via the **runtime** at the chosen device width.
- **Block hover toolbar:** 👁 hide · ⧉ duplicate · ↑ move up · ↓ move down · ＋ Add Block · 🗑 delete (exactly as PagePilot's floating toolbar).
- **Inline text edit:** click a text element → contentEditable; changes write to the element's `text` prop.
- **Image edit:** click an image → popover (upload / AI‑generate / pick product photo) → writes the element's `src`.
- Selection outline + label on the active element.

**Right — Property panel** — see §4. Scoped to the selected element; grouped controls; live updates.

### 2.2 Product‑bound elements
Product Page elements bind to the Shopify product: **title, price, compare‑at price, Save %, rating + review count, variant/quantity options (e.g. "Buy 4 Get 8 Free"), media gallery, Add to Cart / Sticky ATC.** These read from the product but are individually stylable and can be overridden.

---

## 3. Data model (the core rebuild)

### 3.1 The tree
```ts
type PageDoc = {
  id: string
  version: number
  productRef: { productId?: string; importedProduct?: ImportedProduct | null }
  theme: { paletteId: string; fonts: FontSet; tokens: DesignTokens }  // brand-level defaults
  settings: { seo: {...}; locale: string }
  sections: Section[]
}

type Section = {
  id: string
  type: SectionType            // 'productInfo' | 'imageTimeline' | 'imageText' | 'shapeDivider'
                               // | 'imageBenefits' | 'imagePercentage' | 'productDifferences'
                               // | 'asSeenOn' | 'reviewsCarousel' | 'recommendedProducts' | 'stickyAtc' | ...
  blocks: Block[]
  style: StyleProps            // section-level container styles (bg, padding, width, gap…)
  hidden?: boolean
  settings?: Record<string, unknown>   // section-type-specific config (e.g. timeline step count)
}

type Block = {
  id: string
  type: BlockType              // 'gallery' | 'title' | 'price' | 'rating' | 'benefitList'
                               // | 'timelineStep' | 'reviewCard' | 'logoStrip' | 'diffTable' | …
  elements: Element[]          // leaf editable elements
  style: StyleProps
  hidden?: boolean
  settings?: Record<string, unknown>
}

type Element = {
  id: string
  type: ElementType            // 'text' | 'heading' | 'image' | 'video' | 'icon' | 'button' | 'badge'
                               // | 'divider' | 'stars' | 'countdown' | 'price' | 'bind' (product-bound)
  content: ElementContent      // { text? } | { src?; alt? } | { bind: 'product.title' } | …
  style: StyleProps
  hidden?: boolean
}
```

### 3.2 Style props (drives the property panel)
`StyleProps` is a **per‑device** map of design‑token‑aware values. Every control in §4 reads/writes a key here.
```ts
type StyleProps = {
  // typography
  fontFamily?: TokenOrValue; fontSize?: Len; fontWeight?: Weight; lineHeight?: Len;
  letterSpacing?: 'tight'|'normal'|'loose'|Len; textCase?: 'default'|'upper'|'lower'|'capitalize';
  color?: TokenOrColor; textAlign?: 'left'|'center'|'right'|'justify';
  // layout / spacing
  gap?: Len; paddingX?: Len; paddingY?: Len; marginX?: Len; marginY?: Len;
  width?: Len; maxWidth?: Len; align?: 'start'|'center'|'end'|'stretch'; direction?: 'row'|'column';
  // background / border
  background?: TokenOrColor; backgroundImage?: string;
  radius?: Len; borderWidth?: Len; borderColor?: TokenOrColor; shadow?: ShadowToken;
  // responsive: any key may carry a { base, mobile } override
}
```
- `TokenOrColor` resolves against `theme.tokens` (e.g. **"Primary"** brand color as seen in the Price panel) OR a raw hex.
- Values are stored as tokens where possible so a theme change re‑skins the whole page (matches PagePilot's "Branding Text Color: Primary").

### 3.3 Storage / migration
- New column(s) on `builder_pages`: `doc jsonb` (the `PageDoc`), keep `html` for the published snapshot. Migration adds `doc`, backfills nothing (new pages use `doc`; old HTML pages open read‑only or are re‑generated). Version each save (`version` + a `builder_page_versions` history table for undo/revert).
- **Autosave** on every change (debounced) → `PUT /api/builder/doc`.

---

## 4. Property panel — the control system

The panel renders **groups of controls** for the selected element/block/section. Controls map 1:1 to `StyleProps` keys. Base control kit (reused across every section):

| Control | UI | Writes |
|---|---|---|
| **Text color / Branding color** | swatch + token dropdown ("Primary", "Secondary", custom) | `color` |
| **Size** | slider + number (px) | `fontSize` |
| **Weight** | dropdown (Light…Black) | `fontWeight` |
| **Letter spacing** | segmented Tight / Normal / Loose | `letterSpacing` |
| **Case** | dropdown Default / UPPER / lower / Capitalize | `textCase` |
| **Gap** | toggle + slider + number (px) | `gap` |
| **Background color** | swatch ("No color chosen") | `background` |
| **Background padding Y / X** | slider + number (px) | `paddingY` / `paddingX` |
| **Background rounded corners** | slider + number (%/px) | `radius` |
| **Align / direction / width** | segmented + number | `align` / `direction` / `width` |
| **Border** | width + color + style | `borderWidth`/`borderColor` |
| **Shadow** | preset dropdown | `shadow` |
| **Visibility** | show/hide per device | `hidden` (per device) |

- **Grouping** matches PagePilot: a header (e.g. "Price"), then rows of labeled controls, with an "edit" pencil to rename/duplicate the group.
- **Per‑device:** a small desktop/mobile switch at the top of the panel toggles which device's overrides you're editing; unset mobile values inherit base.
- **Section‑ and element‑type specific controls** are appended below the base kit (e.g. Reviews Carousel → rating source, cards‑per‑view, autoplay; Sticky ATC → trigger offset, show‑on‑scroll; Timeline → step count, connector style). **These per‑section control sets are the detail to lock from per‑section screenshots (see §8).**

---

## 5. Section library (all PagePilot sections)

Each is a schema **SectionType** with a default `blocks` layout, its own settings, and a thumbnail in the "Add Section" picker. First‑build order in **bold**.

1. **Product Information** — Gallery (main image + thumbnails, product‑bound) + Product Details (title, price, Save %, rating, benefit bullets, options, ATC).
2. **Sticky Add to Cart** — pinned bar: product thumb + title + price + variant + ATC; show‑on‑scroll.
3. **Image with Benefits** — image + icon+label benefit list.
4. **Reviews Carousel** — rating summary + swipeable review cards (name, stars, body, photo).
5. **As Seen On** — logo strip ("featured in").
6. **Image with Timeline** — image + numbered "week 1 → 8" steps.
7. Image with Text — split image/text with CTA.
8. Image with Percentage — image + big stat/percentage callouts.
9. Product Differences — comparison table (us vs them).
10. Recommended Products — product cards row (Shopify product refs).
11. Shape Divider — decorative SVG section divider (wave/slant/etc.).

Every section supports the block toolbar (hide/dup/move/add/delete) and adds/removes blocks from a per‑section **block palette** ("Add Block").

---

## 6. Runtime & publish

- **One renderer, two targets.** A `renderDoc(doc, { device, mode })` produces:
  - **Editor canvas:** React components (interactive, selectable) inside the iframe.
  - **Publish:** static HTML/CSS (design‑token CSS variables + section markup) written to Shopify — reuse `/api/builder/publish` and the **native section/blocks** structure ([[project_builder_canonical_structure]] / [[project_builder_native_theme]]) so published pages stay theme‑editable.
- Style props compile to CSS (tokens → CSS vars). Per‑device props → media queries.
- **Parity requirement:** the canvas render and the published render must be visually identical.

---

## 7. AI + product integration (adapters over the model)

- **Generate → schema:** `generatePage` returns a `PageDoc` (sections/blocks/elements filled with grounded copy + resolved images) instead of HTML. The `aiImageCount` gate already shipped maps onto Element image slots.
- **Add a section (AI):** `/api/builder/section-agent` returns a `Section` node (typed) instead of an HTML string; inserted at the anchor.
- **Edit Product:** binds product fields into product‑bound Elements.
- Credits/pricing unchanged (per‑image billing; page‑build reserve).

---

## 8. Open items to lock (need per‑section input)

For **each** SectionType, the exact **per‑section property controls** and **block palette** (from a screenshot of that section selected with its panel open, or corrected during build):
- Product Information / Gallery / Details · Sticky ATC · Image w/ Benefits · Reviews Carousel · As Seen On · Image w/ Timeline · Image w/ Text · Image w/ Percentage · Product Differences · Recommended Products · Shape Divider.

Also to confirm during build: undo/redo depth + version history UI, SEO/settings fields, exact device breakpoints, font picker source (Google Fonts vs theme), and whether "Edit Product" writes back to Shopify or only to the page.

---

## 9. Phases (each ships something usable)

1. **Schema + runtime** — `PageDoc` types, `renderDoc` (canvas + publish), `builder_pages.doc` migration + autosave + version history. *Deliverable: an existing page opens, renders from the model, saves.*
2. **Editor shell** — 3‑pane layout, selection model, section/block tree (reorder/dup/hide/delete/add), canvas block toolbar, device toggle. *Deliverable: structural editing works end‑to‑end.*
3. **Property panel (base kit)** — typography/spacing/color/background/border/layout controls bound to selection, per‑device. *Deliverable: full styling of any element.*
4. **Section library** — build the sections in §5 order as schema components with per‑section settings + block palettes. *Deliverable: add any section, all render + publish.*
5. **AI‑to‑schema + publish** — `generatePage`/`section-agent` emit schema; publish path renders the model to native Shopify sections. *Deliverable: create → edit → publish on the new model.*
6. **Polish** — undo/redo, SEO/settings, Edit‑Product binding, parity QA vs PagePilot.

Then: **beginner editor** (separate spec) as a simplified surface over the same model.

---

## 10. Risks / notes
- Big rebuild touching generate + publish; keep the old HTML editor available behind a flag until the model path is at parity ([[feedback_never_delete_without_permission]]).
- Canvas↔publish visual parity is the hardest correctness bar — one renderer, shared CSS compile.
- Per‑device overrides add state complexity — design the StyleProps resolver once, use everywhere.
- Keep published pages **native/theme‑editable** (don't regress [[project_builder_canonical_structure]]).
