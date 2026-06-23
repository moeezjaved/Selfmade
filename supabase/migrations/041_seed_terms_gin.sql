-- GIN index on discovery_ads_index.seed_terms so the Brand Spy engine can pull a brand's
-- AFFILIATE ads — rows tagged `aff:<pageId>` by the crawler's affiliate-discovery pass — with
-- a `seed_terms @> ARRAY['aff:<pageId>']` lookup instead of a 1.4M-row sequential scan (which
-- timed out, the reason affiliate display was deferred).
--
-- CONCURRENTLY → no table lock, crawl/drain keep running while it builds (can take a few min on
-- 1.4M rows). It CANNOT run inside a transaction, so this migration must be the only statement
-- and be applied on its own. Still pause-before-DDL per the standing rule, but the CONCURRENTLY
-- build itself won't block writers.
create index concurrently if not exists discovery_ads_index_seed_terms_gin
  on discovery_ads_index using gin (seed_terms);
