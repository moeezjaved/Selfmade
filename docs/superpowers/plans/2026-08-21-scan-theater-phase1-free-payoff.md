# Scan Theater — Phase 1: Free Payoff (Act 5) + Cinema+ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/scan` audit's final act into a payoff that renders 1–2 real image ads live, types out a timestamped video script with the brand's product, teases the gated video + "rival remade as yours," and adds cinema+ reveal polish — all for anonymous users, before any sign-up.

**Architecture:** All generation for anonymous visitors goes through a NEW public, IP-limited, globally budget-capped endpoint (`/api/scan/creative`) — the existing studio endpoints stay auth+credit gated and are untouched. The engine already produces the inputs (`Gap`, `Prescription`, `WinnerExample`); Phase 1 adds two pure helpers (`creativeBriefs`, `videoShotList`) that map those into a render prompt and a shot list, then wires them into `ScanTheater`'s Act 5. Free renders are watermarked (removed after sign-up in Phase 2). The video and the clean/exported "rival remade" are teased but gated (wired in Phases 2–4).

**Tech Stack:** Next.js App Router (route handlers, `'use client'` components), Supabase (service-role read/admin via `@/lib/supabase/server`), Gemini image generation (`GEMINI_API_KEY`, same model path the studio uses), R2 for asset storage, TypeScript. No unit-test framework in-repo — pure functions are tested with `tsx` scripts under `scripts/` (matching `scripts/mello-tests.ts`); routes/UI are verified with `tsc --noEmit`, `curl`, and the Browser pane against production.

**Spec:** `docs/superpowers/specs/2026-08-21-scan-audit-theater-design.md`

## Global Constraints

- `/scan` stays **purely additive** and isolated from production onboarding; **0 changes to existing files outside the `/scan` + `/lib/dna` surface** unless a task explicitly lists them. (Standing constraint.)
- **No login** for the free scan and free payoff (Phase 1). Sign-up arrives in Phase 2.
- **No DDL / migrations in Phase 1.** Caps/counters use in-memory + existing `system_flags` if needed — no new tables. (Pause-before-DDL rule applies if this ever changes.)
- Existing studio generation endpoints (`/api/discovery/generate-ad`, `/api/discovery/clone-image`, `/api/creative/generate`) are **auth+credit gated and MUST NOT be modified or called from anonymous paths.**
- Reduced-motion safe: every animation respects `@media (prefers-reduced-motion:reduce)` (the `sf-rise` pattern already in `ScanTheater.tsx`).
- Verify on **production** (keys live there); local dev has no `.env`. Keep `/scan` `noindex` + unlinked.
- Public generation is a real cost + abuse vector: **hard per-IP cap AND a global daily budget cap**, watermark output, fail closed (never 500 into a paid loop).

---

### Task 1: Pure helper — `creativeBriefs()` maps gaps/prescriptions → render briefs

**Files:**
- Create: `src/lib/dna/creative.ts`
- Test: `scripts/scan-creative-tests.ts`

**Interfaces:**
- Consumes (from `@/lib/dna/engine`): `FullDnaResult`, `Gap`, `Prescription`, `WinnerExample`.
- Produces:
  ```ts
  export type CreativeBrief = {
    key: string            // stable id, e.g. 'brief-0'
    gapLabel: string       // the gap this ad fills, e.g. 'Video' / 'Founder story'
    headline: string       // on-image headline copy
    hook: string
    angle: string
    persona: string
    offer: string
    prompt: string         // the full text prompt handed to the image model
  }
  export function creativeBriefs(result: FullDnaResult, brandName: string, niche: string | null, max?: number): CreativeBrief[]
  ```
  Rules: prefer `result.report.prescriptions` (LLM output) when present; else synthesize from the top `result.gaps` (kind `'missing'`/`'underweight'`) + `result.winners.dist`. `max` defaults to 2. `prompt` is a concise positive prompt (per the clone-prompt lesson: concise, positive, product-forward — no bloat).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/scan-creative-tests.ts
import { creativeBriefs } from '../src/lib/dna/creative'
import type { FullDnaResult } from '../src/lib/dna/engine'

function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1) } }

