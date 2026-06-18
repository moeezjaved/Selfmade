-- 024_discovery_search_perf.sql
-- Discovery search hit a scaling cliff at ~90K ads: the "has a working R2 creative"
-- filter (thumbnail_url/video_url LIKE '%r2.dev%') — applied on EVERY search — does
-- a sequential scan (~7s alone) and pushed total query time past Supabase's 8s
-- statement timeout → searches 500'd → "No ads found".
--
-- Two fixes, both instant DDL:

-- (1) Raise the backend statement timeout. The search runs as service_role; 8s is
--     too tight now. Run this ALONE (it commits — the earlier attempts rolled back
--     because they were batched with a slow SELECT).
alter role service_role set statement_timeout = '60s';

-- (2) Partial index so the R2-creative filter uses an index instead of a seq scan.
--     The predicate matches the query's filter exactly, so the planner can scan just
--     the (smaller) index of ads-with-creatives. No table rewrite.
create index if not exists idx_ads_has_r2_creative
  on discovery_ads_index (ad_id)
  where thumbnail_url like '%r2.dev%' or video_url like '%r2.dev%';

-- (3) Helps run-time/perf filters that previously had no index (days_running is now
--     recomputed + filtered on).
create index if not exists idx_ads_days_running on discovery_ads_index (days_running);
