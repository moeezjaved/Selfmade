-- UGC Creators — the creator-recruiting employee. Discover creators (Apify, by country + follower range +
-- niche), reach out (bulk or one-by-one, drafted for approval), run the reply conversation in a dedicated
-- pipeline, and once they confirm, collect name/address/phone so we can ship product + a script. Additive.

create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid,
  platform text not null default 'instagram',
  handle text not null,                 -- IG username, no @
  full_name text,
  profile_url text,
  avatar_url text,
  followers int,
  engagement_rate numeric,
  category text,                        -- niche / business category
  bio text,
  country text,
  email text,
  phone text,
  -- collected AFTER they agree, so we can ship the product:
  ship_name text,
  ship_address text,
  ship_phone text,
  offer_type text,                      -- gifted | paid | affiliate
  offer_details text,
  script text,                          -- the UGC brief/script we generate for them
  stage text not null default 'sourced'
    check (stage in ('sourced','invited','replied','confirmed','details','shipped','received','declined')),
  source text not null default 'manual',-- apify | manual | csv
  chat_ref text,                        -- Unipile chat id when we DM
  notes text,
  meta jsonb not null default '{}'::jsonb,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_creators_user_handle on public.creators (user_id, platform, handle);
create index if not exists idx_creators_user_stage on public.creators (user_id, stage, created_at desc);

create table if not exists public.creator_messages (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  body text not null,
  channel text,                         -- email | instagram
  status text not null default 'pending' check (status in ('pending','sent','skipped')),
  created_at timestamptz not null default now()
);
create index if not exists idx_creator_messages_creator on public.creator_messages (creator_id, created_at);

alter table public.creators enable row level security;
alter table public.creator_messages enable row level security;
-- Owner-only (the API routes use the service role, which bypasses RLS; these guard any direct client read).
drop policy if exists creators_own on public.creators;
create policy creators_own on public.creators for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists creator_messages_own on public.creator_messages;
create policy creator_messages_own on public.creator_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant all on public.creators to service_role;
grant all on public.creator_messages to service_role;
grant select, insert, update, delete on public.creators to authenticated;
grant select, insert, update, delete on public.creator_messages to authenticated;
