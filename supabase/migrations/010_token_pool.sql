-- Indexer token pool.
--
-- Goal: rotate across multiple Meta user tokens so we can scale to 1000+ brands
-- without hitting per-token rate limits (~200 calls/hour). With a 5-token pool
-- we get ~1,000 calls/hour total — enough to keep 1000 brands on a weekly
-- re-crawl cadence.
--
-- Operational: admins toggle accounts into the pool via /admin/tokens. The
-- indexer's getNextAvailableToken() picks the least-recently-used token whose
-- cooldown has expired. On Meta error #613 the token is parked for 65 min.

alter table meta_accounts
  -- Mark accounts whose token may be used by the indexer.
  -- Default false so personal user accounts aren't accidentally pooled.
  add column if not exists is_indexer_pool boolean default false,

  -- Set when Meta returns #613 on this token. While now() < cooldown_until,
  -- the picker skips this row.
  add column if not exists cooldown_until timestamptz,

  -- Updated on every successful API call. Picker selects oldest first → round-robin.
  add column if not exists last_used_at timestamptz,

  -- Daily counter (informational, reset by trigger or cron). Useful for the
  -- /admin/tokens dashboard to show "% of daily quota used".
  add column if not exists calls_today integer default 0,
  add column if not exists calls_today_reset_at timestamptz default now(),

  -- Track total calls ever made on this token (lifetime counter).
  add column if not exists total_calls bigint default 0;

-- Index for the picker query: WHERE is_indexer_pool=true AND cooldown_until<now()
-- ORDER BY last_used_at ASC LIMIT 1
create index if not exists idx_meta_accounts_indexer_pool
  on meta_accounts(is_indexer_pool, cooldown_until, last_used_at)
  where is_indexer_pool = true;
