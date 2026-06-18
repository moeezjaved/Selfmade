-- 021_rollup_optimize.sql
-- Fixes the discovery_rollup() timeout:
--   (a) raise service_role statement timeout so the REST/cron path isn't capped at 8s,
--   (b) rewrite the function SET-BASED — the v1 niche step ran 70K correlated
--       subqueries; replaced with a single join + array_agg. Plus `is distinct from`
--       guards so nightly re-runs only rewrite rows that actually changed (cheap).
-- Both statements below are instant DDL — paste together, they commit fine.

------------------------------------------------------------------------------
-- (a) Lift the REST statement timeout for the backend role (default ~8s).
--     Applied on SET ROLE per request → the rollup rpc/cron now gets headroom.
------------------------------------------------------------------------------
alter role service_role set statement_timeout = '300s';

------------------------------------------------------------------------------
-- (b) Optimized rollup
------------------------------------------------------------------------------
create or replace function discovery_rollup()
returns jsonb language plpgsql security definer as $$
declare
  n_reuse int; n_brand int; n_score int; n_niche int; n_other int; n_niches int;
begin
  -- 1. creative_reuse_count — reuse of each creative WITHIN its own brand.
  update discovery_ads_index a
  set creative_reuse_count = r.reuse
  from (
    select page_id, coalesce(image_hash, video_hash) as ckey, count(*) as reuse
    from discovery_ads_index
    where coalesce(image_hash, video_hash) is not null
    group by page_id, coalesce(image_hash, video_hash)
  ) r
  where a.page_id = r.page_id
    and coalesce(a.image_hash, a.video_hash) = r.ckey
    and a.creative_reuse_count is distinct from r.reuse;
  get diagnostics n_reuse = row_count;

  -- 2. brand_active_ads — # active ads per brand, stamped on every ad of the brand.
  update discovery_ads_index a
  set brand_active_ads = b.active_ads
  from (
    select page_id, count(*) filter (where is_active) as active_ads
    from discovery_ads_index
    group by page_id
  ) b
  where a.page_id = b.page_id
    and a.brand_active_ads is distinct from b.active_ads;
  get diagnostics n_brand = row_count;

  -- 3. performance_score = (0.45*runtime + 0.30*reuse + 0.25*brand_vol) * active_penalty.
  --    Compute set-based in a subquery, write only changed rows. Tier auto-derives.
  update discovery_ads_index a
  set performance_score = s.ns
  from (
    select ad_id,
      round(least(1.0, greatest(0.0,
        ( 0.45 * least(1.0, ln(1 + greatest(0, coalesce(days_running, 0))) / ln(181))
        + 0.30 * least(1.0, coalesce(creative_reuse_count, 0) / 20.0)
        + 0.25 * least(1.0, coalesce(brand_active_ads, 0) / 100.0) )
        * (case when is_active then 1.0 else 0.5 end)
      ))::numeric, 3) as ns
    from discovery_ads_index
  ) s
  where a.ad_id = s.ad_id
    and a.performance_score is distinct from s.ns;
  get diagnostics n_score = row_count;

  -- 4. niche — map industries[] → coarse niche (lowest priority wins). SET-BASED:
  --    join to the tiny niche_map, pick the best niche per ad via array_agg.
  update discovery_ads_index a
  set niche = b.niche
  from (
    select a2.ad_id, (array_agg(m.niche order by m.priority))[1] as niche
    from discovery_ads_index a2
    join niche_map m on m.industry = any(a2.industries)
    group by a2.ad_id
  ) b
  where a.ad_id = b.ad_id
    and a.niche is distinct from b.niche;
  get diagnostics n_niche = row_count;

  update discovery_ads_index set niche = 'Other' where niche is null;
  get diagnostics n_other = row_count;

  -- 5. niche_counts — rebuild (small aggregate table).
  delete from niche_counts;
  insert into niche_counts (niche, active_ads, total_ads, updated_at)
  select niche, count(*) filter (where is_active), count(*), now()
  from discovery_ads_index
  group by niche;
  get diagnostics n_niches = row_count;

  return jsonb_build_object(
    'ok', true, 'ran_at', now(),
    'reuse_rows', n_reuse, 'brand_rows', n_brand, 'score_rows', n_score,
    'niche_rows', n_niche, 'other_rows', n_other, 'niches', n_niches
  );
end; $$;

grant execute on function discovery_rollup() to service_role;
