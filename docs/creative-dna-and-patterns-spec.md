# Creative DNA + Pattern Detection + Winner Score

Three layers, all built on what already ships (classifier + rollup + performance tiers).

---

## 1. Creative DNA — richer per-ad labels

It's the SAME structured-output classification you already run — just MORE fields in the JSON.
Split by what's CHEAP (copy, add to the merged prompt now) vs what NEEDS VISION (deferred pass).

| DNA field | Source | Status |
|---|---|---|
| hook_type | copy | ✅ have |
| emotion | copy | ✅ have |
| persona | copy | ✅ have |
| **problem** (e.g. "hair thinning") | copy | ➕ add to prompt (cheap) |
| **mechanism** (e.g. "micro infusion") | copy | ➕ add to prompt (cheap) |
| **offer** (e.g. "starter kit") | copy | ➕ add to prompt (cheap) |
| **cta_style** (soft / hard) | copy (derive from `cta`) | ➕ add to prompt (cheap) |
| **format** (UGC / studio / animation) | **vision** | ⏳ vision pass |
| **visual_style** (e.g. "bathroom selfie") | **vision** | ⏳ vision pass |

So **4 new fields are ~free**: add `problem`, `mechanism`, `offer`, `cta_style` to the merged classifier
prompt and re-run the corpus (~$0.06 on gpt-4o-mini — reclassify is cheap now). `format` + `visual_style`
wait for the vision pass (OCR-first → cheap vision, per the create spec).

**Storage:** make the filterable DNA fields **columns** (consistent with the filter bar you just built),
not buried in jsonb — `problem`, `mechanism`, `offer`, `cta_style`, `format`, `visual_style`. Index them.
Optionally also keep a `creative_dna jsonb` mirror for the full object / future fields.

**What it unlocks:** the query *"UGC fear-based hooks for skincare that ran 45+ days"* is just MORE filters
on these columns:
```
format=ugc  &  emotion=fear  &  hook_type=...  &  niche=skincare  &  run_time>=45
```
Your filter architecture already handles this — every new DNA column is a new filter dimension for free.

---

## 2. Pattern Detection — "what repeats among winners" (the differentiator)

This is the wedge: **creative intelligence, not ad spying.** Instead of showing ads, show the *patterns*
shared by winners in a scope. It's the rollup pattern applied to DNA, filtered to winners.

### The computation
```
Scope: niche = 'hair growth'  (or brand, or any filter set)
Winners: performance_tier IN ('winning','optimized')
For each DNA dimension (hook_type, emotion, persona, problem, mechanism, offer,
                        cta_style, format, visual_style, video_length_bucket):
  GROUP BY value → count → % of winners in scope
Return top N values per dimension.
```

### Output (the "report")
```
Top winning patterns — Hair Growth (n=412 winners)
  Format       Female selfie UGC ............ 41%
  Hook         "I ignored this for years" ... 34%
  Visual       Bathroom mirror .............. 28%
  Emotion      Fear / urgency ............... 31%
  Problem      Thinning at the part ......... 26%
  Mechanism    Micro-infusion ............... 19%
  Length       45–60s ....................... 38%   (needs video_duration)
  CTA timing   appears ~28s ................. avg   (needs video timeline)
```

### Build it as a nightly rollup (so it's instant, not a 25M scan per request)
```sql
create table pattern_stats (
  scope_type text,        -- 'niche' | 'brand' | 'global'
  scope_value text,       -- 'Hair Growth' | page_id | 'all'
  dimension text,         -- 'hook_type','format','visual_style',...
  value text,
  winner_count int,
  winner_pct numeric,     -- share of winners in this scope
  primary key (scope_type, scope_value, dimension, value)
);
-- nightly: for each niche, count DNA values among tier IN (winning,optimized), write top N per dimension
```
Reads hit `pattern_stats` (tiny). Recompute nightly alongside the other rollups.

### Available now vs needs more data
- **Now** (copy DNA + tiers you have): hook_type, emotion, persona, problem, mechanism, offer, cta_style.
- **Needs vision pass:** format (UGC), visual_style.
- **Needs video processing:** video_length_bucket (crawler must capture `video_duration`), CTA timing
  (transcript timestamps — you have transcription planned in Scripts).

### Bonus: Pattern Detection IS marketing
A "Top winning patterns in [niche]" page = a **programmatic-SEO asset** AND a shareable report AND the
product feature, all from one rollup. This is the data-product flywheel from the GTM plan — build once,
use as feature + content + SEO.

---

## 3. The Winner Score — you already built the real one

Your **percentile-calibrated performance_score** IS the winner score. Honest truth: without spend/conversion
data (impossible from public libraries), **longevity is the ceiling signal** — an ad running 45+ days and
still active is the strongest "this works" proxy that exists. Don't chase a "perfect" score; it doesn't
exist from public data.

### Current (good) formula
```
raw = 0.45·log(days_running) + 0.30·creative_reuse + 0.25·brand_active_ads,  ×0.5 if inactive
score = percentile_rank(raw)        → tiers: winning/optimized/growing/scaling/testing
```

### The only *real* improvements (marginal, optional)
1. **EU impressions** (when you add EU transparency) — the one genuine reach signal; it's GetHookd's 4th
   factor. Add as a 4th weighted term. This is the highest-value score upgrade because it's *real* data.
2. **Engagement** (reactions/comments/shares) — if you can capture it, it's a real signal; add a small weight.
3. **Keep percentile calibration** — it's correct; don't revert to absolute.

### The honest steer
A better *score* gives marginal lift. The leverage is **Pattern Detection USING the winners** — it extracts
far more value from the same winner-identification than perfecting the number. So: ship Creative DNA →
Pattern Detection on top of the score you have. Add EU impressions to the score later, opportunistically.

---

## Build order
```
1. Add 4 copy DNA fields (problem, mechanism, offer, cta_style) to merged prompt → reclassify (~$0.06)
2. Store as columns + indexes → they become filter dimensions automatically
3. Pattern Detection rollup (pattern_stats) over copy DNA + existing tiers → the "winning patterns" report
4. Surface: a "Patterns" view per niche/brand + programmatic-SEO pages from the same data
5. LATER (vision pass): format + visual_style → richer DNA + richer patterns
6. LATER (EU): impressions → 4th winner-score signal
```
