-- 131 — Channel layer: talk to the founder on Slack + WhatsApp, and let them approve from there.
--
-- Selfmade already has the approve→act spine (mello_tasks, mig 124/126) + the brief assembler. This
-- adds the two tables the messaging layer needs, and NOTHING about execution changes: an inbound
-- "yes" (WhatsApp) or an Approve tap (Slack) resolves to a mello_tasks row and runs the SAME executor
-- the web uses (src/lib/mello/run-task.ts).
--
--   channel_identities  — links a founder's account to their Slack user / WhatsApp number.
--   channel_messages    — maps an OUTBOUND approval message → the mello_task it's asking about, so an
--                         inbound reply/click can find the right task (and can't be replayed twice).
--   channel_link_codes  — short-lived codes for the "text this code to the bot to connect" binding.

-- ── who is this founder, on which channel ───────────────────────────────────
create table if not exists public.channel_identities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  provider      text not null check (provider in ('slack','whatsapp')),
  external_id   text not null,               -- slack user id (Uxxxx) / whatsapp phone in E.164
  display       text,                        -- best-effort human label (name / number)
  meta          jsonb not null default '{}', -- slack: {team_id, channel_id, bot_channel} · unipile: {account_id}
  verified      boolean not null default true,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- one link per external identity (a given Slack user / phone maps to exactly one account)
create unique index if not exists channel_identities_provider_external_uq
  on public.channel_identities (provider, external_id);
create index if not exists channel_identities_user_idx
  on public.channel_identities (user_id, provider) where active;

-- ── which outbound message is asking about which task ────────────────────────
create table if not exists public.channel_messages (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  provider             text not null check (provider in ('slack','whatsapp')),
  external_id          text,                 -- slack ts / unipile message id (for editing the card after)
  channel_ref          text,                 -- slack channel id / whatsapp chat id (where to reply)
  kind                 text not null default 'approval' check (kind in ('approval','report','info')),
  task_id              uuid references public.mello_tasks(id) on delete set null,
  status               text not null default 'sent'
                         check (status in ('sent','approved','skipped','executed','failed','expired')),
  expires_at           timestamptz,          -- approvals go stale; a late "yes" can't fire
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- resolve a free-text "yes" (WhatsApp has no button) to this user's most recent open approval
create index if not exists channel_messages_open_idx
  on public.channel_messages (user_id, provider, status, created_at desc);
create index if not exists channel_messages_task_idx
  on public.channel_messages (task_id);

-- ── connect-your-channel codes ("text SM-4F9K2A to the bot") ────────────────
create table if not exists public.channel_link_codes (
  code        text primary key,             -- short, human-typeable
  user_id     uuid not null,
  provider    text check (provider in ('slack','whatsapp')),   -- null = any
  used_at     timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists channel_link_codes_user_idx on public.channel_link_codes (user_id);

-- RLS: these are service-role-only tables (all reads/writes go through the admin client in the
-- webhook + channel routes, exactly like mello_tasks). Enable RLS with no policies → locked to
-- service_role, which bypasses it. Never exposed to the browser anon key.
alter table public.channel_identities enable row level security;
alter table public.channel_messages   enable row level security;
alter table public.channel_link_codes enable row level security;

grant all on public.channel_identities to service_role;
grant all on public.channel_messages   to service_role;
grant all on public.channel_link_codes to service_role;
