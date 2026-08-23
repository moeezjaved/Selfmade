-- 163_seo_competitors.sql — Competitor SEO/GEO intelligence. What each rival publishes (from their public
-- sitemap + pages), the topics they cover, and — layered in when a keyword API is connected — their traffic
-- and rankings. Powers the content-gap → build-a-page loop that feeds programmatic SEO.
-- APPLY WITH THE CRAWL PAUSED (pause-before-DDL rule).

create extension if not exists "pgcrypto";

create table if not exists public.seo_competitors (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references public.brands(id) on delete cascade,
  user_id       uuid not null,
  name          text,
  domain        text not null,                -- bare host, e.g. fum.com
  page_count    int default 0,
  blog_count    int default 0,
  topics        jsonb default '[]'::jsonb,    -- [{topic, count}] derived from their URLs/titles
  sample_titles jsonb default '[]'::jsonb,    -- a few real article titles
  -- filled only when a keyword/traffic API is connected (Ahrefs / DataForSEO / SimilarWeb):
  est_traffic   int,
  top_keywords  jsonb,                         -- [{keyword, position, volume}]
  status        text default 'ok',            -- ok | crawling | error
  error         text,
  last_crawled  timestamptz,
  created_at    timestamptz default now(),
  unique (user_id, brand_id, domain)
);
create index if not exists idx_seo_competitors_brand on public.seo_competitors(brand_id, created_at desc);

alter table public.seo_competitors enable row level security;
grant all on public.seo_competitors to service_role;
