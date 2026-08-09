-- Speed up the per-competitor "winning ad" fetch used by the Creative Strategist ("What to make next")
-- and the brief's competitor playbook. For each spied competitor we run:
--     SELECT ... FROM discovery_ads_index WHERE page_id = $1 ORDER BY days_running DESC LIMIT 15
-- For a HIGH-VOLUME brand (gruns / vuori / thousands of ads) with only a plain page_id index, Postgres
-- reads every row for that page and SORTS it by days_running — seconds per brand, and with 7 competitors
-- under crawl/rollup write load the endpoint blew past its function cap (504 → the card vanished; now it
-- times out gracefully to an empty card via a route-level budget). This composite makes the query an
-- index range scan (already ordered) — no per-page sort — so the strategist returns real ideas fast.
--
-- OPERATIONS:
--   • CREATE INDEX CONCURRENTLY cannot run inside a transaction — run this statement on its own
--     (Supabase SQL editor: paste just this line). It builds without locking writes.
--   • Standing rule: pause the crawl + drain first (schema churn under crawl load has 503'd the API).

create index concurrently if not exists dai_pageid_daysrunning
  on public.discovery_ads_index (page_id, days_running desc);
