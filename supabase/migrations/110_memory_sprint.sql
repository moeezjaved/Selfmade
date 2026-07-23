-- 110_memory_sprint.sql — deepen Mello's memory (the moat).
-- (1) mello_memory gains category/confidence (structured recall) + a pgvector embedding so Mello can
--     retrieve by MEANING ("what did I say about discounts months ago") not just recency.
-- (2) daily_observations — Mello's nightly notes about each brand ("competitors leaning into founder
--     videos; recommend testing authority hooks"), the L7 layer that feeds the morning brief.
-- Additive only; the agent's existing reads/writes keep working. pgvector 0.8 + hnsw (no training).

-- ── mello_memory: structured + semantic ──
alter table mello_memory add column if not exists category   text;                    -- voice | audience | competitor | rule | goal | product | scar
alter table mello_memory add column if not exists confidence int  default 80;         -- 0-100, how sure Mello is (corrections raise it, inferences lower it)
alter table mello_memory add column if not exists embedding  vector(1536);            -- text-embedding-3-small of `content`, for semantic recall

-- hnsw cosine index (pgvector 0.8, builds on empty tables, no ivfflat training needed)
create index if not exists mello_memory_embed_hnsw on mello_memory using hnsw (embedding vector_cosine_ops);

-- ── daily_observations: Mello's nightly employee notes (L7) ──
create table if not exists daily_observations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  brand_id    uuid,
  obs_date    date not null default (now()::date),
  observation text not null,                 -- the note, Mello's voice
  confidence  int  not null default 70,      -- 0-100
  action      text,                          -- the suggested next step, if any
  source      text not null default 'mello', -- mello | rollup | alert-worker
  surfaced_at timestamptz,                   -- when the brief showed it
  created_at  timestamptz not null default now()
);
create index if not exists daily_observations_user_idx on daily_observations (user_id, obs_date desc);
create index if not exists daily_observations_brand_idx on daily_observations (brand_id) where brand_id is not null;

alter table daily_observations enable row level security;
drop policy if exists daily_observations_owner on daily_observations;
create policy daily_observations_owner on daily_observations
  for select using (auth.uid() = user_id);

-- us-east dropped default privileges: grant explicitly (app reads via RLS; workers write via service_role).
grant select on daily_observations to authenticated;
grant all on daily_observations to service_role;
grant select, insert, update, delete on mello_memory to authenticated;
grant all on mello_memory to service_role;
