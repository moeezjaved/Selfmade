-- Audit lead capture + nurture drip.
-- A visitor runs the free store-audit, then enters their email to unlock the full report + the 5 real ads
-- we render for them. We store the lead + a snapshot of their report, and queue an 8-email nurture drip.

create table if not exists public.audit_leads (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  domain            text,
  brand_name        text,
  report            jsonb,                       -- snapshot: score, revenueLostPerYear, currency, leaks, category, ai reads…
  ad_urls           text[] default '{}',         -- the real rendered ad images we made for them
  status            text not null default 'active',   -- active | converted | unsubscribed
  converted_user_id uuid,                        -- set when they sign up with this email
  unsub_token       text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (email, domain)
);
create index if not exists idx_audit_leads_status on public.audit_leads (status);
create index if not exists idx_audit_leads_email on public.audit_leads (lower(email));

-- One row per email in the drip. Email #1 is sent instantly; #2–#8 wait for their send_after AND (by
-- default) admin approval, so the founder can preview/edit/approve each before it goes out.
create table if not exists public.audit_emails (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.audit_leads(id) on delete cascade,
  step           int not null,                   -- 1..8
  subject        text not null,
  status         text not null default 'pending',-- pending (awaiting approval) | approved | sent | skipped
  send_after     timestamptz not null,           -- earliest it may send
  sent_at        timestamptz,
  edited_subject text,                            -- admin overrides (optional)
  edited_html    text,
  created_at     timestamptz not null default now(),
  unique (lead_id, step)
);
create index if not exists idx_audit_emails_due on public.audit_emails (status, send_after);
