-- 165_wins.sql — the Wins Ledger. The permanent record of every money-moving action the founder takes, and
-- the spine of the revenue game. Two honest columns: projected_value (an ESTIMATE, labeled) and banked_value
-- (VERIFIED later from real orders/Meta — starts null, filled by the proof loop). Also the durable home for
-- generated briefs/playbooks so nothing evaporates on reload.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

create table if not exists public.wins (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid references public.brands(id) on delete cascade,
  user_id         uuid not null,
  category        text not null,             -- catalog | content | programmatic | ads | geo | seo | site
  title           text not null,             -- "Fixed 12 product SEO gaps", "Published 5 pages", …
  detail          text,
  projected_value numeric,                    -- €/mo estimate (nullable — only when defensible)
  banked_value    numeric,                    -- verified € (nullable until the proof loop confirms)
  currency        text,
  verified_at     timestamptz,                -- when banked_value was confirmed
  meta            jsonb,                       -- refs (draft id, product gid, campaign, url) for the proof loop
  created_at      timestamptz default now()
);
create index if not exists idx_wins_brand on public.wins(brand_id, created_at desc);
create index if not exists idx_wins_user on public.wins(user_id, created_at desc);
create index if not exists idx_wins_category on public.wins(user_id, category);

alter table public.wins enable row level security;
grant all on public.wins to service_role;
