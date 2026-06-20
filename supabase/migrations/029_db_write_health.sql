-- DB write-health snapshot for the /admin/health "DB Write Health" panel.
-- Surfaces bloat (dead-tuple %) so the operator can SEE whether crawl concurrency
-- is outpacing autovacuum (bloat climbing = ease off; bloat low = push harder).
-- SECURITY DEFINER so the service role can read pg_stat_user_tables.
create or replace function db_write_health()
returns table(live bigint, dead bigint, dead_pct numeric, last_autovacuum timestamptz, table_bytes bigint)
language sql
security definer
stable
as $$
  select
    coalesce(n_live_tup, 0),
    coalesce(n_dead_tup, 0),
    case when coalesce(n_live_tup,0) + coalesce(n_dead_tup,0) > 0
         then round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
         else 0 end,
    last_autovacuum,
    pg_total_relation_size('discovery_ads_index')
  from pg_stat_user_tables
  where relname = 'discovery_ads_index';
$$;
