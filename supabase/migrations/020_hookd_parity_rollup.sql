-- 020_hookd_parity_rollup.sql
-- GetHookd-parity discovery filters: Performance Score + tiers, niche, and the
-- precomputed aggregates the new filters/sorts read. Run once in the Supabase
-- SQL editor. The discovery_rollup() function is created here but CALLED NIGHTLY
-- (via a cron hitting an API route → supabase.rpc('discovery_rollup')) to keep
-- scores/niche/counts fresh as new ads crawl in.
--
-- Grounded in the real schema:
--   * first-seen  = existing `indexed_at`   (no new column)
--   * end-date    = existing `stop_date`    (no new column)
--   * NO video_duration column → "Video length" filter / VSL preset are deferred.
-- Trend rollups (brand_weekly_stats, niche×angle) are a later addendum — they
-- rebuild from start_date/stop_date each night, so deferring loses no history.

------------------------------------------------------------------------------
-- PART 1 — New columns on discovery_ads_index
------------------------------------------------------------------------------
alter table discovery_ads_index add column if not exists creative_reuse_count int default 0;
alter table discovery_ads_index add column if not exists brand_active_ads     int default 0;
alter table discovery_ads_index add column if not exists performance_score numeric(4,3) default 0;
alter table discovery_ads_index add column if not exists niche text;

-- Tier auto-derives from the score (generated STORED — recomputes on every row write,
-- so the nightly UPDATE of performance_score refreshes the tier for free).
alter table discovery_ads_index add column if not exists performance_tier text
  generated always as (
    case when performance_score >= 0.80 then 'winning'
         when performance_score >= 0.60 then 'optimized'
         when performance_score >= 0.40 then 'growing'
         when performance_score >= 0.20 then 'scaling'
         else 'testing' end
  ) stored;

------------------------------------------------------------------------------
-- PART 2 — Indexes for the new filter / sort paths
------------------------------------------------------------------------------
create index if not exists idx_ads_perf_tier  on discovery_ads_index (performance_tier);
create index if not exists idx_ads_perf_score on discovery_ads_index (performance_score desc);
create index if not exists idx_ads_niche      on discovery_ads_index (niche);
create index if not exists idx_ads_reuse      on discovery_ads_index (creative_reuse_count desc);
create index if not exists idx_ads_start      on discovery_ads_index (start_date);
create index if not exists idx_ads_indexed_at on discovery_ads_index (indexed_at desc);  -- "latest added" sort
create index if not exists idx_ads_brand_vol  on discovery_ads_index (brand_active_ads desc);

------------------------------------------------------------------------------
-- PART 3 — Niche taxonomy (coarse browse layer over the 17 real industries)
------------------------------------------------------------------------------
create table if not exists niche_map (
  industry text primary key,
  niche    text not null,
  priority int  not null default 50   -- lower wins when an ad has industries from >1 niche
);

insert into niche_map (industry, niche, priority) values
  ('Beauty & Personal Care',   'Beauty & Personal Care',   1),
  ('Health & Fitness',         'Health & Wellness',        2),
  ('Baby, Kids & Maternity',   'Baby, Kids & Maternity',   3),
  ('Pets',                     'Pets',                     4),
  ('Sports & Outdoors',        'Sports & Outdoors',        5),
  ('Electronics & Technology', 'Tech & Electronics',       6),
  ('Home & Garden',            'Home & Garden',            7),
  ('Food & Beverage',          'Food & Beverage',          8),
  ('Apparel & Accessories',    'Fashion & Apparel',        9),
  ('Jewelry & Watches',        'Fashion & Apparel',        9),
  -- non-DTC / catch-all verticals → Other (still filterable precisely via `industry`)
  ('E-Commerce',               'Other',                   90),
  ('Charity & NGO',            'Other',                   90),
  ('Education',                'Other',                   90),
  ('Finance & Insurance',      'Other',                   90),
  ('Real Estate',              'Other',                   90),
  ('Travel & Tourism',         'Other',                   90),
  ('Business Services',        'Other',                   90)
on conflict (industry) do update set niche = excluded.niche, priority = excluded.priority;

-- Powers the "TOP NICHES" dropdown ordering (most-populated first).
create table if not exists niche_counts (
  niche      text primary key,
  active_ads int,
  total_ads  int,
  updated_at timestamptz
);

------------------------------------------------------------------------------
-- PART 4 — discovery_rollup(): the nightly job (call via rpc)
-- Steps run in dependency order: 1 & 2 → 3 (reads them) ; 4 → 5 (reads it).
-- Idempotent: every step recomputes from source, safe to re-run anytime.
------------------------------------------------------------------------------
create or replace function discovery_rollup()
returns jsonb language plpgsql security definer as $$
declare
  n_reuse int; n_brand int; n_score int; n_niche int; n_niches int;
begin
  set local statement_timeout = '300s';

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
    and coalesce(a.image_hash, a.video_hash) = r.ckey;
  get diagnostics n_reuse = row_count;

  -- 2. brand_active_ads — # active ads per brand (stamped onto every ad of the brand).
  update discovery_ads_index a
  set brand_active_ads = b.active_ads
  from (
    select page_id, count(*) filter (where is_active) as active_ads
    from discovery_ads_index
    group by page_id
  ) b
  where a.page_id = b.page_id;
  get diagnostics n_brand = row_count;

  -- 3. performance_score = (0.45*runtime + 0.30*reuse + 0.25*brand_vol) * active_penalty.
  --    runtime: log scale, 180d = max ; reuse: 20 = max ; brand_vol: 100 active = max.
  --    Tier auto-derives from the generated column.
  update discovery_ads_index
  set performance_score = round(least(1.0, greatest(0.0,
        ( 0.45 * least(1.0, ln(1 + greatest(0, coalesce(days_running, 0))) / ln(181))
        + 0.30 * least(1.0, coalesce(creative_reuse_count, 0) / 20.0)
        + 0.25 * least(1.0, coalesce(brand_active_ads, 0) / 100.0) )
        * (case when is_active then 1.0 else 0.5 end)
      ))::numeric, 3);
  get diagnostics n_score = row_count;

  -- 4. niche — map industries[] → coarse niche (lowest priority wins), else 'Other'.
  update discovery_ads_index a
  set niche = coalesce((
    select m.niche from niche_map m
    where m.industry = any(a.industries)
    order by m.priority asc
    limit 1
  ), 'Other');
  get diagnostics n_niche = row_count;

  -- 5. niche_counts — rebuild (small aggregate table).
  delete from niche_counts;
  insert into niche_counts (niche, active_ads, total_ads, updated_at)
  select niche, count(*) filter (where is_active), count(*), now()
  from discovery_ads_index
  group by niche;
  get diagnostics n_niches = row_count;

  return jsonb_build_object(
    'ok', true, 'ran_at', now(),
    'reuse_rows', n_reuse, 'brand_rows', n_brand,
    'score_rows', n_score, 'niche_rows', n_niche, 'niches', n_niches
  );
end; $$;

grant execute on function discovery_rollup() to service_role;
