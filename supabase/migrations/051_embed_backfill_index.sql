-- Partial index for the embedding backfill (worker/src/embed-backfill.mjs). It repeatedly scans for
-- discovery_ads_index rows with embedding IS NULL ordered by ad_id; without this index that scan
-- gets slower as the backlog drains (it must skip already-embedded rows). The partial index keeps
-- each "next 200 unembedded" lookup fast, and rows drop out of the index as they get embedded, so it
-- shrinks to nothing as the backfill converges. Built CONCURRENTLY so it never locks the table while
-- the crawl / drain are writing.
create index concurrently if not exists dai_unembedded
  on discovery_ads_index (ad_id)
  where embedding is null;
