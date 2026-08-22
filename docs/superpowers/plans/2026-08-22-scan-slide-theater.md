# /scan Slide Theater (Ryze-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the RUNNING `/scan` theater as a Ryze-style full-viewport slide deck — no page scroll, each slide fits one screen with no internal scroll, dense acts split into auto-advancing sub-slides (all info kept), and it WAITS for the crawl for not-yet-indexed brands.

**Architecture:** Today the running phase renders a `<StageAct>` in a tall, scrolling `<main>`. We replace that with a **slide deck**: `run()` builds an ordered `Slide[]` from the data, a `slideIdx` state advances on a timer, and the main pane renders exactly ONE slide at a time inside a fixed 100dvh frame with `overflow:hidden`. Dense content (DNA panels) is chunked into multiple slides so nothing ever needs to scroll. The idle screen, the sidebar, the Scan-complete summary, and the (scrollable) report are unchanged.

**Tech Stack:** Next.js client component, React, TypeScript, inline styles. No unit-test framework — verification is `tsc --noEmit` + Browser-pane JS assertions (the "no scroll" invariant is objectively checkable).

**Spec:** `docs/superpowers/specs/2026-08-22-scan-slide-theater-design.md`

## Global Constraints

- **No page scroll during the run:** `document.documentElement.scrollHeight <= window.innerHeight` must hold while `phase==='running'`. Root uses `height:100dvh; overflow:hidden`.
- **Each slide fits one screen:** the slide frame is `height:100%; overflow:hidden` (NOT auto). Content sized with `clamp()` + grids; overflowing sets are split into sub-slides, NEVER made scrollable.
- **Keep ALL info** — don't strip DNA panels; chunk them across sub-slides.
- **Wait for the crawl:** not-yet-indexed brand → poll `/api/scan/run` (~18s cadence, ~4 min cap) behind a "Pulling your ads…" slide; continue when ads land; clear timeout copy otherwise. Never show a fake "invisible/0".
- **Only `src/components/scan/ScanTheater.tsx`** changes. Idle, summary, report, engine, billing untouched. Verify on production.
- Use `100dvh` not `100vh`. Reduced-motion safe.

---

### Task 1: The `<SlideFrame>` primitive + prove the page can't scroll

**Files:** Modify `src/components/scan/ScanTheater.tsx`

**Interfaces:**
- Produces: `function SlideFrame({ children }: { children: React.ReactNode }): JSX.Element` — a `height:100%; overflow:hidden; display:flex; flex-direction:column; justify-content:center` container. And the running-phase layout root switches to `height:100dvh; overflow:hidden`.

- [ ] **Step 1: Add `SlideFrame`** near the other sub-components:

```tsx
function SlideFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="sf-rise" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Lock the running layout to the viewport.** The main-grid root is currently `height:'100vh', overflow:'hidden'` — change `100vh`→`100dvh`. Change `<main>` from `overflowY:'auto'` to `overflow:'hidden', display:'flex', flexDirection:'column', minHeight:0` and keep `ref={mainRef}`. (The report branch will re-enable scroll in Task 5.)

- [ ] **Step 3: Type-check.** `npx tsc --noEmit -p tsconfig.json` → 0 errors.

- [ ] **Step 4: Prove no page scroll (browser, after deploy).** In the Browser pane run a scan, then in console:
```js
document.documentElement.scrollHeight <= window.innerHeight + 2
```
Expected: `true` throughout the run.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(scan): SlideFrame primitive + lock running theater to 100dvh (no page scroll)"`

---

### Task 2: Slide model + deck state + one-slide-at-a-time render

**Files:** Modify `src/components/scan/ScanTheater.tsx`

**Interfaces:**
- Produces: `type Slide = { key: string; render: () => React.ReactNode }`, `const [slides, setSlides] = useState<Slide[]>([])`, `const [slideIdx, setSlideIdx] = useState(0)`. The running main renders `slides[slideIdx]?.render()` wrapped in `<SlideFrame>`.

- [ ] **Step 1: Add deck state** next to the other `useState`s: `const [slides, setSlides] = useState<Slide[]>([])` and `const [slideIdx, setSlideIdx] = useState(0)`. Reset both at the top of `run()` (`setSlides([]); setSlideIdx(0)`).

