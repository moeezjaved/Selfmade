-- Capture the anonymous ADS audit as a lead — the ads counterpart to audit_scans (the SEO scan). The
-- public ads theater (/api/scan/run) runs with no login and, until now, stored nothing; so we couldn't
-- see who ran an ads audit but never signed up. Keyed by Facebook page_id (the ads audit has no domain).
-- claimed_by fills in once that founder connects the page/account (future). APPLY WITH THE CRAWL PAUSED.
create extension if not exists "pgcrypto";

create table if not exists public.ads_audit_scans (
  id          uuid primary key default gen_random_uuid(),
  page_id     text not null unique,          -- Facebook Page id the audit ran on
  brand_name  text,
  niche       text,
  score       int,                            -- ad-presence score (0-100)
  result      jsonb not null,                 -- the full DNA/ads-audit result
  claimed_by  uuid,                           -- user_id once someone connects this page
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_ads_audit_scans_created on public.ads_audit_scans(created_at desc);

alter table public.ads_audit_scans enable row level security;
grant all on public.ads_audit_scans to service_role;
