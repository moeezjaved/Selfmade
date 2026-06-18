# Worker Migration — Session Notes (2026-05-13 → 2026-05-14)

Two-day push to migrate from Meta Graph API path → public-web GraphQL
interception + per-ad URL extraction. Architecture works end-to-end but
hits a ceiling at ~20% success rate via DOM extraction. Next session's
priority: research GraphQL extraction (Option C) before adding carousel
interaction (Option B).

---

## What works (validated end-to-end)

| Component | Status | Evidence |
|---|---|---|
| `playwright-indexer.ts` | ✅ Production-ready | Hims: 30 ads found in 944 KB, 1 brand at a time |
| `proxy-chain.ts` (sticky session) | ✅ Verified | IPRoyal `USER:PASS_session-XXX` (modifier in PASSWORD field) |
| Stealth + per-ad fresh chromium | ✅ Verified | `test-per-ad-url.ts` extracts 32 imgs + 31 vids per ad |
| Per-ad URL pattern (`?id=AD_ID`) | ✅ Verified | DOM contains creative URLs without access_token |
| Download via `context.request.fetch()` | ✅ Verified | Carries proxy + cookies; 2/10 Hims ads succeeded |
| Migration `012_playwright_indexer.sql` | ✅ Applied | 4 tracking tables in Supabase |
| `WORKER_PAGE_ID` filter | ✅ Working | Scopes worker to single brand for testing |

## What's broken / suboptimal

| Issue | Impact | Where |
|---|---|---|
| ~80% of Hims ads return DOM with placeholder URLs only | 1087-byte placeholder downloads | `extract.ts` URL filter too permissive |
| Verbose "File too small" warnings flood logs | Noise, hides real signal | `r2.ts` fallback logs every placeholder |
| 78,770 ads in DB still have dead `render_ad` URLs (non-Hims) | Worker wastes bandwidth on these | One SQL `UPDATE` per active brand fixes it |
| Discovery UI shows 1,723 Hims but DB has 2,799 with 216 thumbnails | Inconsistency between counts | UI may live-fetch from Meta — investigate later |

---

## The core architectural insight (Moeez, 2026-05-14)

> "DOM → extract creatives" is the WRONG winning architecture.
> "GraphQL/XHR response → structured media data directly" is RIGHT.

The indexer already intercepts Meta's GraphQL responses to find ad_archive_ids.
Those same responses likely contain full creative URLs (images, videos, posters).
If true, we skip DOM extraction entirely — no per-ad page loads, no carousel
interaction, no 1087-byte placeholders.

**Question for tomorrow:** what does Meta's GraphQL listing response actually
contain per ad? See `crawler_raw_responses` table — every response is archived
24h. We can grep them for `fbcdn.net`, `hd_video_url`, `image_url`, etc.

---

## Tomorrow's plan

### Phase 1 — GraphQL field discovery (Option C research)

**Goal:** determine if listing-page GraphQL responses already contain creative
media URLs (images, videos, thumbnails). If yes, the entire per-ad URL
extraction path becomes unnecessary.

**How:**
1. Run indexer on Hims (or any brand): `npx tsx src/playwright-indexer.ts 355136938262536`
2. Query Supabase: `SELECT body_text FROM crawler_raw_responses ORDER BY captured_at DESC LIMIT 5;`
3. Search `body_text` for: `fbcdn.net`, `hd_video_url`, `sd_video_url`,
   `image_crops`, `ig_creative_image`, `original_image_url`, `resized_image_url`,
   `creative_id`
4. If matches found in 5+ ads → GraphQL extraction is viable
5. If not → proceed to Phase 2

**Time budget:** 2-3 hours. Bandwidth: ~5 MB.

**If GraphQL viable:** rewrite `playwright-indexer.ts` to extract creative
URLs alongside ad_ids in the same response. Worker becomes a download-only
job (no Playwright needed for extraction at all). Massive win.

### Phase 2 — DOM interaction (Option B) — only if Phase 1 fails

Add to `extract.ts`:
- Click carousel "next" arrows to load lazy slides
- Click video play button to trigger src attachment
- Hover over thumbnails to trigger preload
- Scroll the modal to trigger viewport-based loading

**Time budget:** 4-6 hours. Brittle — needs continuous tuning.

### Phase 3 — Cleanup (regardless of which path wins)

