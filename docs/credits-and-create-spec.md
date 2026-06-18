# Credits + Create Pillar — Build Spec

Scope: credit system (50–90% margin), image Clone (user provides brand assets), Scripts +
Script Duplicate (Atria-style), all metered by credits. Video clone deferred (notes at end).

Principle (from Atria): **subscription buys library + platform access (browsing/search/save are
free); CREDITS meter AI compute only.** Credits map ~1:1 to your model cost.

---

## 1. Credit economics

**Anchor:** 1 credit = **$0.03 retail** (Atria Core = $129 / 4,000 ≈ $0.032/credit).

**Margin rule:** set each action's credit cost so `actual_cost ≤ (credits × $0.03) × (1 − target_margin)`.
Target 50–90%. Text actions land >90% (they're cheap); image clone is the tight one (~60–78%) — that's
expected, image gen is the real cost.

| Action | Credits | Retail | Est. cost | Margin |
|---|---|---|---|---|
| transcribe (video ≤2 min) | 2 | $0.06 | ~$0.006 | ~90% |
| script_generate | 5 | $0.15 | ~$0.003 | ~98% |
| script_duplicate | 5 | $0.15 | ~$0.003 | ~98% |
| brand_analysis (URL→brief) | 8 | $0.24 | ~$0.01 | ~96% |
| review_mining (CSV) | 10 | $0.30 | ~$0.02 | ~93% |
| **image_clone (4 variations)** | **15** | $0.45 | ~$0.10–0.18 | **60–78%** |

These are **config rows** (editable in admin), not hardcoded — model prices move, so the credit cost
must be tunable without a deploy.

---

## 2. Database schema

```sql
-- Plans
create table plans (
  id text primary key,                 -- 'trial','core','plus','business'
  name text not null,
  price_monthly_cents int not null,
  monthly_credits int not null,
  seats int not null default 1,
  is_active boolean default true
);

-- Credit balance lives on the billing owner. Using users; swap to workspace_id if/when
-- you add workspaces (Atria is workspace-scoped — design the column name now to ease that).
alter table users add column plan_id text references plans(id) default 'trial';
alter table users add column credits_balance int not null default 0;
alter table users add column credits_reset_at timestamptz;   -- next monthly refill

-- Per-action pricing (admin-editable config)
create table credit_pricing (
  action_type text primary key,        -- 'transcribe','script_duplicate','image_clone',...
  credits int not null,
  est_cost_usd numeric(10,4),          -- internal margin tracking
  is_active boolean default true,
  updated_at timestamptz default now()
);

-- Immutable ledger: every debit/credit/refund/reset
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  action_type text not null,           -- action OR 'monthly_reset','topup','refund'
  delta int not null,                  -- negative = spend, positive = grant/refund
  balance_after int not null,
  status text not null default 'committed',  -- 'reserved'|'committed'|'refunded'
  reference_id text,                   -- ad_id, clone_job_id, etc.
  metadata jsonb,                      -- {model, tokens, variations, actual_cost_usd}
  created_at timestamptz default now()
);
create index on credit_transactions (user_id, created_at desc);

-- Top-up packs (one-time purchases)
create table credit_packs (
  id text primary key, name text,
  credits int not null, price_cents int not null,
  is_active boolean default true
);
```

---

## 3. Credit middleware — reserve / commit / refund

Slow, failable actions (image_clone, transcribe) use **2-phase** so a failed generation never charges
the user. Instant actions (script) can single-shot debit.

```ts
// Reserve BEFORE the model call. Row-locks the user to prevent double-spend races.
async function reserveCredits(userId: string, action: string, refId?: string) {
  const price = await getPricing(action)            // from credit_pricing
  return db.transaction(async t => {
    const u = await t.selectForUpdate('users', userId)        // SELECT ... FOR UPDATE
    if (u.credits_balance < price.credits)
      throw new InsufficientCreditsError(price.credits, u.credits_balance)
    const balance_after = u.credits_balance - price.credits
    await t.update('users', userId, { credits_balance: balance_after })
    const tx = await t.insert('credit_transactions', {
      user_id: userId, action_type: action, delta: -price.credits,
      balance_after, status: 'reserved', reference_id: refId,
    })
    return { txId: tx.id, credits: price.credits }
  })
}

// On success: finalize + record real cost for margin tracking.
async function commitCredits(txId: string, metadata: object) {
  await db.update('credit_transactions', txId, { status: 'committed', metadata })
}

// On failure: give the credits back. NEVER charge for a failed generation.
async function refundCredits(txId: string) {
  await db.transaction(async t => {
    const tx = await t.selectForUpdate('credit_transactions', txId)
    if (tx.status !== 'reserved') return            // idempotent
    const u = await t.selectForUpdate('users', tx.user_id)
    const balance_after = u.credits_balance + (-tx.delta)
    await t.update('users', tx.user_id, { credits_balance: balance_after })
    await t.update('credit_transactions', txId, { status: 'refunded' })
    await t.insert('credit_transactions', {
      user_id: tx.user_id, action_type: 'refund', delta: -tx.delta,
      balance_after, status: 'committed', reference_id: txId,
    })
  })
}
```

**Monthly reset (no rollover):** lazy check on every credit op + nightly cron backstop.
```ts
if (user.credits_reset_at && now >= user.credits_reset_at) {
  const plan = await getPlan(user.plan_id)
  set credits_balance = plan.monthly_credits
  set credits_reset_at = now + 1 month
  log credit_transactions { action_type:'monthly_reset', delta: plan.monthly_credits, ... }
}
```

**Every AI endpoint follows:** `reserve → call model → commit(metadata)` / `catch → refund`.

---

## 4. Brand Profile + Product Catalog (Clone's required input)

Clone is only as good as its inputs. The user supplies brand assets + the **real product image**
(non-negotiable for usable ads).

```sql
create table brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  name text not null, website text,
  industry text[], description text, usps text[],
  target_audience text, tone text,           -- e.g. 'confident, scientific'
  preferred_words text[], avoid_words text[],
  created_at timestamptz default now()
);

create table brand_assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id) on delete cascade,
  type text not null,                        -- 'logo'|'color'|'font'|'product_image'
  value text,                                -- hex | font name | r2_url
  is_default boolean default false, meta jsonb
);

create table brand_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id) on delete cascade,
  name text, description text, price text,
  image_urls text[],                         -- REAL product photos (r2) — clone uses these
  created_at timestamptz default now()
);
```

---

## 5. Image Clone pipeline

**Inputs:** `reference_image_url` (ad to clone), `brand_id`, `product_id`, optional `copy` override.
**Output:** 4 on-brand variations featuring the user's REAL product in the reference's layout.

**Quality rule:** never let the model invent the product. Generate the *scene*; composite the *real*
product cutout; render text as a real layer. (Full AI regen = wrong product + gibberish text = unusable.)

```
1. reserveCredits(user, 'image_clone', jobId)
2. Reference analysis (vision → LayoutSpec JSON):
     { composition, palette[], format, style,
       text_zones:[{role:'headline'|'cta'|'badge', bbox, sample_text}],
       product_zone: bbox }
3. Product cutout: background-remove product image  (fal birefnet / rembg / local)  → cutout_url
4. Scene gen (provider, N=4): prompt = layoutSpec + brand palette/style,
     "generate background/scene matching this composition, leave product_zone empty"
5. Composite: place cutout into product_zone of each scene
6. Text layer: render headline/cta in BRAND font + exact copy onto text_zones (satori/sharp/canvas)
7. Upload variations → R2; insert clone_outputs
8. commitCredits(tx, {model, variations:4, actual_cost_usd})   // catch → refundCredits(tx)
```

**Provider adapter** (image models change fast — swap one class, not the pipeline; lets you A/B):
```ts
interface ImageGenProvider {
  generateScene(in: { layoutSpec: object, brandKit: object, n: number }): Promise<{ url: string }[]>
  editImage?(in: { baseUrl: string, maskUrl?: string, prompt: string }): Promise<{ url: string }>
}
class NanoBananaProvider implements ImageGenProvider {}   // PRIMARY (Gemini 2.5 Flash Image)
class FluxKontextProvider implements ImageGenProvider {}  // alternate (fal.ai) — inpaint/control
```
**Model choice:** primary = **Gemini 2.5 Flash Image ("Nano Banana")** — best at product-preserving
multi-reference editing (~$0.04/img). Alternate = **Flux Kontext [pro]** via fal.ai. Cutout ~$0.001.
A 4-variation clone ≈ $0.10–0.18 total → 15 credits = ~60–78% margin.

### 5a. Concrete APIs per step (which API + how)

| Step | Service | API / SDK | Env var |
|---|---|---|---|
| Reference analysis | OpenAI gpt-4o-mini **vision** (or Gemini Flash) | `chat.completions` w/ image + JSON mode | `OPENAI_API_KEY` |
| Background removal | **fal.ai BiRefNet** (or local `rembg` on droplet, free) | `fal.subscribe('fal-ai/birefnet')` | `FAL_KEY` |
| Scene generation | **Gemini 2.5 Flash Image (Nano Banana)** | `@google/genai` `generateContent` | `GEMINI_API_KEY` |
| Scene/edit (alt) | **Flux Kontext** | `fal.subscribe('fal-ai/flux-pro/kontext')` | `FAL_KEY` |
| Composite | **sharp** (local, no API) | — | — |
| Text layer | **satori + resvg** (local, no API) | — | — |

**Step 2 — reference analysis (vision → LayoutSpec JSON):**
```ts
const res = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  response_format: { type: 'json_schema', json_schema: LAYOUT_SPEC_SCHEMA },
  messages: [{ role: 'user', content: [
    { type: 'text', text: 'Extract the ad layout as JSON: composition, palette, format, style, text_zones[{role,bbox,sample_text}], product_zone bbox.' },
    { type: 'image_url', image_url: { url: referenceUrl, detail: 'low' } },  // low detail = cheap
  ]}],
})
```

**Step 3 — background removal (real product → transparent cutout):**
```ts
import { fal } from '@fal-ai/client'
fal.config({ credentials: process.env.FAL_KEY })
const cut = await fal.subscribe('fal-ai/birefnet', { input: { image_url: productImageUrl } })
const cutoutUrl = cut.data.image.url            // transparent PNG
```

**Step 4 — scene generation (Nano Banana, primary):**
```ts
import { GoogleGenAI } from '@google/genai'
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const out = await ai.models.generateContent({
  model: 'gemini-2.5-flash-image',
  contents: [
    { text: `Generate a photorealistic ad BACKGROUND matching this layout: ${JSON.stringify(layoutSpec)}.
             Brand palette ${brandKit.colors.join(',')}, style ${layoutSpec.style}.
             Leave the product_zone empty — no product. No text.` },
    { inlineData: { mimeType: 'image/png', data: referenceB64 } },   // reference = style guide
  ],
})
// out.candidates[0].content.parts → inlineData image → buffer → R2. Loop N=4 for variations.
```
*(Alt with Flux Kontext: `fal.subscribe('fal-ai/flux-pro/kontext', { input: { prompt, image_url: referenceUrl, num_images: 4 } })`.)*

**Step 5+6 — composite real product + text layer (local, deterministic, free):**
```ts
import sharp from 'sharp'
// text layer: render headline/cta in brand font via satori → SVG → PNG (resvg)
const final = await sharp(sceneBuffer)
  .composite([
    { input: productCutoutBuffer, top: spec.product_zone.y, left: spec.product_zone.x },
    { input: textLayerPng,        top: 0, left: 0 },
  ]).png().toBuffer()
// upload final → R2 → clone_outputs
```

**Why this split:** Nano Banana makes the *scene* (where it's strong); the **real product is composited
by sharp** (guaranteed fidelity, never hallucinated); **text is a real layer** (legible, exact copy/price,
on-brand font). This is what makes the output usable in a real ad. All behind the `ImageGenProvider`
adapter so you can A/B Nano Banana vs Flux Kontext on real ads and swap with one class.

> **Simpler one-call variant** (less fidelity, fine for non-detail products): Nano Banana accepts
> MULTIPLE input images — pass `[reference, productCutout]` and instruct it to place the product into
> the layout in one call. Easier, but it can drift product details, so prefer the composite split for
> detail-critical products (labels, packaging text).

### 5b. LayoutSpec — the contract tying the pipeline together

The vision step (5a step 2) RETURNS this; the scene-gen prompt and the compositor both CONSUME it.
All boxes are **normalized 0–1** (resolution-independent) → compositor multiplies by output W×H.

**TypeScript type:**
```ts
type BBox = { x: number; y: number; w: number; h: number }   // all 0..1, origin top-left

type TextZone = {
  role: 'headline' | 'subhead' | 'cta' | 'badge' | 'price' | 'disclaimer'
  bbox: BBox
  sample_text: string          // the REFERENCE's text — for context only; user copy overrides
  align: 'left' | 'center' | 'right'
  color_hint: string           // hex, e.g. '#FFFFFF'
  weight: 'regular' | 'medium' | 'bold' | 'extrabold'
  case: 'none' | 'upper'
}

type LayoutSpec = {
  aspect_ratio: '1:1' | '4:5' | '9:16' | '16:9'
  composition:
    | 'product-left-text-right' | 'product-right-text-left'
    | 'centered-product' | 'text-top-product-bottom'
    | 'full-bleed-lifestyle' | 'split' | 'grid'
  format:
    | 'promotion' | 'testimonial' | 'before-after' | 'feature-callout'
    | 'comparison' | 'announcement' | 'ugc' | 'lifestyle'
  style: string                // e.g. 'bright studio, minimal, soft shadows'
  palette: string[]            // hex colors pulled from the reference
  background: {
    type: 'solid' | 'gradient' | 'studio' | 'lifestyle-scene' | 'pattern'
    description: string        // feeds the scene-gen prompt verbatim
  }
  product_zone: BBox           // where the real product cutout gets composited
  text_zones: TextZone[]
}
```

**OpenAI structured-output schema (strict) for the vision call:**
```ts
const LAYOUT_SPEC_SCHEMA = {
  name: 'layout_spec',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['aspect_ratio','composition','format','style','palette','background','product_zone','text_zones'],
    properties: {
      aspect_ratio: { type: 'string', enum: ['1:1','4:5','9:16','16:9'] },
      composition: { type: 'string', enum: ['product-left-text-right','product-right-text-left','centered-product','text-top-product-bottom','full-bleed-lifestyle','split','grid'] },
      format: { type: 'string', enum: ['promotion','testimonial','before-after','feature-callout','comparison','announcement','ugc','lifestyle'] },
      style: { type: 'string' },
      palette: { type: 'array', items: { type: 'string' } },
      background: {
        type: 'object', additionalProperties: false, required: ['type','description'],
        properties: {
          type: { type: 'string', enum: ['solid','gradient','studio','lifestyle-scene','pattern'] },
          description: { type: 'string' },
        },
      },
      product_zone: {
        type: 'object', additionalProperties: false, required: ['x','y','w','h'],
        properties: { x:{type:'number'}, y:{type:'number'}, w:{type:'number'}, h:{type:'number'} },
      },
      text_zones: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['role','bbox','sample_text','align','color_hint','weight','case'],
          properties: {
            role: { type: 'string', enum: ['headline','subhead','cta','badge','price','disclaimer'] },
            bbox: { type: 'object', additionalProperties: false, required: ['x','y','w','h'],
                    properties: { x:{type:'number'}, y:{type:'number'}, w:{type:'number'}, h:{type:'number'} } },
            sample_text: { type: 'string' },
            align: { type: 'string', enum: ['left','center','right'] },
            color_hint: { type: 'string' },
            weight: { type: 'string', enum: ['regular','medium','bold','extrabold'] },
            case: { type: 'string', enum: ['none','upper'] },
          },
        },
      },
    },
  },
} as const
```

**Who consumes what:**
- **Scene gen (Nano Banana):** uses `aspect_ratio`, `composition`, `style`, `palette`, `background.description`
  → "generate this background, leave `product_zone` empty, no text."
- **Compositor (sharp):** `product_zone` × output dimensions → pixel box to place the cutout (fit/contain).
- **Text layer (satori):** for each `text_zone` → render `user copy ?? sample_text` in the BRAND font
  (`brand_assets type='font'`), colored by `color_hint` (or brand color), positioned by `bbox`, applying
  `align` / `weight` / `case`. Store `layout_spec` on `clone_jobs.layout_spec` so re-renders/edits are cheap
  (change copy → re-run text layer only, no new image-gen spend).

```sql
create table clone_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, brand_id uuid, product_id uuid,
  reference_image_url text, layout_spec jsonb,
  status text default 'processing',          -- processing|done|failed
  credit_tx_id uuid, created_at timestamptz default now()
);
create table clone_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references clone_jobs(id) on delete cascade,
  r2_url text, variation int, created_at timestamptz default now()
);
```

---

## 6. Scripts + Script Duplicate (Atria-style, behind credits)

**Transcribe** (`action='transcribe'`, 2 credits):
```
reserve → Whisper API (or local Whisper) on ad video_url → transcript [{t,text}]
        → auto-analyze (cheap LLM): framework (BAB/PAS/AIDA), hooks[], strategies[]
        → store ad_scripts → commit
```

**Script Duplicate** (`action='script_duplicate'`, 5 credits):
```
input: source_ad_id (must have ad_scripts), brand_id, product brief
reserve → LLM(prompt = source framework+beats + brand brief → new script, SAME structure, user's product)
        → store generated_scripts → commit
```

```sql
create table ad_scripts (
  ad_id text primary key,
  transcript jsonb,                -- [{t, text}]
  framework text, hooks text[], strategies text[],
  created_at timestamptz default now()
);
create table generated_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, source_ad_id text, brand_id uuid,
  framework text, script text, brief jsonb,
  credit_tx_id uuid, created_at timestamptz default now()
);
```

**Models:** transcription = Whisper (or local, free). Analysis + generation = gpt-4o-mini (cheap).

---

## 7. API endpoints

```
GET  /api/credits/balance                      -> { balance, plan, reset_at }
POST /api/scripts/transcribe   { adId }        -> reserve→whisper→analyze→commit
POST /api/scripts/duplicate    { sourceAdId, brandId, brief }
POST /api/clone                { referenceUrl, brandId, productId, copy? } -> { jobId }
GET  /api/clone/:jobId                          -> { status, outputs[] }
POST /api/billing/topup        { packId }       -> Stripe checkout
POST /api/admin/credit-pricing { action, credits, est_cost_usd }   -- tune margins, no deploy
GET  /api/admin/margins                         -> per-action: revenue vs actual_cost (verify 50–90%)
```

---

## 8. UI

- **Credit counter** top-right (balance); refetch after each action.
- **Pre-action confirm:** "This clone uses 15 credits. You have 240." → Confirm. (Show before every paid action.)
- **Low-balance banner** + Upgrade / Top-up CTA when balance < next action cost.
- **Clone result grid:** 4 variations → Download / Save to board / Edit / Regenerate (charges again).
- **Transaction history** (Settings → Billing): the ledger, human-readable.

---

## 9. Margin guardrails

- Log `actual_cost_usd` in every commit's metadata.
- Admin **/api/admin/margins**: per action, `revenue (credits×$0.03)` vs `sum(actual_cost)`.
- Alert if any action's realized margin drops below 50% (model price hike → bump credit cost in config).

---

## 10. Build order

```
1. Credit ledger + middleware (reserve/commit/refund) + credit_pricing config + admin editor
2. Credit UI (counter, pre-action confirm, low-balance)
3. Scripts: transcribe + analysis behind credits        ← cheapest, fastest, highest-value first
4. Script Duplicate behind credits
5. Brand Profile + Product Catalog + assets             ← Clone's input foundation
6. Image Clone pipeline behind credits (Nano Banana + cutout + text layer)
7. Margins dashboard
8. (LATER) Video clone — see below
```

---

## 11. Video clone (deferred — not now)

Do NOT pixel-clone video (unreliable, money pit). When ready, build as **structure + components +
assembly**, phased:
1. Script/structure clone (already covered by Scripts above) — 80% of value.
2. AI UGC avatar reading the cloned script (HeyGen/Arcads).
3. Product B-roll via **Seedance image-to-video** on the REAL product image (not text-to-video).
4. Assemble in **Silk** (scene-doc) — pacing + captions + music.
Credits: ~100–400 (cost $1–5+). Gate to top tier. Same reserve/commit/refund flow.
```
