-- 146: "Launched in the last N days" index for the Discovery time filter (7d / 30d / …).
-- The time window means "ads that STARTED (launched) within the last N days" (start_date >= cutoff).
-- There was no index for start_date, so filtering/ordering by it hit the statement cap → empty. The
-- mig-130 composite only covers days_running (run duration, and not reliably populated). This partial
-- index over the has-creative feed serves BOTH `start_date >= cutoff` (range) AND `ORDER BY start_date
-- DESC` as an index-only scan → fast, correct "recently launched" semantics.
--
-- ⚠️ Apply carefully on the ~1.4M-row discovery_ads_index:
--   • CONCURRENTLY = no table lock, but it's a heavy build — run it while crawl + drain are paused
--     (the pause-before-DDL rule), or during a quiet window.
--   • CREATE INDEX CONCURRENTLY cannot run inside a transaction block — run this statement on its own
--     in the Supabase SQL editor (not wrapped in BEGIN/COMMIT).

create index concurrently if not exists dai_hascre_startdate
  on public.discovery_ads_index (start_date desc, ad_id)
  where has_creative;
