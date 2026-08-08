-- 148 — Company Brain v4: memory that listens, remembers with a source, and has a history.
--
-- Extends the four live layers (company_dna, mello_memory, learnings, ceo_preferences) from mig 132.
-- Adds (a) shared TRUST columns so every atom is traceable + lifespanned, (b) the "Now" layer
-- (brain_context, auto-expiring), (c) the company history feed (brain_timeline), and (d) per-conversation
-- customer extractions (customer_signals) that aggregate into patterns on read. No vector store — retrieval
-- stays structured (department + recency + confidence). Idempotent; safe to re-run.
--
-- PAUSE the crawl/drain (or set crawl_paused) before applying — schema reload under load can 503 the API.

-- ── Shared trust columns on the three memory stores ──────────────────────────
alter table public.company_dna add column if not exists confidence     int         not null default 100;  -- explicit belief = certain
alter table public.company_dna add column if not exists retention      text        not null default 'permanent';
alter table public.company_dna add column if not exists expires_at     timestamptz;
alter table public.company_dna add column if not exists evidence       jsonb       not null default '{}'::jsonb;
alter table public.company_dna add column if not exists source_kind    text;
alter table public.company_dna add column if not exists source_ref     jsonb;
alter table public.company_dna add column if not exists reinforced     int         not null default 1;
alter table public.company_dna add column if not exists contradictions int         not null default 0;
alter table public.company_dna add column if not exists last_seen_at   timestamptz not null default now();

alter table public.mello_memory add column if not exists retention      text        not null default 'permanent';
alter table public.mello_memory add column if not exists expires_at     timestamptz;
alter table public.mello_memory add column if not exists evidence       jsonb       not null default '{}'::jsonb;
alter table public.mello_memory add column if not exists source_kind    text;
alter table public.mello_memory add column if not exists source_ref     jsonb;
alter table public.mello_memory add column if not exists reinforced     int         not null default 1;
alter table public.mello_memory add column if not exists contradictions int         not null default 0;
alter table public.mello_memory add column if not exists last_seen_at   timestamptz not null default now();

alter table public.learnings add column if not exists retention      text        not null default 'permanent';
alter table public.learnings add column if not exists expires_at     timestamptz;
alter table public.learnings add column if not exists evidence       jsonb       not null default '{}'::jsonb;
alter table public.learnings add column if not exists source_kind    text;
alter table public.learnings add column if not exists source_ref     jsonb;
alter table public.learnings add column if not exists last_seen_at   timestamptz not null default now();

-- ── The "Now" layer — live context that expires on its own ──────────────────
create table if not exists public.brain_context (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  brand_id   uuid,
  kind       text not null,                       -- active_campaign | priority | pending_approval | fresh_find
  body       text not null,
  ref        jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists brain_context_user_idx on public.brain_context (user_id, created_at desc);

-- ── Company timeline — append-only history ("the company learned X") ────────
create table if not exists public.brain_timeline (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  brand_id   uuid,
  department text,
  actor      text not null default 'mello',       -- mello | founder | research | creative | media | customer
  event      text not null,
  memory_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists brain_timeline_user_idx on public.brain_timeline (user_id, created_at desc);

-- ── Customer signals — per-conversation extractions, aggregated on read ─────
create table if not exists public.customer_signals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  brand_id   uuid,
  thread_id  uuid,
  topic      text not null,                        -- delivery | ingredient_safety | applicator | price | ...
  sentiment  text,                                 -- pos | neg | neutral
  quote      text,
  created_at timestamptz not null default now()
);
create index if not exists customer_signals_user_idx  on public.customer_signals (user_id, created_at desc);
create index if not exists customer_signals_topic_idx on public.customer_signals (user_id, topic, created_at desc);

-- Service-role scoped like the rest of the Brain (all reads/writes via the admin client).
alter table public.brain_context    enable row level security;
alter table public.brain_timeline   enable row level security;
alter table public.customer_signals enable row level security;
grant all on public.brain_context    to service_role;
grant all on public.brain_timeline   to service_role;
grant all on public.customer_signals to service_role;
