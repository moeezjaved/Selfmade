-- 089_spy_recrawl_and_follow.sql — make Brand Spy behave like users expect:
--   1. Spied brands RE-CRAWL every ~6h (not once) so their ad set stays fresh.
--   2. Spying a brand also FOLLOWS it, so the alert-worker sends "new ads" notifications.
--
-- (1) is a CREATE OR REPLACE of claim_next_brand — same signature, so PostgREST needs no schema
-- reload and it's safe to apply live (the scheduler picks up the new body on its next rpc call).
-- (2) is handled in the app (brand-spy POST upserts followed_brands); nothing to migrate there, but
-- we add a partial index so the alert-worker's per-follow "new ads since watermark" query stays fast.

-- ── 1. Spied brands refresh every ~6h ────────────────────────────────────────
-- New priority tiers (lower = sooner):
--   0  just-spied, first crawl        (priority>=9 AND last_crawled_at IS NULL)   — unchanged
--   1  never-crawled                  (last_crawled_at IS NULL)                    — unchanged
--   2  SPIED & due for 6h refresh     (priority>=9 AND last_crawled_at <= now-6h)  — NEW: tracked
--        brands jump ahead of the general population so they stay current + drive new-ad alerts
--   3  everything else, oldest first
-- The existing WHERE gate (last_crawled_at <= now-gap) still applies; a spied brand only reaches
-- tier 2 once it's >6h old, so it refreshes roughly every 6h rather than on every 45-min gap.
create or replace function claim_next_brand(p_gap_min int, p_lease_min int default 30)
returns table(page_id text, term text)
language plpgsql
as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => p_gap_min);
  v_lease  timestamptz := now() - make_interval(mins => p_lease_min);
  v_spy    timestamptz := now() - interval '6 hours';
begin
  return query
  update discovery_crawl_terms t
     set crawling_at = now()
   where t.page_id = (
     select c.page_id
       from discovery_crawl_terms c
      where c.is_active = true
        and c.page_id is not null
        and (c.crawling_at is null or c.crawling_at < v_lease)
        and (c.last_crawled_at is null or c.last_crawled_at <= v_cutoff)
      order by
        (case when c.priority >= 9 and c.last_crawled_at is null then 0
              when c.last_crawled_at is null then 1
              when c.priority >= 9 and c.last_crawled_at <= v_spy then 2   -- NEW 6h spy refresh
              else 3 end),
        c.last_crawled_at asc nulls first
      for update skip locked
      limit 1
   )
   returning t.page_id, t.term;
end;
$$;

-- ── 2. Keep the alert-worker's per-follow query fast ─────────────────────────
-- Small table → instant. (We deliberately do NOT add a composite index on the 3.6M-row
-- discovery_ads_index here — a non-concurrent build would lock crawl writes; the existing page_id
-- index already serves the alert-worker's `page_id=eq.X & created_at>since` query fine.)
create index if not exists idx_followed_brands_pageid on followed_brands (page_id);

grant all on table public.followed_brands to anon, authenticated, service_role;