- [ ] **Step 2: Build slide-render helpers.** Add pure render helpers that return the EXISTING visuals, each sized to fit one screen (reuse current JSX from `StageAct`, but as separate slides — do NOT stack them):
  - `slideAdsStats(own)` → big Total/Active/Video numbers + `<MediaBar>` + a **capped** ad grid (`own.examples.slice(0,10)`) that fits.
  - `slideDna(dist, title)` → a `<DnaPanels>` grid but capped to **4 panels per slide** (chunk 7 → 4+3 via a `panelChunk` arg).
  - `slideRivalsList(winners)` → "Scanning your rivals" named brands + capped rival grid.
  - `slideVs(own, winners, chunk)` → `<VsPanels>` but **3 dimensions per slide** (chunk).
  - `slideScore(res)` → the score gauge (reuse `ScanSummary`'s gauge markup) big + centered.
  Keep each helper's content within ~one screen; rely on clamps.

- [ ] **Step 3: Sequence the deck inside `run()`.** Replace the current `note`/`verdictBeat`/`setStage` sequencing so that instead of one scrolling StageAct, it pushes slides and advances:
```tsx
const show = async (s: Slide, ms: number) => { setSlides((d) => [...d, s]); setSlideIdx((i) => (slides.length ? i : 0)); await sleep(0); setSlideIdx((i) => d_lastIndex()); await sleep(ms) }
```
Simpler deterministic approach — build the full `Slide[]` up front from `data`, then step the index on a timer:
```tsx
const deck: Slide[] = []
if (data.own.found) { deck.push({key:'ads', render:()=>slideAdsStats(data.own)}); deck.push({key:'ads-dna', render:()=>slideDna(data.own.dist,'Your creative DNA')}) }
else deck.push({ key:'pulling', render:()=>pullingSlide() })   // Task 4 refines this
deck.push({key:'rivals', render:()=>slideRivalsList(data.winners)})
deck.push({key:'rivals-dna', render:()=>slideDna(data.winners.dist,'Their winning DNA')})
deck.push({key:'vs-0', render:()=>slideVs(data.own.dist,data.winners.dist,0)})
deck.push({key:'vs-1', render:()=>slideVs(data.own.dist,data.winners.dist,1)})
deck.push({key:'score', render:()=>slideScore(data)})
setSlides(deck)
for (let i = 0; i < deck.length; i++) { setSlideIdx(i); /* keep the sidebar findings/verdict for this slide */ await sleep(PER_SLIDE_MS) }
```
Keep the existing sidebar `note(...)` findings + `verdictBeat` where they map to a slide (call them alongside `setSlideIdx`). `PER_SLIDE_MS ≈ 6000` so the whole deck ≈ 45–60s; tune so a first-time viewer can read each.

- [ ] **Step 4: Render one slide.** In the running main, replace `<StageAct .../>` with:
```tsx
{phase === 'running' && slides.length > 0 && <SlideFrame key={slides[slideIdx]?.key}>{slides[slideIdx]?.render()}</SlideFrame>}
{phase === 'running' && slides.length === 0 && <SlideFrame><h2 style={h2}>Reading your ads…</h2></SlideFrame>}
```
Keep the sticky verdict? No — the verdict becomes part of each slide's header now (bigger). Remove the separate sticky verdict block in the running main (fold its text into the slides).

- [ ] **Step 5: Type-check + commit.** `npx tsc --noEmit` → 0. `git commit -m "feat(scan): slide-deck theater — one full-screen slide at a time, swaps in place"`

---

### Task 3: Make every slide FIT one screen (chunking + clamps)

**Files:** Modify `src/components/scan/ScanTheater.tsx`

**Interfaces:** Consumes the slide helpers from Task 2.

- [ ] **Step 1: Chunk the DNA panels.** `slideDna(dist, title, chunk)` renders panels `chunk*4 .. chunk*4+4`. In the deck, push a second DNA slide when `>4` panels have data (e.g. `ads-dna-0`, `ads-dna-1`). Each slide's grid is `gridTemplateColumns: 'repeat(2, 1fr)'`, big chips, sized to fit.

- [ ] **Step 2: Chunk VsPanels.** `slideVs(own, winners, chunk)` renders 3 dimensions (`chunk*3 .. +3`). Two vs-slides cover the 7 dims (0,1). Big type.

- [ ] **Step 3: Cap grids.** Ad/rival grids show at most 10 tiles in a `repeat(auto-fill,minmax(120px,1fr))` grid that fits ~2 rows on a laptop screen. Bigger tiles, fewer of them.

- [ ] **Step 4: Verify fit (browser).** After deploy, run a scan; for each slide, in console during the run:
```js
const f = document.querySelector('main .sf-rise'); f && (f.scrollHeight <= f.clientHeight + 2)
```
Expected: `true` for every slide (no internal overflow). If any slide overflows, reduce its per-slide item count / font clamp until it fits, then re-verify.

- [ ] **Step 5: Commit** `git commit -m "feat(scan): chunk DNA + vs panels into screen-fitting sub-slides"`

---

### Task 4: Wait for the crawl (poll) for not-yet-indexed brands

**Files:** Modify `src/components/scan/ScanTheater.tsx`

**Interfaces:** Produces `pullingSlide()` render + a poll loop in `run()`.

- [ ] **Step 1: `pullingSlide()`** — a big centered slide: "⏳ Pulling your ads now" + "First time we've seen {brand} — crawling your full ad library. This takes a couple of minutes." + an animated progress hint. Fits one screen.

- [ ] **Step 2: Poll loop.** When the first `/api/scan/run` returns `!own.found && ownPending`, show `pullingSlide()` as the active slide and poll:
```tsx
let data2 = data
for (let t = 0; t < 13 && !data2.own.found; t++) {   // ~13 * 18s ≈ 4 min cap
  await sleep(18000)
  try { const r = await fetch('/api/scan/run', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(lastPayload.current) }); if (r.ok) data2 = await r.json() } catch {}
}
```
If `data2.own.found` → rebuild the deck with `data2` and run the normal sequence. If still not found after the cap → a `timeoutSlide()`: "Still pulling your ads — we'll have them shortly. Re-run in a few minutes, or connect Meta for the full picture." NEVER show "invisible/0".

- [ ] **Step 3: Keep the progress bar honest.** During polling, hold the creep at ~40–60% (don't finish), so it doesn't look done while waiting.

- [ ] **Step 4: Type-check + commit.** `git commit -m "feat(scan): wait for the crawl (poll) instead of showing an empty audit"`

---

### Task 5: Keep the report scrollable + final QA

**Files:** Modify `src/components/scan/ScanTheater.tsx`

- [ ] **Step 1: Report scroll.** The Scan-complete summary + `FullReport` (phase `done`) must still scroll normally (Moeez approved it). Since the root is now `height:100dvh; overflow:hidden`, give the `done` branch its own scroll: wrap the summary/report in a `style={{ height:'100dvh', overflowY:'auto' }}` container (only for `phase==='done'`), OR switch the root to `minHeight:100dvh; overflow:visible` when `phase==='done'`. Pick one; verify the report scrolls and the running theater does not.

- [ ] **Step 2: Full browser QA (after deploy).** Run a scan end-to-end in the Browser pane:
  - During running: `document.documentElement.scrollHeight <= innerHeight+2` is `true` at every slide.
  - Each slide fits (Task 3 assertion) and swaps (screenshot 3–4 slides).
  - A not-yet-indexed brand shows the pulling slide and waits (don't need to wait the full 4 min — confirm it polls and holds).
  - After Unlock: the report scrolls normally.
  - `read_console_messages` shows no errors.

- [ ] **Step 3: Commit** `git commit -m "feat(scan): report keeps its own scroll; running theater stays no-scroll"`

- [ ] **Step 4: Run /qa** on the /scan flow per the qa skill (visual + interaction), fix any regressions, re-verify.

---

## Self-Review

**Spec coverage:** no page scroll → Task 1 (+assertion); each slide fits → Tasks 1–3 (+assertion); swaps in place → Task 2; keep all info via sub-slides → Tasks 2–3; big words+images → Tasks 2–3 clamps; wait for crawl → Task 4; report unchanged/scrollable → Task 5. ✓

**Placeholder scan:** the `show()` sketch in Task 2 Step 3 is explicitly superseded by the deterministic deck-then-step approach in the same step (use that one). No TBDs elsewhere.

**Type consistency:** `Slide = { key, render }`, `slides`/`slideIdx`, `slideAdsStats`/`slideDna`/`slideRivalsList`/`slideVs`/`slideScore`/`pullingSlide`/`timeoutSlide` used consistently across tasks. `PER_SLIDE_MS` defined in Task 2.

**Note for the implementer:** this rebuild removes the running-phase reliance on `stage`/`<StageAct>` + the sticky verdict. `StageAct`, `DnaPanels`, `VsPanels`, `MediaBar` are REUSED by the slide helpers (call them, sized to fit) — don't delete them; the report may still use them. Keep the sidebar (steps + findings) exactly as-is.
