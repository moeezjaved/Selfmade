-- Discovery time filter "last N days" = ads ACTIVE/seen in the last N days (last_seen >= cutoff),
-- ordered most-recent-first. This is the window that actually has data: start_date/days_running window
-- on LAUNCH date, but the freshest launches have no creative pulled yet and the has-creative feed hid
-- them (thousands counted, ~0 rendered). last_seen (bumped every crawl) selects currently-running ads,
-- which DO have creative — but there was NO index for it, so a 30d/90d window seq-scanned to a 20s
-- statement timeout ("Search hit a snag").
--
-- Mirror mig-130's lesson: a bare partial `(last_seen) WHERE has_creative` gets REFUSED by the planner
-- (it backward-scans the plain last_seen index with `Filter: has_creative`, mis-costing the wade because
-- has_creative isn't evenly spread). A LEADING-EQUALITY composite with has_creative first fixes it: for
-- has_creative = true the has_creative=true slice is already ordered last_seen DESC, ad_id ASC, so
--   WHERE has_creative AND last_seen >= cutoff ORDER BY last_seen DESC, ad_id ASC LIMIT 44
-- is a pure index range scan — no Filter, no Sort — fast for every window (7d/30d/90d/180d).
--
-- OPERATIONS:
--   • CREATE INDEX CONCURRENTLY cannot run inside a transaction block — run this statement on its own
--     (Supabase SQL editor: paste just this line). It builds without locking writes.
--   • Standing rule: pause the crawl + drain first (schema churn under crawl load has 503'd the API).
--   • last_seen updates on each crawl, but crawl is spy-only (a handful of brands), so index churn is
--     modest — the working recency filter is worth it.

create index concurrently if not exists dai_hascre_lastseen_active
  on public.discovery_ads_index (has_creative, last_seen desc, ad_id);
