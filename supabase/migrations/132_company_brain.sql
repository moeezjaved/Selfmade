-- 132 — The Company Brain, Phase 1: memory that operates, not remembers.
--
-- Selfmade already had ONE flat notebook (mello_memory). This adds the missing layers so the company
-- remembers HOW IT OPERATES — beliefs, per-department knowledge, and (the crown jewel) an auto-written
-- log of what actually worked. Facts and beliefs live in separate stores on purpose: that separation
-- is what lets a later reflection job diff "what happened" against "what you said you believe" and ask
-- to update the rule. Extends, never rebuilds — mello_memory just gains a department dimension.
--
--   L2 · company_dna     — beliefs the founder TEACHES (manual). Mello may propose, never self-edits.
--   L3 · mello_memory    — department notebooks (add `department`).
--   L4 · learnings       — what worked/failed, AUTO-written, append-only. The compounding layer.
--   L5 · ceo_preferences — how to work with the CEO (channel already covered by channel_identities).

-- ── L2 · Company DNA (beliefs) ──────────────────────────────────────────────
create table if not exists public.company_dna (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  brand_id    uuid,                              -- null = account-wide belief
  rule        text not null,
  department  text,                              -- null = whole company; else research|creative|media|growth|customer|store|finance
  priority    text not null default 'normal' check (priority in ('high','normal','low')),
  active      boolean not null default true,
  created_by  text not null default 'founder' check (created_by in ('founder','mello')),  -- 'mello' = a proposed edit (inactive until approved)
  source      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists company_dna_user_idx on public.company_dna (user_id, active, department);

-- ── L4 · Learning log (facts) — append-only, auto-written ────────────────────
create table if not exists public.learnings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  brand_id    uuid,
  department  text not null,                     -- which department learned it
  event       text not null,                     -- what happened ("scaled UGC v3")
  result      text,                              -- the outcome ("ROAS held 2.6 over 5d")
  metric      jsonb not null default '{}',       -- { roas, cpa, newBudget, ... } for later aggregation
  confidence  int not null default 70,           -- 0-100
  source      text not null default 'auto' check (source in ('auto','founder')),
  created_at  timestamptz not null default now()
);
create index if not exists learnings_recall_idx on public.learnings (user_id, department, created_at desc);
create index if not exists learnings_brand_idx on public.learnings (brand_id, created_at desc);

-- ── L5 · CEO preferences (how to work with the founder) ─────────────────────
create table if not exists public.ceo_preferences (
  user_id     uuid not null,
  key         text not null,                     -- approval_threshold | active_hours | report_style | ...
  value       jsonb not null default '{}',
  inferred    boolean not null default false,    -- true = Mello learned it from behavior, false = founder set it
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

-- ── L3 · department notebooks = mello_memory + a department dimension ────────
alter table public.mello_memory add column if not exists department text;   -- null = general/account-wide

-- Service-role scoped like the rest of the app (all reads/writes via the admin client in the brain lib).
alter table public.company_dna     enable row level security;
alter table public.learnings       enable row level security;
alter table public.ceo_preferences enable row level security;
grant all on public.company_dna     to service_role;
grant all on public.learnings       to service_role;
grant all on public.ceo_preferences to service_role;
