-- Per-brand ad count + canonical name in ONE grouped query.
-- The admin Brands page used to run one query PER brand to count ads and sample
-- the page_name. At ~900 brands × ~0.6s that loop hit ~530s and 504'd the gateway.
-- This replaces all of it: a single indexed group-by over discovery_ads_index.
--   ad_count   = exact count of ads for the page
--   brand_name = most common page_name (mode) — one Meta page runs ads under
--                several names (its own + partnership/affiliate), the real brand
--                name is the most frequent one.
create or replace function brand_ad_counts()
returns table(page_id text, ad_count bigint, brand_name text)
language sql
stable
as $$
  select
    page_id,
    count(*) as ad_count,
    mode() within group (order by page_name)
      filter (where page_name is not null and page_name <> '') as brand_name
  from discovery_ads_index
  where page_id is not null
  group by page_id
$$;
