-- 160_seo.sql — SEO department tables. Phase 1 uses seo_audit; seo_keywords + seo_pages are for the
-- Keyword brain (Phase 2) and Programmatic SEO (Phase 3). Rank history reuses 157_seo_rank_history.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule). RLS on, service-role only.

create extension if not exists "pgcrypto";

-- keyword targets (Phase 2 — filled from a keyword/SERP API)
create table if not exists public.seo_keywords (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid references public.brands(id) on delete cascade,
  user_id     uuid not null,
  keyword     text not null,
  intent      text,                         -- informational | commercial | transactional | navigational
  volume      int,
  difficulty  int,
  position    int,                           -- current rank if known
  cluster     text,                          -- the topic cluster this keyword belongs to
  source      text,
  created_at  timestamptz default now()
);
create index if not exists idx_seo_keywords_brand on public.seo_keywords(brand_id);

-- SEO pages the Content/Programmatic agents generate (Phase 2/3)
create table if not exists public.seo_pages (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid references public.brands(id) on delete cascade,
  user_id            uuid not null,
  kind               text default 'programmatic',   -- programmatic | answer | brief
  title              text,
  slug               text,
  target_keyword     text,
  body_markdown      text,
  status             text default 'draft',           -- draft | approved | published | failed
  shopify_article_id text,
  published_url      text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create index if not exists idx_seo_pages_brand on public.seo_pages(brand_id, created_at desc);

-- technical audit snapshots (Phase 1)
create table if not exists public.seo_audit (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references public.brands(id) on delete cascade,
  user_id       uuid not null,
  score         int,
  issues        jsonb default '[]',           -- [{severity,title,detail,pages:[]}]
  pages_crawled int,
  site          text,
  created_at    timestamptz default now()
);
create index if not exists idx_seo_audit_brand on public.seo_audit(brand_id, created_at desc);

alter table public.seo_keywords enable row level security;
alter table public.seo_pages    enable row level security;
alter table public.seo_audit    enable row level security;

grant all on public.seo_keywords to service_role;
grant all on public.seo_pages    to service_role;
grant all on public.seo_audit    to service_role;
