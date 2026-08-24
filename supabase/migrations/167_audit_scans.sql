-- 167_audit_scans.sql — the bridge between the free scan theater and the logged-in product. Every public
-- scan is stored by domain; when a founder signs up and connects that store, we load their scan as the
-- starting SEO state (score, ranks, findings) — no re-scan, continuity from theater → dashboard.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

create table if not exists public.audit_scans (
  id           uuid primary key default gen_random_uuid(),
  domain       text not null unique,          -- bare host, e.g. hairresq.shop
  site_name    text,
  category     text,
  score        int,
  result       jsonb not null,                -- the full ScanResult
  claimed_by   uuid,                           -- user_id once someone connects this domain
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_audit_scans_domain on public.audit_scans(domain);

alter table public.audit_scans enable row level security;
grant all on public.audit_scans to service_role;
