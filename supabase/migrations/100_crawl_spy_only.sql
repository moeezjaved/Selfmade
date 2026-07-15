-- 100_crawl_spy_only.sql — make the crawler SPY-ONLY by default.
--
-- Context (2026-07-15 launch): we do NOT want to bulk-crawl the ~51k discovery-population brands
-- (priority < 9) — that drains IPRoyal and buries the brands users actually care about. We DO want
-- to crawl spied/competitor brands (priority >= 9, set by Brand Spy + onboarding "add competitor")
-- so a user's tracked brands stay fresh and drive new-ad alerts.
--
-- The scheduler's only work-claim is claim_next_brand(). We gate it on a system_flags toggle:
--   • NO row 'crawl_discovery_enabled' (default)        → SPY-ONLY (priority >= 9 only)
--   • row present AND (until IS NULL OR until > now())   → FULL crawl (discovery + spy), old behavior
--
-- This is a CREATE OR REPLACE with the SAME signature — no PostgREST reload needed, safe to apply
-- live. The already-running scheduler picks up the new body on its next rpc call (no restart).
--
-- ── Resume the discovery crawl later (one-liner, no migration) ──
--   insert into system_flags(key, until) values ('crawl_discovery_enabled', null)
--     on conflict (key) do update set until = null, updated_at = now();
-- ── Go back to spy-only ──
--   delete from system_flags where key = 'crawl_discovery_enabled';

create or replace function claim_next_brand(p_gap_min int, p_lease_min int default 30)
returns table(page_id text, term text)
language plpgsql
as $$
declare
  v_cutoff    timestamptz := now() - make_interval(mins => p_gap_min);
  v_lease     timestamptz := now() - make_interval(mins => p_lease_min);
  v_spy       timestamptz := now() - interval '6 hours';
  v_discovery boolean;
begin
  -- Discovery crawl is OFF unless the flag row exists and is live.
  select (sf.until is null or sf.until > now())
    into v_discovery
    from system_flags sf
   where sf.key = 'crawl_discovery_enabled';
  v_discovery := coalesce(v_discovery, false);

  return query
  update discovery_crawl_terms t
     set crawling_at = now()
   where t.page_id = (
     select c.page_id
       from discovery_crawl_terms c
      where c.is_active = true
        and c.page_id is not null
        and (v_discovery or c.priority >= 9)   -- SPY-ONLY gate: skip discovery pop unless enabled
        and (c.crawling_at is null or c.crawling_at < v_lease)
        and (c.last_crawled_at is null or c.last_crawled_at <= v_cutoff)
      order by
        (case when c.priority >= 9 and c.last_crawled_at is null then 0   -- just-spied, first crawl
              when c.last_crawled_at is null then 1                        -- never-crawled (discovery)
              when c.priority >= 9 and c.last_crawled_at <= v_spy then 2   -- spied 6h refresh
              else 3 end),                                                 -- everything else, oldest
        c.last_crawled_at asc nulls first
      for update skip locked
      limit 1
   )
   returning t.page_id, t.term;
end;
$$;

grant execute on function claim_next_brand(int, int) to anon, authenticated, service_role;
