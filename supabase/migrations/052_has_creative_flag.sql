-- has_creative: a pre-computed "this ad has at least one drained creative" flag that REPLACES the
-- discovery_creatives!inner JOIN in db-search. The inner join enforced "only show ads with a
-- creative" by scanning discovery_creatives for every keyword candidate. For a term whose (expanded)
-- match set is broad but mostly un-drained — e.g. "nike" — it scanned the whole set hunting for a
-- qualifying page and blew the 8s statement timeout (confirmed via timing logs: the keyword query ran
-- 8.2s then "canceling statement due to statement timeout"). An indexed boolean makes "has creative" an
-- INSTANT filter, so search is sub-second for every term, hits-or-misses alike.
--
-- PAUSE-BEFORE-DDL ([[project_pause_before_ddl]]): if crawl/drain is running heavy, pause it for the
-- ALTER — a schema reload under load has 503'd the API before. The column add is metadata-only
-- (instant on PG11+); the index is built CONCURRENTLY (non-locking); the trigger keeps the flag
-- current as new creatives land. Run the three steps as SEPARATE statements (CONCURRENTLY can't run
-- inside a transaction block).

-- 1. flag + partial index
alter table discovery_ads_index add column if not exists has_creative boolean not null default false;
create index concurrently if not exists dai_has_creative on discovery_ads_index (has_creative) where has_creative;

-- 2. one-time backfill from existing creatives (idempotent — safe to re-run; ~1-3 min on 2.36M rows)
update discovery_ads_index d set has_creative = true
  where has_creative = false and exists (select 1 from discovery_creatives c where c.ad_id = d.ad_id);

-- 3. keep it current: flip the flag when an ad's FIRST creative is inserted. Guarded by
--    `has_creative = false` so it writes at most once per ad — zero overhead on the ad's later creatives.
create or replace function dai_set_has_creative() returns trigger as $$
begin
  update discovery_ads_index set has_creative = true where ad_id = NEW.ad_id and has_creative = false;
  return NEW;
end; $$ language plpgsql;
drop trigger if exists trg_dai_has_creative on discovery_creatives;
create trigger trg_dai_has_creative after insert on discovery_creatives
  for each row execute function dai_set_has_creative();
