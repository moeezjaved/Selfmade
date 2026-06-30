-- Rollup performance indexes — the nightly rollup was timing out (57014) at 2.57M ads.
--
-- The incremental rollup finds new ads via `indexed_at > lastRan` (worker/src/nightly-rollup.mjs)
-- and tier-crossers via `is_active AND start_date in [now-16d, now-6d]`. Neither column was indexed,
-- so the keyset walk heap-fetched every row to test the predicate → each page got slower → hit the
-- statement timeout (made far worse by a 5.6-day stale watermark pulling 200K+ ads at once).
--
-- Apply CONCURRENTLY (no write lock) — these run alongside the live crawl. Each statement must be its
-- own (CONCURRENTLY can't run in a txn block); psql -f auto-commits per statement, so this is fine.

-- Composite (indexed_at, ad_id) serves the rollup's new-ads keyset (ORDER BY indexed_at, ad_id) as a
-- pure index range scan. A plain (indexed_at) index isn't enough — the keyset orders by ad_id as the
-- tiebreaker, and the planner reverted to the ad_id PK + heap-checking indexed_at (the timeout).
create index concurrently if not exists dai_indexed_at_ad_idx
  on discovery_ads_index (indexed_at, ad_id);

create index concurrently if not exists dai_active_start_idx
  on discovery_ads_index (start_date) where is_active;
