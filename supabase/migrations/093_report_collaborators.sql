-- Partner collaboration on saved reports (Motion's "Share with partner").
-- An owner invites a partner (by email) to a saved report; the partner accepts into one of their
-- workspaces and the report then appears under "Shared with me" in their sidebar.
-- Apply together with 092_saved_reports.sql, crawl+drain paused.

create table if not exists public.report_collaborators (
  id              uuid primary key default gen_random_uuid(),
  saved_report_id uuid not null,
  owner_org_id    uuid not null,
  owner_name      text,
  partner_email   text not null,
  partner_org_id  uuid,                         -- set when the partner accepts into a workspace
  token           text not null unique,
  status          text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by      uuid not null,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz
);

create index if not exists idx_report_collab_partner_org on public.report_collaborators (partner_org_id) where partner_org_id is not null;
create index if not exists idx_report_collab_email on public.report_collaborators (lower(partner_email));
create index if not exists idx_report_collab_report on public.report_collaborators (saved_report_id);

alter table public.report_collaborators enable row level security;
grant all on public.report_collaborators to service_role;
