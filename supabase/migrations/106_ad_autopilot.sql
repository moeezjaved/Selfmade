-- 106_ad_autopilot.sql — Daily Ad Autopilot
-- One fresh ad per enrolled brand/ad, generated and emailed every day. Alternates between a new
-- variation of the ad the user made and a fresh clone of a new competitor winner in the same niche.
-- Charged per generation (same price as a manual clone) — i.e. per email. Skips days the user is out
-- of credits. Uncapped until the user turns it off. Additive; nothing existing is changed.

create table if not exists ad_autopilot (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  brand_id     uuid,                         -- brand whose product/kit is dropped into the ad
  source_ad_id text,                         -- the competitor ad originally cloned (variation + niche seed)
  media_type   text not null default 'image' check (media_type in ('image','video')),
  settings     jsonb not null default '{}',  -- {aspect,image_size,tier,product_type,look}
  active       boolean not null default true,
  last_kind    text,                         -- 'variation' | 'fresh' (drives the daily alternation)
  used_ad_ids  text[] not null default '{}', -- competitor ads already used for 'fresh' (avoid repeats)
  last_run_at  timestamptz,                  -- last time we attempted a run (success OR skip)
  last_sent_at timestamptz,                  -- last time an email actually went out
  runs         int not null default 0,       -- successful sends
  created_at   timestamptz not null default now()
);

create index if not exists ad_autopilot_due_idx  on ad_autopilot (active, last_run_at);
create index if not exists ad_autopilot_user_idx on ad_autopilot (user_id);
-- one enrollment per (user, brand, source ad, media type) — re-enrolling reactivates the same row
create unique index if not exists ad_autopilot_uniq on ad_autopilot (user_id, brand_id, source_ad_id, media_type);

alter table ad_autopilot enable row level security;
drop policy if exists ad_autopilot_owner on ad_autopilot;
create policy ad_autopilot_owner on ad_autopilot
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- us-east dropped default privileges: grant explicitly so the app (authenticated, RLS-gated) and the
-- worker/endpoint (service_role) can both reach the table.
grant select, insert, update, delete on ad_autopilot to authenticated;
grant all on ad_autopilot to service_role;
