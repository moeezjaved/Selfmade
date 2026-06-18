-- Resume cursor for brand crawls.
-- Vercel routes are capped at 300s. For brands with 50K+ ads, we save
-- the Meta Graph API cursor + a 'completed' flag so the next cron run
-- picks up exactly where we left off.

create table if not exists discovery_brand_crawl_state (
  page_id           text primary key,
  brand_name        text,
  cursor            text,                       -- Meta Graph API "after" cursor; NULL = start from beginning
  ads_indexed       integer not null default 0, -- running tally for this brand
  last_run_at       timestamptz not null default now(),
  last_run_added    integer,                    -- # new ads added in last run
  exhausted_at      timestamptz,                -- set when cursor returned no more pages
  notes             text
);

create index if not exists discovery_brand_crawl_state_exhausted_idx
  on discovery_brand_crawl_state (exhausted_at);

comment on table discovery_brand_crawl_state is
  'Resume state for paginated brand crawls. Avoids re-fetching same pages every cron tick.';
