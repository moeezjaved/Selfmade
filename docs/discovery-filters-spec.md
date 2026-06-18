# Discovery Filters Spec (GetHookd-parity, quick build)

Goal: match GetHookd's filter bar + Performance Score using data Self Made ALREADY has.
Everything here is buildable now except the two flagged DEFERRED (need landing-page / EU data).

---

## 1. Performance Score + Tiers (the headline feature)

GetHookd's own definition (from their modal): *"An internal heuristic that ranks ads from four
signals. NOT a measure of actual conversions. Grouped into five tiers."*

Their 4 signals → your data:
| GetHookd signal | Meaning | Self Made source |
|---|---|---|
| Runtime | how long actively running | ✅ `days_running` |
| Creative reuse | how much the creative is reused across the brand | ✅ count ads sharing `image_hash`/`video_hash` (same `page_id`) |
| Active-ad count | how many ads the brand runs now | ✅ count active ads per `page_id` |
| Meta impression rank | ad's rank by Meta impressions | ❌ needs EU transparency — **omit for v1**, add later |

You have **3 of the 4** — equivalent strength. Add impression rank later via EU data.

### Score formula (stored column, refreshed nightly in the rollup job)
```ts
runtime_n  = clamp(Math.log1p(days_running) / Math.log1p(180), 0, 1)   // 180d = max
reuse_n    = clamp(creative_reuse_count / 20, 0, 1)                    // 20 reuses = max
brandvol_n = clamp(brand_active_ads / 100, 0, 1)                       // 100 active = max
active_g   = is_active ? 1.0 : 0.5                                     // inactive penalty

performance_score = (0.45*runtime_n + 0.30*reuse_n + 0.25*brandvol_n) * active_g  // 0..1
```

### Five tiers (mirror GetHookd's names; cut-points are tunable vs the eval)
| Tier | Score | Meaning |
|---|---|---|
| **Winning** | ≥ 0.80 | exceptional, proven |
| **Optimized** | 0.60–0.79 | high-performing, well-tuned |
| **Growing** | 0.40–0.59 | strong potential |
| **Scaling** | 0.20–0.39 | promising, needs optimization |
| **Testing** | < 0.20 | early-stage |

### How to build it
- Add columns: `performance_score numeric`, `performance_tier text` on `discovery_ads_index`.
- Compute in the **nightly rollup job** (it already needs `creative_reuse_count` + `brand_active_ads`,
  which are the same aggregates the trend rollups use — share the pass).
- **Filter:** `?performance_scores=winning,optimized` → `performance_tier = ANY($1)`.
- **Sort:** `performance_score DESC`.
- Don't compute in-process — store it, so SQL filter/sort paginates correctly and counts are accurate.

---

## 2. Quick-build filters (existing columns)

Each row: filter → query param → backing data → SQL.

| Filter | Param | Source | SQL / logic |
|---|---|---|---|
| **Performance tier** | `performance_scores=winning,...` | `performance_tier` (new col) | `performance_tier = ANY(arr)` |
| **Limit ads per brand** | `ads_per_brand=1` | `page_id` | window: `row_number() over (partition by page_id) <= N`, or cap in result loop |
| **Run time** | `run_time=0-7,7-30,30-90,90+` | `days_running` | range buckets on `days_running` |
| **Brand active-ad count** | `active_ads_count=100` | `brand_active_ads` (rollup) | `brand_active_ads >= N` |
| **CTA Type** | `cta_type=shop_now,...` | `cta` (classifier) | `cta = ANY(arr)` |
| **Channels / placements** | `channels=facebook,instagram` | `platforms[]` | `platforms && arr` (overlaps) |
| **Start date** | `start_after=YYYY-MM-DD` | `start_date` | `start_date >= $1` |
| **Min ad copy length** | `min_copy_len=200` | `body` | `length(body) >= N` |
| **Creative usage / reuse** | `min_reuse=5` | `creative_reuse_count` (rollup) | `creative_reuse_count >= N` |
| **Hide brands** | `hide_brands=id1,id2` | `page_id` | `page_id <> ALL(arr)` |
| **Video length** | (have) | `video_duration` | existing |
| **Format / Status / Country / Language / Industry** | (have) | existing | existing |
| **Followed/Spied only** | `followed_only=1` | following table | join to user's follows |

---

## 2a. Niche filter (2-level taxonomy — coarse niche → granular industry)

GetHookd's "Niche" is COARSE (Beauty, Fashion, Health/Wellness, Pets, Sports). Your Industry filter is
GRANULAR (Skincare, Women's Clothing, Men's Shoes…). Offer BOTH levels — no new data, just a mapping
over your existing `industries[]`.

