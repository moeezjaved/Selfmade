-- Historical rank tracking. Google Search Console only exposes a rolling 28-day snapshot, so on its own
-- /admin/seo can show "where we rank today" but never "how our rank is MOVING". This table stores a
-- periodic snapshot (one row per query per capture date) that the daily snapshot cron upserts into —
-- giving us a real time series to compute deltas and sparklines from.
create table if not exists public.seo_rank_history (
  id            bigint generated always as identity primary key,
  captured_on   date         not null,
  keyword       text         not null,          -- the search query
  page          text,                            -- best landing page for that query
  position      numeric(6,2) not null,           -- GSC average position over the window
  clicks        integer      not null default 0,
  impressions   integer      not null default 0,
  ctr           numeric(6,4) not null default 0,
  created_at    timestamptz  not null default now(),
  constraint seo_rank_history_uq unique (captured_on, keyword)
);

create index if not exists seo_rank_history_kw_idx on public.seo_rank_history (keyword, captured_on desc);

-- Admin/service-role only. RLS on with no public policy → the service key (admin client) bypasses RLS
-- and reads/writes freely, while anon/authenticated clients get nothing.
alter table public.seo_rank_history enable row level security;
