-- Diagnostic table for the days_running investigation (2026-07-26).
-- Spied ads store start_date = crawl date (days_running always 0) while Facebook's Ad Library shows
-- real launch dates. This table lets us SEE which field in Meta's GraphQL carries the real date —
-- the crawler upserts every date/time-ish field it received per ad (gated by DEBUG_DATES=1). Read it
-- with a plain SELECT, confirm the field, then we ship the exact days_running fix and DROP this table.
-- Bounded by distinct ad_id (upsert). Service-role only (admin inspection). Apply with crawl paused.

create table if not exists public.crawl_date_probe (
  ad_id          text primary key,
  page_name      text,
  is_active      boolean,
  has_media      boolean,
  computed_start timestamptz,  -- what our CURRENT parser would store (the bug: = crawl date)
  raw_dates      jsonb not null default '{}'::jsonb,  -- every date/time-ish key Meta actually sent
  seen_at        timestamptz not null default now()
);

grant all on public.crawl_date_probe to service_role;
