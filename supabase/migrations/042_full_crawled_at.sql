-- B (full-recrawl backfill) bookkeeping. discovery_crawl_terms.full_crawled_at records when a
-- brand last had a COMPLETE deep-archive crawl. NULL = never deep-crawled → the crawler runs it
-- in FULL mode (no 1500 cap, no early-stop) to recover the old archive we truncated, then stamps
-- this column so the brand reverts to fast incremental crawls. This rotates every brand through
-- one deep backfill over time. Pause the sweep any time with env FULL_BACKFILL=0 on the worker.
--
-- Nullable metadata-only add → instant, no table rewrite. Run with crawl+drain PAUSED per the
-- standing pause-before-DDL rule (the PostgREST schema reload is the only risk).
alter table discovery_crawl_terms
  add column if not exists full_crawled_at timestamptz;