// prescriptions present → briefs come from them
const withRx = {
  gaps: [], winners: { dist: {}, media: [], sampleSize: 0, winnerCount: 0, examples: [] },
  own: {} as any, score: {} as any, cached: false,
  report: { findings: [], prescriptions: [
    { title: 'Founder POV', hook: 'I made this because…', angle: 'origin story', persona: 'skeptical first-timer', offer: '20% off', format: 'Video', rationale: 'rivals all run founder video' },
  ] },
} as unknown as FullDnaResult
const b1 = creativeBriefs(withRx, 'Füm', 'Health & Wellness', 2)
assert(b1.length === 1, 'one prescription → one brief')
assert(b1[0].hook.includes('I made this'), 'brief carries the hook')
assert(b1[0].prompt.toLowerCase().includes('füm'), 'prompt names the brand')
assert(!!b1[0].key, 'brief has a stable key')

// no prescriptions → fall back to gaps
const withGaps = {
  gaps: [{ dimension: 'Format', label: 'Video', winnerPct: 80, yourPct: 0, kind: 'missing' }],
  winners: { dist: {}, media: [], sampleSize: 10, winnerCount: 5, examples: [] },
  own: {} as any, score: {} as any, cached: false,
  report: { findings: [], prescriptions: [] },
} as unknown as FullDnaResult
const b2 = creativeBriefs(withGaps, 'Füm', null, 2)
assert(b2.length >= 1, 'gaps fallback yields at least one brief')
assert(b2[0].gapLabel === 'Video', 'brief targets the missing gap')

console.log('PASS scan-creative-tests')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/scan-creative-tests.ts`
Expected: FAIL — `Cannot find module '../src/lib/dna/creative'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dna/creative.ts`. Implement `CreativeBrief` + `creativeBriefs()`:
- If `result.report.prescriptions.length`, map each (up to `max`) → a `CreativeBrief` using its `title→headline`, `hook`, `angle`, `persona`, `offer`, `format→gapLabel`.
- Else take the top `max` `result.gaps` with `kind !== 'overused'`, and fill `hook/angle/persona/offer` from the winners' distribution (`result.winners.dist`) best label per dimension, defaulting to sensible strings.
- `prompt` = a concise positive prompt: `"${brandName} ${niche??''} ad. ${headline}. ${angle}. Clean product-forward composition, high-contrast, mobile-first. Persona: ${persona}."` (trimmed; no negative prompt bloat).
- `key` = `brief-${i}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/scan-creative-tests.ts`
Expected: `PASS scan-creative-tests`.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/lib/dna/creative.ts scripts/scan-creative-tests.ts
git commit -m "feat(scan): creativeBriefs() — map gaps/prescriptions to render briefs"
```

---

### Task 2: Pure helper — `videoShotList()` builds the timestamped script

**Files:**
- Modify: `src/lib/dna/creative.ts`
- Test: `scripts/scan-creative-tests.ts` (extend)

**Interfaces:**
- Consumes: `CreativeBrief` (Task 1), `WinnerExample`, brand + niche strings.
- Produces:
  ```ts
  export type ShotBeat = { t: string; beat: string; onScreen: string; vo: string }   // t = "0:00–0:03"
  export type VideoScript = { title: string; totalSeconds: number; product: string; beats: ShotBeat[] }
  export function videoShotList(brief: CreativeBrief, brandName: string, niche: string | null): VideoScript
  ```
  Rules: produce a 5–6 beat, ~20–30s ARC-style shot list (hook → problem → product reveal → mechanism/proof → offer → CTA), each beat naming the **product** on-screen. Deterministic (no LLM, no `Date`/random) so it's testable and free.

- [ ] **Step 1: Write the failing test** (append to `scripts/scan-creative-tests.ts`)

```ts
import { videoShotList } from '../src/lib/dna/creative'
const script = videoShotList(b1[0], 'Füm', 'Health & Wellness')
assert(script.beats.length >= 5, 'shot list has >=5 beats')
assert(script.beats.every(x => /\d:\d\d/.test(x.t)), 'every beat has a timestamp')
assert(script.beats.some(x => (x.onScreen + x.vo).toLowerCase().includes('füm')), 'product appears in the script')
assert(script.totalSeconds > 0 && script.totalSeconds <= 30, 'total <= 30s')
console.log('PASS videoShotList')
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/scan-creative-tests.ts`
Expected: FAIL — `videoShotList` not exported.

