# Brand Auto-Discovery — Full Build Spec

Goal: grow 1,842 → 15K+ legit brands automatically (the gate to 5M ads), with **zero spam** and
**zero duplicates**. Admin-managed. Modeled on how Atria/GetHookd actually do it.

---

## How Atria / GetHookd do it (the inspiration)

Neither hand-maintains brand lists at their scale. They grow the library three ways:
1. **Category/keyword seeding** — they seed by *niche* (skincare, supplements, gymwear…) and pull every
   advertiser that shows up for those searches in the public Ad Library. This is the engine.
2. **Crowdsourcing** — Chrome extension + a "Brand Request" / "Add by URL" box (paste a FB Ad Library URL).
   Atria's brand-request modal and GetHookd's "Spied brands" are exactly this. You already have "Add by URL".
3. **Quality curation** — they don't show random dropshippers. Their libraries are *curated to real brands*
   (multiple active ads, real stores). The curation is the product — it's why their feeds look premium.

We replicate all three, with the curation (quality gate) as the centerpiece so we never get the spam
problem from last time.

---

## The loop (self-feeding)

```
seed niches/keywords
   → SEARCH the Ad Library by term  (NEW crawler mode)
   → harvest advertiser page_id from each result ad  (STRUCTURED field, never regex)
   → DEDUPE against everything we already have / already rejected
   → PROBE each new candidate (shallow crawl: ad count, runtime, sample, domain)
   → SCORE it (quality gate — legit vs spam)
   → auto-APPROVE high-confidence | queue the rest for 1-click review | auto-REJECT junk
   → approved → added to crawl set → full crawl
   → the approved brand's classified topics generate NEW keywords → back to top
```

Every crawled brand makes the next discovery round smarter. That's the compounding 1,842 → 15K.

---

## 1. Correct page_id extraction (fixes "wrong IDs last time")

**Never regex numbers out of URLs/text** — that's how you grabbed `ad_archive_id`/image hashes before.
Every ad node in the Ad Library GraphQL response has an explicit advertiser **`page_id`** + `page_name`
field. The keyword-search crawl returns many ads; take `page_id` from each ad's structured field. That id
is Meta's own "who ran this ad" — guaranteed correct.

Secondary (affiliate path): an ad's **landing-URL domain** can reveal a brand the page_id doesn't (affiliate
promoting brand Y). Extract the domain → resolve to a page_id via an Ad Library name/domain search → that
resolved page_id (structured) becomes a candidate. This is your existing affiliate-discovery infra as a feeder.

---

## 2. Dedupe (fixes "don't duplicate brands already in system")

A candidate is added ONLY if it passes ALL dedupe checks. Normalize names with accent-fold + lowercase +
strip-punctuation (the same `norm()` used for the seed lists).

```
reject as duplicate if ANY:
  • page_id ∈ discovery_crawl_terms.page_id           (already in crawl set)
  • page_id ∈ discovery_brand_candidates.page_id      (already a candidate, any status)
  • norm(name) ∈ existing brand names                 (name match)
  • domain(website) ∈ existing brand domains          (same store, different name)
  • page_id ∈ rejected memory                         (known spam — never re-evaluate)
```

The **rejected memory** matters: once a page is rejected (spam/off-niche), store it so every future
discovery round skips it instantly — you never re-probe the same junk.

---

## 3. The Quality Gate (fixes "spammy brands last time") — the centerpiece

Each new candidate gets a cheap **PROBE** (shallow crawl: first page of its ads + page metadata), then a
score. **Hard gates first (instant reject), then a score for approve-vs-review.**

### Hard reject gates (fail any → reject, remember it)
- `ads_count < 3` — one-off advertisers / pure spam.
- `max_days_running < 7` — nothing has run long enough to be real.
- No resolvable website, OR domain is a link-shortener / known-spam TLD.
- Niche classification ∈ blocklist: **political, gambling, adult, crypto/forex, MLM, payday-loan,
  local-services** (plumber/dentist/realtor), drop-ship-gibberish names.
- Country/language outside target set.

### Quality score (0–1) for survivors
```
ads_score   = min(1, log1p(ads_count)/log1p(50))      // 50 ads = max
longevity   = min(1, max_days_running/90)              // 90-day ad = max (proven)
domain_q    = 1.0 if real store (Shopify/known platform) else 0.6 if resolves else 0
niche_fit   = 1.0 if classifies cleanly into a target vertical else 0.4
trust       = verified ? 0.2 : (followers>50k ? 0.15 : followers>5k ? 0.08 : 0)

score = 0.30*ads_score + 0.30*longevity + 0.20*domain_q + 0.20*niche_fit + trust   // cap 1.0
```

### Decision
```
score ≥ 0.70  AND a strong signal (verified | followers>20k | ads_count>20 | a 60+ day ad)
        → AUTO-APPROVE → add to crawl set
0.45 ≤ score < 0.70  → REVIEW QUEUE (1-click human yes/no)
score < 0.45  OR failed a hard gate  → AUTO-REJECT (remember page_id)
```

Tune thresholds against what lands — start conservative (more review, less auto-approve) so the first
batches are hand-verified, then raise auto-approve as you trust the score. This is the discipline that
keeps you at Atria-quality instead of dropshipper-soup.

---

## 4. Schema

