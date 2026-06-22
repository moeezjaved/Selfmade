-- Discovery feed sort performance.
--
-- The serving query (api/discovery/db-search) ORDERs the has-creative set by these
-- columns. Without supporting indexes Postgres FULL-SORTS the whole set on every
-- load — measured on prod (754K ads):
--   • is_active-led "recommended" blend  → ~12s   (the default feed!)
--   • days_running.desc ('longest')      → ~4.4s
--   • performance_score.desc             → ~4.4s
--   • last_seen.desc ('recent')          → ~0.2s  (already indexed)
-- Leading a sort with the is_active BOOLEAN is the specific killer: a 2-value column
-- gives the planner no early cutoff, so it sorts the entire set. These indexes turn
-- each ORDER BY into an index-ordered scan (no sort node) → sub-second.
--
-- ⚠️ RUN WITH crawl+drain PAUSED (standing rule: DDL under write load once 503'd the
-- whole API for ~4min when PostgREST reloaded its schema cache mid-write).
--   • Supabase SQL editor: it wraps statements in a txn, so CONCURRENTLY is NOT allowed
--     there — pause writes first, then run each plain CREATE INDEX below ONE AT A TIME
--     (each builds in seconds once writes are paused; avoids the ~60s gateway timeout).
--   • Or, to build ONLINE without pausing: run via psql on a direct connection string
--     (Supabase → Settings → Database → Connection string) and add CONCURRENTLY to each.

-- Exact "recommended" blend → ORDER BY is_active DESC, days_running DESC NULLS LAST,
-- last_seen DESC, ad_id served straight from the index (lets the route restore the
-- full blend instead of the last_seen-only candidate pool it falls back to today).
create index if not exists discovery_ads_recommended_idx
  on discovery_ads_index (is_active desc, days_running desc nulls last, last_seen desc, ad_id);

-- 'longest' sort
create index if not exists discovery_ads_days_running_idx
  on discovery_ads_index (days_running desc nulls last, ad_id);

-- 'performance' sort
create index if not exists discovery_ads_perf_score_idx
  on discovery_ads_index (performance_score desc nulls last, ad_id);