- Suppress `r2.ts` "File too small" log spam (it's the fallback path; in-browser fetch already filtered)
- Remove the bare-fetch fallback in `processAsset` entirely (it never works against Meta CDN)
- Stricter URL filter in `extract.ts isAdCreative`: require `_s\d{3,}x\d{3,}` (size > 100px) AND not in known-placeholder paths
- Bulk SQL: rewrite `snapshot_url` for active brands only (not all 78k)

---

## Files modified across this session

```
worker/src/extract.ts            — full rewrite: stealth + per-ad chromium + in-browser download
worker/src/proxy-chain.ts        — NEW: localhost proxy wrapping IPRoyal sticky sessions
worker/src/playwright-indexer.ts — NEW: production indexer with raw archive + dedup + anti-burn
worker/src/test-per-ad-url.ts    — NEW: validates per-ad URL extraction in isolation
worker/src/ads-library-test.ts   — NEW: full GraphQL interception MVP
worker/src/db.ts                 — added WORKER_PAGE_ID filter
worker/src/index.ts              — wires prefetched buffers from extract → upload
worker/src/inspect.ts            — switched off shared-browser singleton
worker/src/r2.ts                 — unchanged (but contains dead fallback path to remove)
supabase/migrations/012_playwright_indexer.sql — NEW: 4 tracking tables
worker/package.json              — added playwright-extra, puppeteer-extra-plugin-stealth, proxy-chain, undici, ws
```

## Key environment variables

- `WORKER_PAGE_ID=355136938262536` — scope worker to one brand (used for Hims tests)
- `WORKER_AD_TIMEOUT_MS=60000` — needed at scale (extract + download takes 15-20s with proxy)
- `WORKER_BATCH_SIZE=10`, `WORKER_CONCURRENCY=1` — safe testing defaults

## Key SQL queries (for tomorrow)

```sql
-- Check what GraphQL responses Meta sends us (Phase 1 starting point)
SELECT body_text FROM crawler_raw_responses
WHERE captured_at > NOW() - INTERVAL '6 hours'
ORDER BY captured_at DESC LIMIT 5;

-- Reset a brand for re-processing
UPDATE discovery_ads_index
SET creative_extraction_failed_at = NULL,
    creative_extraction_attempts  = 0,
    snapshot_url = 'https://www.facebook.com/ads/library/?id=' || ad_id
WHERE page_id = '<page_id>'
  AND thumbnail_url IS NULL
  AND snapshot_url LIKE '%render_ad%';

-- Active brand queue sizes
SELECT t.term, COUNT(*) FILTER (WHERE a.thumbnail_url IS NULL) AS to_process
FROM discovery_crawl_terms t
LEFT JOIN discovery_ads_index a ON a.page_id = t.page_id
WHERE t.is_active = true
GROUP BY t.term
ORDER BY to_process DESC;
```

## IPRoyal bandwidth state (2026-05-14 end of session)

- Started day at: ~9.6 GB remaining
- Ended day at: ~9.4 GB remaining (tests used ~200 MB total — well under budget)

---

## What NOT to do tomorrow (lessons learned)

1. **Don't drain Hims at 20% success rate.** Burns bandwidth + poisons proxy reputation. Fix architecture first.
2. **Don't run worker without `WORKER_PAGE_ID` until queue is cleaned.** Otherwise it grabs random non-Hims ads with dead `render_ad` URLs and wastes ~30s/ad timing out.
3. **Don't trust the "Live from Meta" UI count vs DB count.** They measure different things — needs separate investigation.
4. **Don't add features without validating with `test-per-ad-url.ts` first.** That script is the proof-of-concept; if a change breaks it, the change is wrong.
5. **Don't make changes to `extract.ts` without re-running typecheck.** TypeScript caught a real cross-file regression in `inspect.ts` mid-session.

---

## Honest summary

This session went deep on debugging — multiple iterations to isolate that the
shared chromium pattern, then the bare-IP download path, were the bugs.
Architecture is now sound and proven on isolated ads.

The 20% production success rate isn't a final number — it's the ceiling of
the current DOM-only extraction strategy. Moving to GraphQL extraction
(Phase 1 tomorrow) should change the picture entirely because Meta's
internal payloads are structured data, not HTML, and likely already
contain the creative URLs we're working hard to scrape from rendered DOM.

Next session: start with the SQL above, look at `body_text` of the most
recent indexer response, and see what's in there.