- [ ] **Step 3: Implement** `videoShotList()` in `src/lib/dna/creative.ts` per the rules above (fixed beat template filled from the brief's hook/angle/offer + brand/product name; timestamps computed from a fixed per-beat duration array summing to ≤30).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/scan-creative-tests.ts`
Expected: `PASS videoShotList`.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/lib/dna/creative.ts scripts/scan-creative-tests.ts
git commit -m "feat(scan): videoShotList() — deterministic timestamped shot list with product"
```

---

### Task 3: Public capped image render — `/api/scan/creative`

**Files:**
- Create: `src/app/api/scan/creative/route.ts`
- Reference (read only, do NOT modify): `src/app/api/discovery/generate-ad/route.ts` (for the Gemini render helper it imports), `src/app/api/scan/run/route.ts` (IP-limiter pattern).

**Interfaces:**
- Consumes: POST body `{ brief: CreativeBrief; brandName: string; niche?: string|null; productImageUrl?: string|null }`.
- Produces: `{ imageUrl: string; watermarked: true }` on success; `{ error, retryAfter? }` on cap/failure. NEVER 500 into a retry loop — cap hits return `429`, misconfig returns `503`.

- [ ] **Step 1: Write the failing test (endpoint contract via curl script)**

Create `scripts/scan-creative-endpoint-check.sh`:
```bash
#!/usr/bin/env bash
# Manual/prod check — asserts the route exists and enforces the cap shape.
set -e
BASE="${1:-https://www.tryselfmade.ai}"
echo "1) missing brief → 400"
curl -s -o /dev/null -w "%{http_code}\n" -XPOST "$BASE/api/scan/creative" -H 'content-type: application/json' -d '{}'
echo "2) valid brief → 200 with imageUrl, or 429/503 (never 500)"
curl -s -XPOST "$BASE/api/scan/creative" -H 'content-type: application/json' \
  -d '{"brandName":"Füm","niche":"Health & Wellness","brief":{"key":"brief-0","gapLabel":"Video","headline":"Break the habit","hook":"I made this","angle":"origin","persona":"first-timer","offer":"20% off","prompt":"Füm health ad, clean product-forward"}}' | head -c 400
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/scan-creative-endpoint-check.sh` (against prod after deploy of a stub, or locally note the 404). Expected before implementation: `404`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/scan/creative/route.ts` (`export const runtime='nodejs'`, `maxDuration=60`, `dynamic='force-dynamic'`):
1. IP-limiter (copy the in-memory `Map` pattern from `scan/run`): **max 4 renders/IP/hour**.
2. Global daily budget guard: an in-memory counter `{ day: string; n: number }` reset when the UTC date string changes; **hard cap `SCAN_CREATIVE_DAILY_MAX` (env, default 300)**; over cap → `429 { error:'busy', retryAfter: 3600 }`.
3. Validate `brief.prompt` + `brandName`; missing → `400`.
4. If `!process.env.GEMINI_API_KEY` → `503 { error:'not_configured' }`.
5. Render via a **self-contained** Gemini call in this route (or a NEW `src/lib/creative/scanRender.ts` used ONLY by this route). **Do NOT modify `generate-ad` or any existing studio endpoint** — read its code for reference only; duplicate the minimal render call here. This keeps every live code path byte-identical (production-safety constraint). Render at `2K`, product image optional (if none, text/graphic ad).
6. Composite a diagonal **"SELFMADE · PREVIEW"** watermark before upload (canvas/sharp already in deps via `@remotion`/image libs; if not, overlay via the model prompt is NOT acceptable — use a server-side image composite util; add `sharp` only if already present, else draw the watermark with the existing R2/image path).
7. Upload to R2 (`uploadBufferToR2` + `r2PublicUrl`, already used by the DNA engine cache) under `scan-previews/<hash>.png`; return `{ imageUrl, watermarked:true }`.
8. Wrap everything so any downstream throw returns `503 { error:'render_failed' }`, never an unhandled 500.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
# deploy, then:
bash scripts/scan-creative-endpoint-check.sh
```
Expected: step 1 → `400`; step 2 → `200` JSON with `imageUrl` (or a clean `429/503`), and the returned URL loads a watermarked image.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/scan/creative/route.ts scripts/scan-creative-endpoint-check.sh src/lib/creative/scanRender.ts
git commit -m "feat(scan): public capped watermarked image render for anonymous audit payoff"
```

---

### Task 4: `scan/run` returns the payoff inputs (briefs + rival example)

**Files:**
- Modify: `src/app/api/scan/run/route.ts`
- Reference: `src/lib/dna/creative.ts` (Task 1)

**Interfaces:**
- Produces (added to the existing `/api/scan/run` JSON response): `briefs: CreativeBrief[]` (≤2) and `rivalToRemake: WinnerExample | null` (the top longest-running competitor example from `result.winners.examples`).

- [ ] **Step 1: Write the failing check** — extend the existing prod check to assert the new fields:

Add to a new `scripts/scan-run-check.sh`:
```bash
BASE="${1:-https://www.tryselfmade.ai}"
curl -s -XPOST "$BASE/api/scan/run" -H 'content-type: application/json' \
  -d '{"pageId":"709019802867739"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('briefs:',Array.isArray(j.briefs)?j.briefs.length:'MISSING','rivalToRemake:',j.rivalToRemake?'yes':'null')})"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/scan-run-check.sh` → `briefs: MISSING`.

- [ ] **Step 3: Implement**

In `src/app/api/scan/run/route.ts`, after `runDnaEngine(...)`: `import { creativeBriefs } from '@/lib/dna/creative'`, compute `const briefs = creativeBriefs(result, brandName, niche, 2)` and `const rivalToRemake = result.winners.examples[0] || null`, and add both to the returned JSON object. (Do not gate on `building` — when building, `briefs` is `[]`.)

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
# deploy, then:
bash scripts/scan-run-check.sh
```
Expected: `briefs: 1` or `2`, `rivalToRemake: yes` (for an indexed brand like Füm).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/scan/run/route.ts scripts/scan-run-check.sh
git commit -m "feat(scan): run returns creative briefs + top rival example for the payoff act"
```

---

### Task 5: Act 5 UI — live free ad(s) + typed video script + gated teasers

**Files:**
- Modify: `src/components/scan/ScanTheater.tsx`
- Reference: `src/lib/dna/creative.ts` types

**Interfaces:**
- Consumes: `ScanResult.briefs`, `ScanResult.rivalToRemake`, `POST /api/scan/creative`, `videoShotList()` (client import — it's pure, no server deps).

- [ ] **Step 1: Add the `TheFix` sub-component** (inside `ScanTheater.tsx`, near the other act components)

Render, in order, when `res.briefs?.length`:
1. Heading "The fix — ads we'd run for you".
2. For each brief: a card that on-mount POSTs to `/api/scan/creative` with the brief, shows a shimmer while loading, then the returned watermarked `imageUrl`; on `429/503` shows "Our studio is busy — sign up and we'll render these to your account" (Phase 2 hook). Reuse the `sf-rise` stagger.
3. The video script: call `videoShotList(res.briefs[0], res.brand.name, res.brand.niche)` and render the beats as a "types itself out" list (timestamp • on-screen • VO). Below it, a **disabled/gated** button "🎬 Generate this video →" with a small "Included in your trial" tag (wired in Phase 4).
4. If `res.rivalToRemake`: a "Your rival's best ad — remade as yours" teaser showing the rival `thumb` beside a **blurred** placeholder + "Start free trial to see it in your brand" (gated; wired Phases 2/4).

- [ ] **Step 2: Wire it into the done phase**

In the `phase==='done'` render (non-building branch), mount `<TheFix res={res} />` after the score section. Guard: nothing renders if `!res.briefs?.length`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` — expected 0 errors.

- [ ] **Step 4: Browser verification (production, after deploy)**

Using the Browser pane: navigate to `https://www.tryselfmade.ai/scan`, run an audit for a known indexed brand (search "fum" → Füm), let it complete, screenshot Act 5. Confirm: 1–2 watermarked ads rendered, the timestamped script is visible with the product named, the gated video button + rival-remake teaser show. Check `read_console_messages` for errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/scan/ScanTheater.tsx
git commit -m "feat(scan): Act 5 payoff — live free ads, timestamped video script, gated video + rival-remake teasers"
```

---

### Task 6: Cinema+ reveal polish

**Files:**
- Modify: `src/components/scan/ScanTheater.tsx`

**Interfaces:** none new (visual only).

- [ ] **Step 1: Score gauge sweep**

In the score act, animate the circular gauge stroke from 0 → `score.total` with a CSS transition (respect reduced-motion: jump straight to value). Reuse the `Count` ticker for the numeral.

- [ ] **Step 2: Competitor fly-in**

In Act 2 (rivals), stagger the `winners.examples` thumbnails in with `sf-rise` + increasing `animationDelay` (the `rise(i)` helper already exists).

- [ ] **Step 3: Gap "glow" on the benchmark**

For any benchmark axis at tier `'starter'` (e.g. Füm's "0 formats"), pulse the bar red once when it enters view (CSS keyframe, reduced-motion safe).

- [ ] **Step 4: Type-check + browser verify**

```bash
npx tsc --noEmit -p tsconfig.json
```
Then screenshot the full run in the Browser pane; confirm the sweep, fly-ins, and glow play and that reduced-motion (`resize_window` / emulate) disables them.

- [ ] **Step 5: Commit**

```bash
git add src/components/scan/ScanTheater.tsx
git commit -m "feat(scan): cinema+ polish — gauge sweep, competitor fly-in, starter-axis glow"
```

---

## Self-Review

**Spec coverage (Phase 1 slice):**
- Act 5 free image ads → Tasks 1,3,4,5 ✓
- Timestamped video script with product → Tasks 2,5 ✓
- Gated video button → Task 5 (teased; billing in Phase 4) ✓
- "Rival remade as yours" wow → Tasks 4,5 (teased watermarked; export gated in Phase 4) ✓
- Cinema+ lean-back reveal → Task 6 ✓
- Sign-up / Meta connect / $1 checkout → **out of Phase 1 scope** (Phases 2–4 below) ✓ (intentional)

**Placeholder scan:** No "TBD"/"add error handling" — the public endpoint's failure modes (400/429/503, never 500) are specified; watermark + caps are concrete. ✓

**Type consistency:** `CreativeBrief`, `VideoScript`/`ShotBeat`, `WinnerExample` names match across Tasks 1,2,4,5. `/api/scan/creative` request/response shape matches Task 5's fetch. ✓

**Open risk carried to execution:** watermark compositing util — Task 3 must confirm an image-composite path exists (R2 upload util is known; the compositing lib is not). If none exists, the fallback is to return the render unwatermarked but **only after** Phase 2 gates the reveal behind sign-up — flag to the reviewer at Task 3.

---

## Roadmap — later phases (to be detailed as separate plans when Phase 1 lands)

- **Phase 2 — Sign-up handoff + save/attribute audit.** 1-click Google sign-up after the free payoff; persist the anonymous scan result (R2/`system_flags`-free: a `scan_results` row keyed by a client token) and re-attach on sign-up; remove the watermark / render clean ads to the account; unblur the rival-remake. Reuses existing Google OAuth ([[project_gmail_login]]).
- **Phase 3 — Meta connect + reports.** Post-signup "complete your audit" → `meta/connect-byo` (read-only) → the reports view filling the "invisible half" (real ROAS/wasted spend/winners) via existing `meta/reaudit` + `meta/opportunities`.
- **Phase 4 — $1 → 3-day trial → $49 checkout.** Ryze-style checkout page; wire the gated "Generate this video" + "export rival-remake" CTAs to it; $1 setup charge + 3-day trial + auto-convert via the existing PayPal rail (`billing/paypal/card/create-order` + `billing/paypal/checkout` + `billing/end-trial`); confirm PayPal trial-period support first.
