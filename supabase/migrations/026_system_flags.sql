-- 026_system_flags.sql
-- Cooperative crawl-pause so the nightly rollup gets the same zero-write-contention
-- the manual run got by docker-stopping the writers — but driven from a Vercel cron
-- that CAN'T stop containers. The rollup sets `crawl_paused` (with a TTL `until`);
-- the scheduler + worker daemons check it before writing and back off while it's set.
-- The TTL means a crashed rollup auto-resumes the writers (fail-safe, never stuck).

create table if not exists system_flags (
  key        text primary key,
  until      timestamptz,
  updated_at timestamptz default now()
);

grant all on system_flags to service_role;
