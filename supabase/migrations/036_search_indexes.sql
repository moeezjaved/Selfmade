-- Two indexes to fix discovery search hot-paths. Run with crawl+drain PAUSED
-- (these are plain CREATE INDEX — they briefly block writes during the build, and
-- on Supabase the DDL fires a PostgREST schema reload that 503'd the API under load
-- before). With load off, the build is fast and the reload is clean.

-- 1. Trigram index on page_name → fast substring autocomplete for the brand-search
--    dropdown. Today `ilike '%term%'` seq-scans the whole table ("Searching brands…").
create extension if not exists pg_trgm;
create index if not exists idx_ads_page_name_trgm
  on discovery_ads_index using gin (page_name gin_trgm_ops);

-- 2. GIN index on seed_terms (a text[]) → makes the affiliate-ads lookup
--    (`seed_terms @> '{aff:<pageId>}'`) fast, so brand mode can re-include affiliate
--    ads in ONE query (it was 9s+ unindexed → temporarily dropped from db-search).
create index if not exists idx_ads_seed_terms
  on discovery_ads_index using gin (seed_terms);
