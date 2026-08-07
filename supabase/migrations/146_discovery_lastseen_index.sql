-- 146: Recency index for the Discovery time filter (7d / 30d / …).
-- The time window should mean "ads seen in the last N days" (last_seen >= cutoff), but there was no
-- index for it, so filtering/ordering by last_seen hit the statement cap → empty results. The mig-130
-- composite only covers days_running, which isn't reliably populated. This partial index over the
-- has-creative feed serves BOTH `last_seen >= cutoff` (range) AND `ORDER BY last_seen DESC` as an
-- index-only scan → fast, correct recency.
--
-- ⚠️ Apply carefully on the ~1.4M-row discovery_ads_index:
--   • CONCURRENTLY = no table lock, but it's a heavy build — run it while crawl + drain are paused
--     (the pause-before-DDL rule), or during a quiet window.
--   • CREATE INDEX CONCURRENTLY cannot run inside a transaction block — run this statement on its own
--     in the Supabase SQL editor (not wrapped in BEGIN/COMMIT).

create index concurrently if not exists dai_hascre_lastseen
  on public.discovery_ads_index (last_seen desc, ad_id)
  where has_creative;