```sql
-- Discovery seeds = the search terms that find new brands
create table discovery_seeds (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,           -- 'vitamin c serum', 'gym wear', ...
  niche text,                          -- target vertical this seed maps to
  country text default 'US',
  is_active boolean default true,
  brands_found int default 0,          -- how many approved brands this seed produced
  last_run_at timestamptz,
  source text default 'manual'         -- 'manual' | 'auto' (generated from crawled topics)
);

-- Candidate brands awaiting gate/review
create table discovery_brand_candidates (
  page_id text primary key,            -- STRUCTURED field, never regex
  page_name text, website text, domain text,
  ads_count int, active_ads int, max_days_running int,
  niche text, verified boolean, followers int,
  quality_score numeric,
  status text default 'pending',       -- pending|approved|rejected|crawling|review
  reject_reason text,                  -- 'low_ads'|'off_niche'|'no_domain'|'blocklist'|'dup'
  source_seed text,                    -- which term/affiliate found it
  discovered_at timestamptz default now(),
  decided_at timestamptz
);
create index on discovery_brand_candidates (status, quality_score desc);

-- Permanent rejected memory (so spam is never re-evaluated)
create table discovery_rejected (
  page_id text primary key,
  reason text, rejected_at timestamptz default now()
);
```

---

## 5. The crawler additions (small — reuses existing infra)

1. **Keyword-search mode** — `crawlSearch(term)`: same as `crawlBrand` but navigates the Ad Library
   *search-by-keyword* URL instead of a page_id, and instead of storing ads, **harvests distinct
   `page_id`s** from result ads → candidates. (The in-context GraphQL pagination you already built works
   the same way for search results.)
2. **Probe mode** — `probeBrand(page_id)`: shallow crawl (first page only) → `ads_count`, `active_ads`,
   `max_days_running`, a sample ad for niche classification, page metadata (verified/followers/website).
   Cheap — one request, no full pagination. Runs BEFORE any full crawl, so you never full-crawl spam.

Both run through the same parallel scheduler + IPRoyal rotating sessions as the main crawl.

---

## 6. Admin UI — new "Discovery" section (under Brands / Ad Indexer)

Four panels:

**A. Seeds** — manage the search terms.
- Table: term · niche · country · is_active · brands_found · last_run. Add/edit/toggle. "Run now" per seed.
- Bulk-add seeds (paste keywords). Auto-generated seeds (from crawled topics) flagged `source=auto`.

**B. Candidate Review Queue** — the curation surface (this is where you keep it Atria-clean).
- Cards/rows sorted by `quality_score desc`, status=review. Each shows: logo, name, domain (clickable),
  ads_count, max_days_running, niche, verified/followers, score, source seed, **a 3-ad thumbnail preview**.
- **Approve / Reject** buttons (+ bulk select). Reject writes to `discovery_rejected`.
- Filter by niche / score / source.

**C. Stats** — discovered today/total, auto-approved, in-review, rejected, **dedupe-skipped count**
(proves it's not re-adding existing brands), approve-rate, brands-added-per-day trend.

**D. Controls** — auto-approve threshold (slider), hard-gate thresholds (min ads / min days), niche
blocklist editor, discovery concurrency, global on/off. Honors the `crawl_paused` flag like other writers.

---

## 7. The compounding keyword loop (how it reaches 15K on its own)

After a brand is approved + crawled + classified, take its top **topics/niche tags** (from your existing
classifier) and **generate new seeds** from ones you haven't searched yet:
```
crawl "Gymshark" → classified topics: activewear, leggings, gym accessories, recovery
   → new seeds: "leggings", "gym accessories", "recovery wear"  (if not already seeds)
   → those searches surface NEW advertisers → more candidates → ...
```
Cap auto-seed generation (e.g. top 3 new topics per brand) so it expands steadily, not explosively. This
is the engine that takes you from a few hundred seed keywords to full niche coverage without you typing more.

---

## 8. Build order

```
1. Schema (seeds, candidates, rejected) + dedupe helper (norm + domain + all 5 checks)
2. probeBrand() shallow crawl → enrich a page_id with ads_count/runtime/niche/domain/verified
3. Quality gate (hard gates + score + decision) → writes candidate status
4. crawlSearch(term) keyword harvester → structured page_id → dedupe → probe → gate
5. Admin Discovery UI (Seeds, Review Queue, Stats, Controls)
6. Auto-approve → push approved into discovery_crawl_terms (the crawl set)
7. Compounding loop: approved+classified brand topics → auto-generate new seeds
8. Wire as a cron/worker under the crawl_paused flag; start conservative (review-heavy), then raise auto-approve
```

---

## Why this avoids both failures you hit
- **Wrong page_ids** → structured `page_id` field from search-result ads, never regex over text/URLs.
- **Spam brands** → probe + hard-gates (min ads, min runtime, real domain, niche-not-blocklisted) +
  score + review queue + permanent rejected memory. Nothing gets crawled until it clears the gate.
- **Duplicates** → 5-way dedupe (crawl set, candidates, name, domain, rejected memory) before anything is added.

## Why it reaches 5M
15K legit brands × ~430 ads/brand ≈ 6.5M ads. Keyword-search discovery + the compounding seed loop gets
you to 15K without manual lists — exactly how Atria/GetHookd grew, just curated by your quality gate.
