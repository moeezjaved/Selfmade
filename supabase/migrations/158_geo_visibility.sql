-- 158_geo_visibility.sql — GEO Visibility Monitor (Phase A of the GEO department).
-- Tracks whether a brand is cited in AI answers (ChatGPT / Gemini / Perplexity …) for its target
-- buyer prompts, over time. One geo_checks row per (prompt × engine × run); geo_audit is the rolled-up
-- snapshot (share of voice + gaps). Modeled on 157_seo_rank_history: RLS on, service-role only.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

-- the target questions we track for a brand (category questions where we want the brand recommended)
create table if not exists public.geo_prompts (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid references public.brands(id) on delete cascade,
  user_id     uuid not null,
  prompt_text text not null,
  intent      text default 'commercial',       -- 'commercial' | 'informational'
  active      boolean default true,
  created_at  timestamptz default now()
);
create index if not exists idx_geo_prompts_brand on public.geo_prompts(brand_id) where active;

-- one check: one prompt asked to one engine on one day → was the brand cited? which rivals were?
create table if not exists public.geo_checks (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid references public.brands(id) on delete cascade,
  user_id          uuid not null,
  prompt_id        uuid references public.geo_prompts(id) on delete set null,
  prompt_text      text,
  engine           text not null,              -- 'chatgpt' | 'gemini' | 'perplexity'
  cited            boolean default false,       -- was the brand mentioned in the answer?
  grounded         boolean default false,       -- was the answer web-grounded (live) vs model knowledge?
  competitors_cited text[] default '{}',
  answer_excerpt   text,
  checked_on       date default current_date,
  created_at       timestamptz default now()
);
create index if not exists idx_geo_checks_brand_day on public.geo_checks(brand_id, checked_on desc);

-- the rolled-up snapshot per run: share of voice + the answer gaps to fix
create table if not exists public.geo_audit (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid references public.brands(id) on delete cascade,
  user_id        uuid not null,
  score          int,                           -- 0-100 (share of voice as a score)
  share_of_voice numeric,                       -- fraction 0..1 of AI answers where the brand appears
  prompts_checked int,
  engines        text[] default '{}',
  gaps           jsonb default '[]',            -- prompts where rivals are cited and the brand isn't
  created_at     timestamptz default now()
);
create index if not exists idx_geo_audit_brand on public.geo_audit(brand_id, created_at desc);

alter table public.geo_prompts enable row level security;
alter table public.geo_checks  enable row level security;
alter table public.geo_audit   enable row level security;

grant all on public.geo_prompts to service_role;
grant all on public.geo_checks  to service_role;
grant all on public.geo_audit   to service_role;
