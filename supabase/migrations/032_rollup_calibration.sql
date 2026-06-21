-- Incremental rollup support: cache the percentile-calibration cutpoints.
--
-- The nightly rollup's ONE global (cross-corpus) dependency is the percentile map:
-- score = mapP(pctOf(rawv)), where pctOf needs the whole corpus's rawv distribution.
-- Everything else (reuse, brand_active_ads, brand velocity) is BRAND-LOCAL, so it can
-- be recomputed per-touched-brand incrementally.
--
-- Strategy: the WEEKLY full run sorts all rawv and caches a compact quantile array
-- here ("cutpoints"). The NIGHTLY incremental run re-scores only touched ads (new +
-- tier-threshold crossers + changed brands) using these cached cutpoints — no
-- full-table sort/scan, no multi-hour write, no crawl-pause spike. Tiers stay anchored
-- to the last weekly calibration; the weekly full pass re-anchors them.
create table if not exists discovery_rollup_calibration (
  id         int primary key default 1,
  cutpoints  jsonb not null,     -- ascending rawv quantiles; pctOf(v) ≈ idx(v)/ (len-1)
  n          int,                -- corpus size at calibration time
  bp         jsonb,              -- the percentile→score breakpoints used (provenance)
  ran_at     timestamptz not null default now(),
  constraint discovery_rollup_calibration_single check (id = 1)
);
-- service_role (droplet REST) bypasses RLS; no policy needed.

-- apply_perf already updates score/days/reuse/brand_active. Add scored_at so the
-- rollup can also stamp WHEN an ad was last scored (useful for audits / future
-- "unscored" detection). Backfilled lazily as ads get re-scored.
alter table discovery_ads_index add column if not exists scored_at timestamptz;

-- Re-define apply_perf to also stamp scored_at=now(). Same set-based UPDATE..FROM
-- jsonb (one statement per ~2000-row chunk); performance_tier stays generated.
create or replace function apply_perf(p jsonb)
returns int language plpgsql security definer as $$
declare n int;
begin
  update discovery_ads_index a set
    performance_score    = (e.v->>'ps')::numeric,
    days_running         = (e.v->>'dr')::int,
    creative_reuse_count = (e.v->>'rc')::int,
    brand_active_ads     = (e.v->>'bv')::int,
    scored_at            = now()
  from (select value as v from jsonb_array_elements(p)) e
  where a.ad_id = (e.v->>'aid');
  get diagnostics n = row_count;
  return n;
end; $$;

grant execute on function apply_perf(jsonb) to service_role;