### Mapping: top niche → your granular industries
```
Beauty & Personal Care → Skincare, Haircare, Cosmetics, Men's Grooming,
                          Fragrances & Perfumes, Personal Hygiene, Oral Care, Beauty Tools & Accessories
Fashion & Apparel      → Women's Clothing, Men's Clothing, Women's Shoes, Men's Shoes,
                          Bags & Wallets, Jewelry, Watches, Eyewear, Accessories
Health & Wellness      → Health & Medical, Life Services
Sports & Outdoors      → Sportswear            (primary home for Sportswear — don't also count under Fashion)
Home & Kitchen         → Kitchen Appliances, Home Appliances, Home Improvement & Garden,
                          Heating Cooling & Air Quality, Small Appliances, Personal Care Appliances
Food & Beverage        → (food/bev subset of E-Commerce)
Pets                   → Pets
Baby, Kids & Maternity → Baby Clothing, Kids' Clothing, Maternity Clothing, Baby Food, Baby Formula,
                          Baby Feeding Supplies, Toys, Strollers & Cribs, Diapers & Wipes, Child Car Seats
Tech & Electronics     → Digital Devices, Wearable Tech Devices
Other                  → everything unmapped
```
(Sportswear overlaps Fashion ↔ Sports — assign it ONE primary niche so counts don't double.)

### Data + query
- Store a `niche` column on `discovery_ads_index` (map each ad's `industries[]` → top niche via the table
  above) OR keep it virtual: filter expands the coarse niche to its child industries (concept-expansion
  pattern — `industries && <children of chosen niche>`).
- Filter: `?niche=beauty,fashion` → if stored: `niche = ANY(arr)`; if virtual: expand to child industries.
- Keep the granular `industry` filter too — Niche = browse, Industry = precise.

### "TOP NICHES" ordering
Sort the dropdown by **ad count per niche** (most-populated first) so common niches surface — compute in
the nightly rollup: `niche_counts(niche, active_ads)`.

### UX (cheap polish that makes it feel like GetHookd's)
- Searchable dropdown (type to filter the list)
- Emoji per niche (💄 Beauty · 👗 Fashion · 🏋️ Health · 🐾 Pets · 🏠 Home · 🍫 Food · 📱 Tech · 🍼 Baby)
- Multi-select checkboxes
- "TOP NICHES" header, ordered by volume

---

## 3. Sort options (GetHookd's dropdown → your fields)

| Sort label | Param | SQL |
|---|---|---|
| Relevance | `sort=relevance` | search rank (existing) |
| Recommended | `sort=recommended` | `qualityScore` (existing) |
| **Performance** | `sort=performance` | `performance_score DESC` |
| Newest | `sort=newest` | `start_date DESC` |
| Oldest | `sort=oldest` | `start_date ASC` |
| Longest running | `sort=longest` | `days_running DESC` |
| Latest added | `sort=latest_added` | `first_seen DESC` * |
| Oldest added | `sort=oldest_added` | `first_seen ASC` * |
| Most used | `sort=most_used` | `creative_reuse_count DESC` |

\* needs a `first_seen` column (when YOU indexed it). If absent, add it (`default now()` on insert) —
also useful for "newly added" trends. Until then, fall back to `created_at`.

---

## 4. Preset chips (saved filter combos — pure UX, high polish)

Just shortcuts that apply a filter set. Copy GetHookd's:
| Chip | Applies |
|---|---|
| Best of the Month | `performance_scores=winning` + `start_after=<30d ago>` |
| VSL's | `format=video` + `video_length=long` (or a `vsl` flag if you classify it) |
| Brands with >100 active ads | `active_ads_count=100` |
| Beauty ads | `industry=Beauty & Personal Care` |

Plus **user-saved filters** (the ★): store a named filter JSON per user, list them next to the presets.

---

## 5. Rollup columns needed (compute nightly, shared with trend rollups)

These three aggregates power Performance + several filters/sorts — compute once per night:
```
creative_reuse_count  -- per ad: count of ads sharing its image_hash/video_hash within the same page_id
brand_active_ads      -- per brand: count of active ads (join back to each ad's row, or a brands table col)
performance_score / performance_tier  -- derived from the formula above
```
Add `first_seen timestamptz default now()` to `discovery_ads_index` for the "added" sorts/trends.

---

## 6. DEFERRED (need new data — build later, as you flagged)

| Filter | Needs |
|---|---|
| **Page Type** | landing-page capture (the LP tab) → classify page type |
| **Technology** | landing-page capture → detect stack (Shopify, etc.) |
| **EU transparency / Meta impression rank** | EU Ad Library source (real reach/spend ranges) — also completes the 4th Performance signal |

---

## Build order
```
1. Add columns: performance_score, performance_tier, first_seen, creative_reuse_count, brand_active_ads
2. Nightly rollup job computes the aggregates + score/tier (shares the trend-rollup pass)
3. Wire filters (all map to columns above) into the search route's query builder
4. Wire sort options
5. Preset chips + saved filters (UX)
6. LATER: Page Type / Technology (LP capture) + EU transparency (impression rank)
```
