-- The nightly rollup's new-ads scan keysets by (created_at, ad_id) — created_at is the migration-054
-- trigger column (stamped once on genuine INSERT, NULL for the pre-trigger backfill, never bumped on
-- re-crawl), so it's the clean "brand-new ad" watermark. The existing dai_created_at_idx leads with
-- page_id, so it can't serve a global `created_at > X ORDER BY created_at, ad_id` scan. This partial
-- composite does, and it's tiny (only the post-trigger rows are non-null).
--
-- Apply CONCURRENTLY (no write lock, runs alongside live crawl). Each statement auto-commits under
-- psql -f, so CONCURRENTLY is fine here.
create index concurrently if not exists dai_created_at_only_idx
  on discovery_ads_index (created_at, ad_id) where created_at is not null;

-- The tier-crosser (nearGate) scan keysets by (start_date, ad_id) over active ads in a 10-day
-- start_date window. start_date is day-granularity so many rows share a value — the plain
-- (start_date) where is_active index would still heap-sort the ad_id tiebreak. This composite
-- serves the keyset as a pure index range scan.
create index concurrently if not exists dai_active_start_ad_idx
  on discovery_ads_index (start_date, ad_id) where is_active;
