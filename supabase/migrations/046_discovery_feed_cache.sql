-- Persistent feed snapshot cache (instant cold loads).
-- A cron (worker/src/feed-snapshot.mjs) refreshes the bare default-feed payload every few minutes so
-- the hottest path — Discovery's default Explore feed — serves instantly even while the rollup and
-- drain hammer discovery_ads_index. db-search reads this; the service-role cron writes it.
--
-- APPLY ONLY WHEN THE WRITE LOAD IS QUIET (pause crawl/drain/rollup first) — creating a table forces
-- a PostgREST schema reload, which 503'd the whole API once under load.
create table if not exists discovery_feed_cache (
  key        text primary key,            -- e.g. 'feed:default:recommended'
  payload    jsonb       not null,         -- the exact db-search response { ads, total, ... }
  updated_at timestamptz not null default now()
);

-- Public ad data — readable by the serving client; only the service-role cron writes (bypasses RLS).
alter table discovery_feed_cache enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'discovery_feed_cache' and policyname = 'feed_cache_read') then
    create policy "feed_cache_read" on discovery_feed_cache for select using (true);
  end if;
end $$;
