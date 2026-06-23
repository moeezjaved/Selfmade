-- Atomic brand claim — prerequisite for running the crawler on MORE THAN ONE droplet.
--
-- Today the scheduler picks a brand with SELECT + an in-memory `inFlight` set. That set is
-- per-process, so two droplets can't see each other's picks and would crawl the same brand
-- twice (wasted IPs + time). This adds a DB-level claim so any number of droplets pull DISTINCT
-- brands with zero collision — the crawl equivalent of migration 030's atomic creative claim.
--
-- `crawling_at` = when a worker claimed the brand. claim_next_brand() picks the next due brand in
-- the SAME priority order the scheduler used (spied → never-crawled → oldest aged), stamps
-- crawling_at, and returns it — all atomically via FOR UPDATE SKIP LOCKED so concurrent callers
-- never get the same row. A claim older than the lease (default 30 min) is treated as stale (the
-- worker crashed mid-crawl) and becomes claimable again. The indexer clears crawling_at when it
-- finishes. Pure additive + a function → safe; still run with crawl paused per the standing rule.
alter table discovery_crawl_terms
  add column if not exists crawling_at timestamptz;

create index if not exists discovery_crawl_terms_claim_idx
  on discovery_crawl_terms (is_active, last_crawled_at) where page_id is not null;

create or replace function claim_next_brand(p_gap_min int, p_lease_min int default 30)
returns table(page_id text, term text)
language plpgsql
as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => p_gap_min);
  v_lease  timestamptz := now() - make_interval(mins => p_lease_min);
begin
  return query
  update discovery_crawl_terms t
     set crawling_at = now()
   where t.page_id = (
     select c.page_id
       from discovery_crawl_terms c
      where c.is_active = true
        and c.page_id is not null
        and (c.crawling_at is null or c.crawling_at < v_lease)          -- not actively claimed
        and (c.last_crawled_at is null or c.last_crawled_at <= v_cutoff) -- due to crawl
      order by
        (case when c.priority >= 9 and c.last_crawled_at is null then 0  -- just-spied jump the queue
              when c.last_crawled_at is null then 1                      -- never-crawled
              else 2 end),
        c.last_crawled_at asc nulls first                               -- oldest first within tier
      for update skip locked
      limit 1
   )
   returning t.page_id, t.term;
end;
$$;
