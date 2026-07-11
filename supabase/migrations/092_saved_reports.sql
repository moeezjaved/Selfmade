-- Saved reports for the Motion-style reporting suite.
-- A saved report is a template + config (groupBy, dateRange, metric columns, sort, view) that the
-- user names and pins to the sidebar. Org-shared like boards: personal (author-only) or team.
-- Apply only with crawl+drain paused (schema-cache reload under load can 503 the API).

create table if not exists public.saved_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_by   uuid not null,
  name         text not null,
  template_key text not null,
  config       jsonb not null default '{}'::jsonb,
  platform     text not null default 'meta',
  visibility   text not null default 'personal' check (visibility in ('personal','team')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_saved_reports_org on public.saved_reports (org_id, created_at desc);
create index if not exists idx_saved_reports_creator on public.saved_reports (created_by);

alter table public.saved_reports enable row level security;

-- Service role (the app's admin client) bypasses RLS and does its own org-scoping, matching boards.
grant all on public.saved_reports to service_role;
