-- 025_apply_perf.sql
-- Reliable rollup apply. Per-row REST upserts (even batched) kept hitting Supabase's
-- 8s statement timeout under crawler write-lock contention. This function applies a
-- whole chunk of precomputed scores in ONE set-based UPDATE...FROM jsonb — orders of
-- magnitude fewer round-trips and far faster, so each chunk lands well under the cap.
--
-- The caller (rollup) sends ~2000-row jsonb chunks: [{aid, ps, dr, rc, bv}, ...].
-- performance_tier is a generated column → recomputes from performance_score for free.

create or replace function apply_perf(p jsonb)
returns int language plpgsql security definer as $$
declare n int;
begin
  update discovery_ads_index a set
    performance_score    = (e.v->>'ps')::numeric,
    days_running         = (e.v->>'dr')::int,
    creative_reuse_count = (e.v->>'rc')::int,
    brand_active_ads     = (e.v->>'bv')::int
  from (select value as v from jsonb_array_elements(p)) e
  where a.ad_id = (e.v->>'aid');
  get diagnostics n = row_count;
  return n;
end; $$;

grant execute on function apply_perf(jsonb) to service_role;
