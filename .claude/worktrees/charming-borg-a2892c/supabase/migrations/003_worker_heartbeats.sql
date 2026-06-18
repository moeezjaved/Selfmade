-- Worker heartbeats — tracks self-hosted creative-extraction workers.
-- Each running worker upserts its row after every batch.

create table if not exists worker_heartbeats (
  worker_id           text primary key,
  last_active_at      timestamptz not null default now(),
  session_started_at  timestamptz not null default now(),
  session_processed   integer not null default 0,
  session_succeeded   integer not null default 0,
  session_failed      integer not null default 0,
  last_batch_size     integer,
  last_batch_seconds  numeric(8, 2),
  ads_per_min         numeric(8, 2),
  hostname            text,
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists worker_heartbeats_last_active_idx
  on worker_heartbeats (last_active_at desc);

-- A worker is "live" if its heartbeat is < 2 minutes old.
-- Use this view to filter active workers.
create or replace view active_workers as
  select *, (now() - last_active_at) < interval '2 minutes' as is_live
  from worker_heartbeats
  order by last_active_at desc;

comment on table worker_heartbeats is 'Tracks self-hosted Playwright creative-extraction workers';
