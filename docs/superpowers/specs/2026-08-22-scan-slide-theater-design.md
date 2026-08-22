# /scan Slide Theater (Ryze-style) — Design Spec

**Date:** 2026-08-22
**Status:** Approved direction (Moeez, repeatedly). Ready for implementation plan.
**Reference:** Ryze scanner — `https://reports.get-ryze.ai/scan/...`. Each step is ONE full-viewport visual that fills the window and SWAPS in place. The page NEVER scrolls. (Screenshots reviewed.)

## The problem (what's wrong today)

The running theater stacks a lot per act (verdict + big numbers + media bar + 12-ad grid + 7 DNA panels), so the pane is far taller than the viewport and **scrolls**. Moeez has said 4+ times: it must be like Ryze — **no scroll, each act fits one screen, big words + images, screen keeps changing.** Also: a brand we haven't crawled yet does NOT wait for its ads — it runs straight through showing empty own-data ("0 winners", "Pulling your ads now" then finishes).

## Requirements (non-negotiable)

1. **No page scroll, ever.** The whole theater is locked to the viewport. `document`/`body` do not scroll during the run.
2. **Each SLIDE fits 100vh** — content is sized/laid out to fit one screen, no internal scroll needed. A slide shows ONE big thing (a headline + one big visual), Ryze-style.
3. **Slides SWAP in place** and auto-advance with the scan pacing (~existing timing). The sidebar (steps + ticking findings) stays fixed on the left.
4. **Keep ALL the info** — don't strip the DNA panels. If an act has more than fits one screen, it **splits into multiple auto-advancing sub-slides** (e.g. "Reading your ads" → slide A: big numbers + media + ad grid; slide B: your creative-DNA panels laid out to fill the screen). Never a scrolling stack.
5. **Big words + images** — hero-scale type; visuals dominate.
6. **Wait for the crawl.** A not-yet-indexed brand must NOT show an empty audit. After kicking the priority crawl, POLL for the brand's ads (re-call /api/scan/run every ~15–20s, up to a ~3–4 min cap) behind a "Pulling your ads now…" slide; when they land, continue the real audit. On timeout, a clear "we're still pulling your ads — we'll email you / re-run" slide, not a fake "invisible/0".
7. **The REPORT (after the scan, on Unlock) is unchanged** — it's a normal scrollable page and Moeez approved it. Only the RUNNING theater becomes the no-scroll slide deck.

## Slide sequence (fills the viewport, one visual each)

Each entry = one full-screen slide; `[+]` = auto-advancing sub-slides within a step.

1. **Reading your ads** — `[+]` (a) big verdict + Total/Active/Video hero numbers + the ad-image grid filling the frame; (b) your creative-DNA panels (personas/angles/USPs/desires/emotions/themes/hooks) in a grid that fills one screen.
   - If not crawled: the **Pulling-your-ads** slide (poll/wait) instead, then this.
2. **Spying on rivals** — `[+]` (a) "Scanning your rivals" (named brands) + the rival ad grid filling the frame; (b) the rivals' DNA panels filling one screen.
3. **You vs winners** — the side-by-side, laid out to fit (paginate dimensions across sub-slides if needed so none scroll).
4. **Score** — the gauge + band, big, centered, one screen.

Then → the Scan-complete summary → Unlock → the (scrollable) report. Unchanged.

## How "fits one screen" is enforced

- The theater root is `height:100dvh; overflow:hidden`. The slide area is a fixed-height region; each slide is `height:100%; overflow:hidden` (NOT auto). Content is sized with clamps + grids so it fits; where a set is too big for one screen, it is chunked into sub-slides that auto-advance — NEVER made scrollable.
- Use `100dvh` (not `100vh`) so mobile browser chrome doesn't cause overflow.

## Constraints (standing)

- `/scan` only; additive; do not touch the report, billing, Meta, or the DNA engine.
- Verify on production (keys live there). Keep noindex + unlinked.
- Reduced-motion safe; mobile: slides still fit (stack big, no horizontal scroll).

## Open questions for the plan

- Exact per-sub-slide timing (must total ~the current ~90s, and each sub-slide long enough to read).
- Poll cadence + cap for the crawl-wait, and the timeout copy.
- How to chunk the 7 DNA panels into screen-fitting sub-slides (e.g. 4 + 3) and the VsPanels dimensions.
