-- 149 — Company Brain v5: conflict resolution.
--
-- When a NEW rule the founder states (or Mello observes) contradicts an ACTIVE belief, the Brain must not
-- blindly store both. It records the clash here (pending) and asks the founder how to treat it — temporary
-- exception, replace the old rule, or keep the old one. Memory stays honest: nothing is silently overwritten.
--
-- PAUSE the crawl/drain before applying (schema reload under load can 503 the API). Idempotent.

create table if not exists public.brain_conflicts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  brand_id      uuid,
  existing_id   uuid,                                  -- the company_dna row it conflicts with (nullable if retired)
  existing_rule text not null,
  incoming_rule text not null,
  department    text,
  source        text not null default 'founder',       -- founder | slack | whatsapp | inbox | reflection
  status        text not null default 'pending' check (status in ('pending', 'resolved')),
  resolution    text check (resolution in ('temporary', 'replace', 'keep')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists brain_conflicts_pending_idx on public.brain_conflicts (user_id, status, created_at desc);

alter table public.brain_conflicts enable row level security;
grant all on public.brain_conflicts to service_role;
