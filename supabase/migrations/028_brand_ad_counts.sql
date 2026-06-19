-- Per-brand ad count in ONE grouped query.
-- The admin Brands page used to run one query PER brand to count ads. At ~900
-- brands × ~0.6s that loop hit ~530s and 504'd the gateway. This is a single
-- HashAggregate group-by over discovery_ads_index — sub-second.
--
-- NOTE: an earlier version also computed mode(page_name) for the canonical brand
-- name, but that ordered-set aggregate sorts page_name per group and blew past
-- the 60s statement_timeout. The name comes from discovery_brand_crawl_state
-- (populated during crawls) / the crawl term instead — no per-group sort needed.
create or replace function brand_ad_counts()
returns table(page_id text, ad_count bigint)
language sql
stable
as $$
  select page_id, count(*) as ad_count
  from discovery_ads_index
  where page_id is not null
  group by page_id
$$;
